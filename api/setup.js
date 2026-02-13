/**
 * RPO V5 - Setup de Schema e Tabelas
 *
 * Cria schema, tabelas e popula dados de referencia
 * Pode ser chamado via API (POST /setup) ou CLI (node setup.js)
 *
 * V5 usa config_sheet com colunas snake_case:
 * - config_label, value
 * - nome_fixo, nome_amigavel, campo_utilizado, grupo_do_campo, tipo_do_dado
 * - funcao_sistema, fim_fluxo, sla_1..sla_5
 */

require('dotenv').config();
const { Pool } = require('pg');
const format = require('pg-format');
const fs = require('fs');
const path = require('path');
const { sanitizeSchema, buildQuery } = require('./helpers/db');
const {
  loadStatusVagas,
  loadStatusCandidatos,
  loadDicionarioVagas,
  loadDicionarioCandidatos,
  loadConfig,
  clearHistoricoVagas,
  clearHistoricoCandidatos
} = require('./valkey_cache');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT) || 15432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 5
});

function mapearTipoSQL(tipoDoDado) {
  if (!tipoDoDado) return 'TEXT';
  const tipo = String(tipoDoDado).toLowerCase();
  if (tipo.includes('inteiro') || tipo.includes('integer') || tipo.includes('numero')) return 'INTEGER';
  if (tipo.includes('decimal') || tipo.includes('float') || tipo.includes('double')) return 'DECIMAL';
  if (tipo.includes('booleano') || tipo.includes('boolean') || tipo.includes('sim/nao')) return 'BOOLEAN';
  if (tipo.includes('data') || tipo.includes('date')) return 'DATE';
  if (tipo.includes('timestamp') || tipo.includes('datetime')) return 'TIMESTAMP';
  if (tipo.includes('texto curto') || tipo.includes('varchar')) return 'VARCHAR(255)';
  return 'TEXT';
}

/**
 * Setup completo para vagas
 */
async function runSetup(schema, statusData, dicionarioData, spreadsheetId) {
  const startTime = Date.now();
  const client = await pool.connect();

  try {
    console.log('Iniciando transacao PostgreSQL...');
    await client.query('BEGIN');

    const safeSchema = sanitizeSchema(schema);

    // 1. Criar schema
    console.log('1/6 - Criando schema...');
    await client.query(format('CREATE SCHEMA IF NOT EXISTS %I', safeSchema));
    console.log(`Schema ${safeSchema} criado/verificado`);

    // 2. Criar tabela config_sheet
    console.log('2/6 - Criando tabela config_sheet...');
    await client.query(format(
      `CREATE TABLE IF NOT EXISTS %I.config_sheet (
        config_label TEXT PRIMARY KEY,
        value TEXT
      )`,
      safeSchema
    ));

    // 3. Criar tabela status_vagas (com SLA 1-5)
    console.log('3/6 - Criando tabela status_vagas...');
    const checkStatusQuery = `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)`;
    const statusExists = (await client.query(checkStatusQuery, [safeSchema, 'status_vagas'])).rows[0].exists;

    if (!statusExists) {
      await client.query(format(
        `CREATE TABLE %I.status_vagas (
          sequencia INTEGER,
          status VARCHAR(100) PRIMARY KEY,
          funcao_sistema VARCHAR(100),
          fim_fluxo VARCHAR(10) NOT NULL,
          responsavel VARCHAR(100),
          sla_1 VARCHAR(50),
          sla_2 VARCHAR(50),
          sla_3 VARCHAR(50),
          sla_4 VARCHAR(50),
          sla_5 VARCHAR(50)
        )`,
        safeSchema
      ));

      const insertStatusQuery = buildQuery(schema, 'status_vagas',
        'INSERT INTO %I.%I (sequencia, status, funcao_sistema, fim_fluxo, responsavel, sla_1, sla_2, sla_3, sla_4, sla_5) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)'
      );
      for (const item of statusData) {
        await client.query(insertStatusQuery, [
          item.sequencia || null, item.status,
          item.funcao_sistema || null, item.fim_fluxo || 'Nao',
          item.responsavel || null,
          item.sla_1 || null, item.sla_2 || null, item.sla_3 || null,
          item.sla_4 || null, item.sla_5 || null
        ]);
      }
      console.log(`${statusData.length} status de vagas inseridos`);
    } else {
      console.log('Tabela status_vagas ja existe, mantendo dados');
    }

    // 4. Criar tabela dicionario_vagas
    console.log('4/6 - Criando tabela dicionario_vagas...');
    const dicExists = (await client.query(checkStatusQuery, [safeSchema, 'dicionario_vagas'])).rows[0].exists;

    if (!dicExists) {
      await client.query(format(
        `CREATE TABLE %I.dicionario_vagas (
          nome_fixo VARCHAR(100) PRIMARY KEY,
          nome_amigavel VARCHAR(255) NOT NULL,
          nome_formulario VARCHAR(255),
          obrigatoriedade VARCHAR(50),
          campo_utilizado VARCHAR(10) NOT NULL,
          descritivo TEXT,
          tipo_do_dado VARCHAR(50),
          grupo_do_campo VARCHAR(50),
          formatacao_aplicada TEXT,
          formula_aplicada TEXT,
          gatilhos_aplicados TEXT,
          cor_da_coluna VARCHAR(20)
        )`,
        safeSchema
      ));

      const insertDicQuery = buildQuery(schema, 'dicionario_vagas',
        `INSERT INTO %I.%I (nome_fixo, nome_amigavel, nome_formulario, obrigatoriedade, campo_utilizado, descritivo, tipo_do_dado, grupo_do_campo, formatacao_aplicada, formula_aplicada, gatilhos_aplicados, cor_da_coluna) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`
      );
      for (const item of dicionarioData) {
        await client.query(insertDicQuery, [
          item.nome_fixo, item.nome_amigavel,
          item.nome_formulario || null, item.obrigatoriedade || null,
          item.campo_utilizado || 'Sim', item.descritivo || null,
          item.tipo_do_dado || null, item.grupo_do_campo || null,
          item.formatacao_aplicada || null, item.formula_aplicada || null,
          item.gatilhos_aplicados || null, item.cor_da_coluna || null
        ]);
      }
      console.log(`${dicionarioData.length} campos de vagas inseridos`);
    } else {
      console.log('Tabela dicionario_vagas ja existe, mantendo dados');
    }

    // 5. Criar tabela historico_vagas
    console.log('5/6 - Criando tabela historico_vagas...');
    const histExists = (await client.query(checkStatusQuery, [safeSchema, 'historico_vagas'])).rows[0].exists;

    if (!histExists) {
      const colunasDinamicas = [];
      const camposEstruturais = new Set(['requisicao', 'status', 'alterado_por']);

      for (const campo of dicionarioData) {
        if (camposEstruturais.has(campo.nome_fixo)) continue;
        const tipoSQL = mapearTipoSQL(campo.tipo_do_dado);
        colunasDinamicas.push(`${format.ident(campo.nome_fixo)} ${tipoSQL}`);
      }

      const colDinSQL = colunasDinamicas.length > 0 ? ',\n        ' + colunasDinamicas.join(',\n        ') : '';

      await client.query(format(
        `CREATE TABLE %I.%I (
          id SERIAL PRIMARY KEY,
          requisicao VARCHAR(100) NOT NULL,
          status VARCHAR(200),
          alterado_por VARCHAR(255),
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          version INTEGER DEFAULT 1${colDinSQL}
        );
        CREATE INDEX IF NOT EXISTS idx_hist_vagas_requisicao ON %I.%I(requisicao);
        CREATE INDEX IF NOT EXISTS idx_hist_vagas_created_at ON %I.%I(created_at DESC);`,
        safeSchema, 'historico_vagas',
        safeSchema, 'historico_vagas',
        safeSchema, 'historico_vagas'
      ));
      console.log(`Tabela historico_vagas criada com ${colunasDinamicas.length} colunas dinamicas`);
    } else {
      console.log('Tabela historico_vagas ja existe');
    }

    // 6. Criar tabelas auxiliares
    console.log('6/6 - Criando tabelas auxiliares...');

    await client.query(format(
      `CREATE TABLE IF NOT EXISTS %I.fallback_vagas (
        id SERIAL PRIMARY KEY,
        requisicao VARCHAR(100),
        dados JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      safeSchema
    ));

    await client.query(format(
      `CREATE TABLE IF NOT EXISTS %I.feriados (
        id SERIAL PRIMARY KEY,
        feriado TEXT,
        data TEXT
      )`,
      safeSchema
    ));

    // COMMIT
    await client.query('COMMIT');
    console.log('COMMIT da transacao');

    // Popular Valkey
    console.log('Populando Valkey...');
    await loadStatusVagas(schema, statusData);
    await loadDicionarioVagas(schema, dicionarioData);
    await clearHistoricoVagas(schema);

    // Atualizar schemas.json
    if (spreadsheetId) {
      updateSchemasJson(schema, spreadsheetId);
    }

    const totalTime = Date.now() - startTime;
    console.log('');
    console.log('========================================');
    console.log('SETUP VAGAS CONCLUIDO');
    console.log('========================================');
    console.log(`Tempo total: ${totalTime}ms`);
    console.log(`Schema: ${schema}`);
    console.log(`Status: ${statusData.length} | Dicionario: ${dicionarioData.length}`);
    console.log('========================================');

    return true;

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('SETUP VAGAS FALHOU:', err.message);
    return false;

  } finally {
    client.release();
  }
}

/**
 * Setup completo para candidatos
 */
async function runSetupCandidatos(schema, statusCandidatosData, dicionarioCandidatosData, spreadsheetId) {
  const startTime = Date.now();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const safeSchema = sanitizeSchema(schema);

    // 1. Status candidatos
    console.log('1/4 - Criando tabela status_candidatos...');
    const checkQuery = `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2)`;
    const statusCandExists = (await client.query(checkQuery, [safeSchema, 'status_candidatos'])).rows[0].exists;

    if (!statusCandExists) {
      await client.query(format(
        `CREATE TABLE %I.status_candidatos (
          sequencia INTEGER,
          status VARCHAR(100) PRIMARY KEY,
          funcao_sistema VARCHAR(100),
          fim_fluxo VARCHAR(10) NOT NULL,
          responsavel VARCHAR(100)
        )`,
        safeSchema
      ));

      const insertQuery = buildQuery(schema, 'status_candidatos',
        'INSERT INTO %I.%I (sequencia, status, funcao_sistema, fim_fluxo, responsavel) VALUES ($1, $2, $3, $4, $5)'
      );
      for (const item of statusCandidatosData) {
        await client.query(insertQuery, [
          item.sequencia || null, item.status,
          item.funcao_sistema || null, item.fim_fluxo || 'Nao',
          item.responsavel || null
        ]);
      }
      console.log(`${statusCandidatosData.length} status de candidatos inseridos`);
    } else {
      console.log('Tabela status_candidatos ja existe');
    }

    // 2. Dicionario candidatos
    console.log('2/4 - Criando tabela dicionario_candidatos...');
    const dicCandExists = (await client.query(checkQuery, [safeSchema, 'dicionario_candidatos'])).rows[0].exists;

    if (!dicCandExists) {
      await client.query(format(
        `CREATE TABLE %I.dicionario_candidatos (
          nome_fixo VARCHAR(100) PRIMARY KEY,
          nome_amigavel VARCHAR(255) NOT NULL,
          nome_formulario VARCHAR(255),
          obrigatoriedade VARCHAR(50),
          campo_utilizado VARCHAR(10) NOT NULL,
          descritivo TEXT,
          tipo_do_dado VARCHAR(50),
          grupo_do_campo VARCHAR(50),
          formatacao_aplicada TEXT,
          formula_aplicada TEXT,
          gatilhos_aplicados TEXT,
          cor_da_coluna VARCHAR(20)
        )`,
        safeSchema
      ));

      const insertDicCandQuery = buildQuery(schema, 'dicionario_candidatos',
        `INSERT INTO %I.%I (nome_fixo, nome_amigavel, nome_formulario, obrigatoriedade, campo_utilizado, descritivo, tipo_do_dado, grupo_do_campo, formatacao_aplicada, formula_aplicada, gatilhos_aplicados, cor_da_coluna) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`
      );
      for (const item of dicionarioCandidatosData) {
        await client.query(insertDicCandQuery, [
          item.nome_fixo, item.nome_amigavel,
          item.nome_formulario || null, item.obrigatoriedade || null,
          item.campo_utilizado || 'Sim', item.descritivo || null,
          item.tipo_do_dado || null, item.grupo_do_campo || null,
          item.formatacao_aplicada || null, item.formula_aplicada || null,
          item.gatilhos_aplicados || null, item.cor_da_coluna || null
        ]);
      }
      console.log(`${dicionarioCandidatosData.length} campos de candidatos inseridos`);
    } else {
      console.log('Tabela dicionario_candidatos ja existe');
    }

    // 3. Historico candidatos
    console.log('3/4 - Criando tabela historico_candidatos...');
    const histCandExists = (await client.query(checkQuery, [safeSchema, 'historico_candidatos'])).rows[0].exists;

    if (!histCandExists) {
      const colunasDinamicas = [];
      const camposEstruturais = new Set(['id_candidato', 'status_candidato', 'status_micro_candidato', 'alterado_por']);

      for (const campo of dicionarioCandidatosData) {
        const grupo = campo.grupo_do_campo || '';
        if (grupo === 'DADOS_IDENTIFICADORES') {
          if (camposEstruturais.has(campo.nome_fixo)) continue;
          const tipoSQL = mapearTipoSQL(campo.tipo_do_dado);
          colunasDinamicas.push(`${format.ident(campo.nome_fixo)} ${tipoSQL}`);
        }
      }

      const colDinSQL = colunasDinamicas.length > 0 ? ',\n        ' + colunasDinamicas.join(',\n        ') : '';

      await client.query(format(
        `CREATE TABLE %I.%I (
          id SERIAL PRIMARY KEY,
          id_candidato VARCHAR(100) NOT NULL,
          status_candidato VARCHAR(200),
          status_micro_candidato VARCHAR(200),
          alterado_por VARCHAR(255),
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()${colDinSQL}
        );
        CREATE INDEX IF NOT EXISTS idx_hist_cand_id ON %I.%I(id_candidato);
        CREATE INDEX IF NOT EXISTS idx_hist_cand_created ON %I.%I(created_at DESC);`,
        safeSchema, 'historico_candidatos',
        safeSchema, 'historico_candidatos',
        safeSchema, 'historico_candidatos'
      ));
      console.log(`Tabela historico_candidatos criada com ${colunasDinamicas.length} colunas dinamicas`);
    } else {
      console.log('Tabela historico_candidatos ja existe');
    }

    // 4. Fallback candidatos
    console.log('4/4 - Criando tabelas auxiliares candidatos...');
    await client.query(format(
      `CREATE TABLE IF NOT EXISTS %I.fallback_candidatos (
        id SERIAL PRIMARY KEY,
        id_candidato VARCHAR(100),
        dados JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )`,
      safeSchema
    ));

    await client.query('COMMIT');

    // Valkey
    await loadStatusCandidatos(schema, statusCandidatosData);
    await loadDicionarioCandidatos(schema, dicionarioCandidatosData);
    await clearHistoricoCandidatos(schema);

    if (spreadsheetId) {
      updateSchemasJson(schema, spreadsheetId);
    }

    const totalTime = Date.now() - startTime;
    console.log(`SETUP CANDIDATOS CONCLUIDO em ${totalTime}ms`);

    return true;

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('SETUP CANDIDATOS FALHOU:', err.message);
    return false;

  } finally {
    client.release();
  }
}

/**
 * Recria tabela status_vagas
 */
async function recreateStatus(schema, statusData) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const safeSchema = sanitizeSchema(schema);

    await client.query(format(
      `DROP TABLE IF EXISTS %I.status_vagas CASCADE;
       CREATE TABLE %I.status_vagas (
        sequencia INTEGER,
        status VARCHAR(100) PRIMARY KEY,
        funcao_sistema VARCHAR(100),
        fim_fluxo VARCHAR(10) NOT NULL,
        responsavel VARCHAR(100),
        sla_1 VARCHAR(50), sla_2 VARCHAR(50), sla_3 VARCHAR(50), sla_4 VARCHAR(50), sla_5 VARCHAR(50)
      )`,
      safeSchema, safeSchema
    ));

    const insertQuery = buildQuery(schema, 'status_vagas',
      'INSERT INTO %I.%I (sequencia, status, funcao_sistema, fim_fluxo, responsavel, sla_1, sla_2, sla_3, sla_4, sla_5) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)'
    );
    for (const item of statusData) {
      await client.query(insertQuery, [
        item.sequencia || null, item.status,
        item.funcao_sistema || null, item.fim_fluxo || 'Nao',
        item.responsavel || null,
        item.sla_1 || null, item.sla_2 || null, item.sla_3 || null,
        item.sla_4 || null, item.sla_5 || null
      ]);
    }

    await client.query('COMMIT');
    await loadStatusVagas(schema, statusData);

    return { sucesso: true, total: statusData.length };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    return { sucesso: false, erro: err.message };
  } finally {
    client.release();
  }
}

/**
 * Recria tabela dicionario_vagas
 */
async function recreateDicionario(schema, dicionarioData) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const safeSchema = sanitizeSchema(schema);

    await client.query(format(
      `DROP TABLE IF EXISTS %I.dicionario_vagas CASCADE;
       CREATE TABLE %I.dicionario_vagas (
        nome_fixo VARCHAR(100) PRIMARY KEY,
        nome_amigavel VARCHAR(255) NOT NULL,
        nome_formulario VARCHAR(255),
        obrigatoriedade VARCHAR(50),
        campo_utilizado VARCHAR(10) NOT NULL,
        descritivo TEXT,
        tipo_do_dado VARCHAR(50),
        grupo_do_campo VARCHAR(50),
        formatacao_aplicada TEXT,
        formula_aplicada TEXT,
        gatilhos_aplicados TEXT,
        cor_da_coluna VARCHAR(20)
      )`,
      safeSchema, safeSchema
    ));

    const insertQuery = buildQuery(schema, 'dicionario_vagas',
      `INSERT INTO %I.%I (nome_fixo, nome_amigavel, nome_formulario, obrigatoriedade, campo_utilizado, descritivo, tipo_do_dado, grupo_do_campo, formatacao_aplicada, formula_aplicada, gatilhos_aplicados, cor_da_coluna) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`
    );
    for (const item of dicionarioData) {
      await client.query(insertQuery, [
        item.nome_fixo, item.nome_amigavel,
        item.nome_formulario || null, item.obrigatoriedade || null,
        item.campo_utilizado || 'Sim', item.descritivo || null,
        item.tipo_do_dado || null, item.grupo_do_campo || null,
        item.formatacao_aplicada || null, item.formula_aplicada || null,
        item.gatilhos_aplicados || null, item.cor_da_coluna || null
      ]);
    }

    await client.query('COMMIT');
    await loadDicionarioVagas(schema, dicionarioData);

    return { sucesso: true, total: dicionarioData.length };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    return { sucesso: false, erro: err.message };
  } finally {
    client.release();
  }
}

/**
 * Atualiza schemas.json com o schema configurado
 */
function updateSchemasJson(schema, spreadsheetId) {
  try {
    const schemasPath = path.join(__dirname, 'schemas.json');
    let schemasConfig = { schemas: [], autoDetect: true };

    if (fs.existsSync(schemasPath)) {
      schemasConfig = JSON.parse(fs.readFileSync(schemasPath, 'utf8'));
    }

    const existingIndex = schemasConfig.schemas.findIndex(s => s.name === schema);
    const schemaEntry = {
      name: schema,
      spreadsheetId,
      sheetHistoricoVagas: 'Historico vagas',
      sheetHistoricoCandidatos: 'Historico candidatos',
      active: true
    };

    if (existingIndex >= 0) {
      schemasConfig.schemas[existingIndex] = schemaEntry;
    } else {
      schemasConfig.schemas.push(schemaEntry);
    }

    schemasConfig.lastUpdate = new Date().toISOString();
    fs.writeFileSync(schemasPath, JSON.stringify(schemasConfig, null, 2));
    console.log(`schemas.json atualizado: ${schema}`);
  } catch (err) {
    console.error('Erro ao atualizar schemas.json:', err.message);
  }
}

module.exports = {
  runSetup,
  runSetupCandidatos,
  recreateStatus,
  recreateDicionario,
  pool
};

// CLI desabilitado
if (require.main === module) {
  console.error('');
  console.error('========================================');
  console.error('Setup via CLI esta DESABILITADO');
  console.error('========================================');
  console.error('Use POST /setup na API');
  console.error('========================================');
  process.exit(1);
}
