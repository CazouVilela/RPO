/**
 * RPO V5 - Worker de Sincronizacao Valkey -> PostgreSQL
 *
 * A cada 1s: le sync_queue do Valkey, upsert no PostgreSQL
 * A cada 10s: processa fallback_log
 * A cada 60s: auto-detecta schemas ativos
 */

require('dotenv').config();
const { Pool } = require('pg');
const format = require('pg-format');
const fs = require('fs');
const path = require('path');
const { sanitizeSchema, buildQuery } = require('./helpers/db');
const {
  valkey,
  getSyncQueue,
  removeSyncQueue,
  getSyncQueueCandidatos,
  removeSyncQueueCandidatos,
  getHistoricoVagas,
  getHistoricoCandidatos
} = require('./valkey_cache');
const { VALKEY_KEYS } = require('./constants/valkey-keys');
const { TABLES } = require('./constants/tables');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT) || 15432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 10
});

let activeSchemas = [];
let isRunning = false;
const stats = { vagas_synced: 0, candidatos_synced: 0, errors: 0, cycles: 0 };

// Cache de colunas por schema para evitar queries repetidas
const columnsCache = {};

async function getTableColumns(schema, tableName) {
  const cacheKey = `${schema}.${tableName}`;
  if (columnsCache[cacheKey]) return columnsCache[cacheKey];

  try {
    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, tableName]
    );
    const columns = result.rows.map(r => r.column_name);
    columnsCache[cacheKey] = columns;
    return columns;
  } catch (err) {
    console.error(`Erro ao buscar colunas de ${schema}.${tableName}:`, err.message);
    return [];
  }
}

/**
 * Descobre schemas ativos no PostgreSQL
 */
async function discoverSchemas() {
  try {
    // Le schemas.json
    const schemasPath = path.join(__dirname, 'schemas.json');
    if (fs.existsSync(schemasPath)) {
      const config = JSON.parse(fs.readFileSync(schemasPath, 'utf8'));
      activeSchemas = config.schemas.filter(s => s.active).map(s => s.name);
    }

    // Auto-detecta schemas com tabela historico_vagas
    if (activeSchemas.length === 0) {
      const result = await pool.query(
        `SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name = 'historico_vagas' AND table_schema LIKE 'RPO_%'`
      );
      activeSchemas = result.rows.map(r => r.table_schema);
    }

    if (activeSchemas.length > 0) {
      console.log(`Schemas ativos: ${activeSchemas.join(', ')}`);
    }
  } catch (err) {
    console.error('Erro ao descobrir schemas:', err.message);
  }
}

/**
 * Sincroniza vagas do Valkey para PostgreSQL
 */
async function syncVagas(schema) {
  try {
    const queue = await getSyncQueue(schema);
    if (queue.length === 0) return;

    console.log(`[${schema}] Sincronizando ${queue.length} vagas...`);

    const columns = await getTableColumns(schema, 'historico_vagas');
    if (columns.length === 0) return;

    // Colunas que podem ser atualizadas (exclui id, created_at)
    const updatableColumns = columns.filter(c => !['id', 'created_at'].includes(c));

    for (const requisicao of queue) {
      try {
        const historico = await getHistoricoVagas(schema, requisicao);
        if (historico.length === 0) {
          await removeSyncQueue(schema, requisicao);
          continue;
        }

        // Pega a linha mais recente
        const linha = historico[historico.length - 1];

        // Filtra campos que existem na tabela
        const dadosFiltrados = {};
        for (const col of updatableColumns) {
          if (col in linha && linha[col] !== undefined) {
            dadosFiltrados[col] = linha[col];
          }
        }

        if (!dadosFiltrados.requisicao) {
          await removeSyncQueue(schema, requisicao);
          continue;
        }

        // UPSERT - se tem cached_at eh registro novo do Valkey
        const cols = Object.keys(dadosFiltrados);
        const vals = Object.values(dadosFiltrados);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        const colsStr = cols.map(c => format.ident(c)).join(', ');
        const updateStr = cols
          .filter(c => c !== 'requisicao')
          .map(c => `${format.ident(c)} = EXCLUDED.${format.ident(c)}`)
          .join(', ');

        // Insere como nova linha (nao faz upsert pois cada status eh uma linha nova)
        const insertQuery = format(
          `INSERT INTO %I.%I (${colsStr}, created_at) VALUES (${placeholders}, NOW())`,
          schema, 'historico_vagas'
        );

        await pool.query(insertQuery, vals);
        await removeSyncQueue(schema, requisicao);
        stats.vagas_synced++;

      } catch (err) {
        console.error(`Erro ao sincronizar vaga ${requisicao}:`, err.message);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error(`Erro no sync vagas ${schema}:`, err.message);
    stats.errors++;
  }
}

/**
 * Sincroniza candidatos do Valkey para PostgreSQL
 */
async function syncCandidatos(schema) {
  try {
    const queue = await getSyncQueueCandidatos(schema);
    if (queue.length === 0) return;

    console.log(`[${schema}] Sincronizando ${queue.length} candidatos...`);

    const columns = await getTableColumns(schema, 'historico_candidatos');
    if (columns.length === 0) return;

    const updatableColumns = columns.filter(c => !['id', 'created_at'].includes(c));

    for (const candidatoId of queue) {
      try {
        const historico = await getHistoricoCandidatos(schema, candidatoId);
        if (historico.length === 0) {
          await removeSyncQueueCandidatos(schema, candidatoId);
          continue;
        }

        const linha = historico[historico.length - 1];

        const dadosFiltrados = {};
        for (const col of updatableColumns) {
          if (col in linha && linha[col] !== undefined) {
            dadosFiltrados[col] = linha[col];
          }
        }

        if (!dadosFiltrados.id_candidato) {
          await removeSyncQueueCandidatos(schema, candidatoId);
          continue;
        }

        const cols = Object.keys(dadosFiltrados);
        const vals = Object.values(dadosFiltrados);
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
        const colsStr = cols.map(c => format.ident(c)).join(', ');

        const insertQuery = format(
          `INSERT INTO %I.%I (${colsStr}, created_at) VALUES (${placeholders}, NOW())`,
          schema, 'historico_candidatos'
        );

        await pool.query(insertQuery, vals);
        await removeSyncQueueCandidatos(schema, candidatoId);
        stats.candidatos_synced++;

      } catch (err) {
        console.error(`Erro ao sincronizar candidato ${candidatoId}:`, err.message);
        stats.errors++;
      }
    }
  } catch (err) {
    console.error(`Erro no sync candidatos ${schema}:`, err.message);
    stats.errors++;
  }
}

/**
 * Loop principal do worker
 */
async function mainLoop() {
  if (isRunning) return;
  isRunning = true;

  try {
    for (const schema of activeSchemas) {
      await syncVagas(schema);
      await syncCandidatos(schema);
    }
    stats.cycles++;
  } catch (err) {
    console.error('Erro no loop principal:', err.message);
  } finally {
    isRunning = false;
  }
}

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

async function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando worker...`);
  console.log('Stats:', JSON.stringify(stats));
  try {
    await pool.end();
    await valkey.quit();
  } catch (err) { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ========================================
// INICIAR WORKER
// ========================================

async function start() {
  console.log('');
  console.log('========================================');
  console.log('RPO V5 - Worker Sync RODANDO');
  console.log('========================================');
  console.log('Sync: 1s | Schema discovery: 60s');
  console.log('========================================');
  console.log('');

  // Primeira descoberta de schemas
  await discoverSchemas();

  // Sync a cada 1s
  setInterval(mainLoop, 1000);

  // Schema discovery a cada 60s
  setInterval(discoverSchemas, 60000);
}

start().catch(err => {
  console.error('Erro fatal no worker:', err);
  process.exit(1);
});
