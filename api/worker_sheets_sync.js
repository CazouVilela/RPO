/**
 * RPO V5 - Worker de Sincronizacao PostgreSQL -> Google Sheets
 *
 * A cada 60s: le registros atualizados no PostgreSQL
 * Atualiza abas Historico vagas e Historico candidatos na planilha
 * Le formato de data de config_sheet
 */

require('dotenv').config();
const { Pool } = require('pg');
const format = require('pg-format');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { sanitizeSchema, buildQuery } = require('./helpers/db');
const { TABLES } = require('./constants/tables');

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT) || 15432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 5
});

// Google Sheets auth
let sheets = null;

async function initGoogleSheets() {
  try {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!credPath || !fs.existsSync(credPath)) {
      console.error('Google credentials nao encontradas:', credPath);
      return false;
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheets = google.sheets({ version: 'v4', auth });
    console.log('Google Sheets API inicializada');
    return true;
  } catch (err) {
    console.error('Erro ao inicializar Google Sheets:', err.message);
    return false;
  }
}

// Cache de headers
const headersCache = {};
const HEADERS_TTL = 5 * 60 * 1000; // 5 min

async function getSheetHeaders(spreadsheetId, sheetName) {
  const cacheKey = `${spreadsheetId}:${sheetName}`;
  const cached = headersCache[cacheKey];

  if (cached && (Date.now() - cached.timestamp) < HEADERS_TTL) {
    return cached.headers;
  }

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!1:1`
    });

    const headers = response.data.values?.[0] || [];
    headersCache[cacheKey] = { headers, timestamp: Date.now() };
    return headers;
  } catch (err) {
    console.error(`Erro ao buscar headers de ${sheetName}:`, err.message);
    return [];
  }
}

// Cache de config por schema
const configCache = {};

async function getDateFormat(schema) {
  try {
    if (configCache[schema]?.dateFormat) return configCache[schema].dateFormat;

    const result = await pool.query(
      format('SELECT value FROM %I.config_sheet WHERE config_label = $1', schema),
      ['Formato das datas']
    );

    const dateFormat = result.rows[0]?.value || 'Brasileiro';
    if (!configCache[schema]) configCache[schema] = {};
    configCache[schema].dateFormat = dateFormat;
    return dateFormat;
  } catch (err) {
    return 'Brasileiro';
  }
}

function formatDate(date, formato) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);

  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');

  if (formato === 'Brasileiro') {
    return `${day}/${month}/${year} ${hours}:${mins}:${secs}`;
  }
  return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
}

// Cache de mapeamento nomeFixo -> nomeAmigavel
const fieldMappingCache = {};

async function getFieldMapping(schema, tableName) {
  const cacheKey = `${schema}:${tableName}`;
  if (fieldMappingCache[cacheKey]) return fieldMappingCache[cacheKey];

  try {
    const dicTable = tableName === 'historico_vagas' ? 'dicionario_vagas' : 'dicionario_candidatos';
    const result = await pool.query(
      format('SELECT nome_fixo, nome_amigavel FROM %I.%I', schema, dicTable)
    );

    const mapping = {};
    for (const row of result.rows) {
      mapping[row.nome_fixo] = row.nome_amigavel;
    }
    fieldMappingCache[cacheKey] = mapping;
    return mapping;
  } catch (err) {
    console.error(`Erro ao buscar mapping de campos:`, err.message);
    return {};
  }
}

/**
 * Sincroniza uma tabela do PostgreSQL para uma aba do Google Sheets
 */
async function syncTable(schema, spreadsheetId, tableName, sheetName) {
  try {
    // Busca registros atualizados nos ultimos 2 minutos
    const query = format(
      'SELECT * FROM %I.%I WHERE updated_at >= NOW() - INTERVAL \'2 minutes\' ORDER BY id ASC',
      schema, tableName
    );
    const result = await pool.query(query);

    if (result.rows.length === 0) return 0;

    console.log(`[${schema}] ${result.rows.length} registros atualizados em ${tableName}`);

    // Busca headers da planilha
    const headers = await getSheetHeaders(spreadsheetId, sheetName);
    if (headers.length === 0) {
      console.error(`Headers vazios para ${sheetName}`);
      return 0;
    }

    // Busca mapeamento de campos
    const fieldMapping = await getFieldMapping(schema, tableName);
    const dateFormat = await getDateFormat(schema);

    // Mapeia header amigavel -> campo fixo
    const headerToField = {};
    for (const header of headers) {
      // Procura no mapeamento inverso
      for (const [fixo, amigavel] of Object.entries(fieldMapping)) {
        if (amigavel === header) {
          headerToField[header] = fixo;
          break;
        }
      }
      // Campos estruturais
      if (!headerToField[header]) {
        const lower = header.toLowerCase().replace(/\s+/g, '_');
        headerToField[header] = lower;
      }
    }

    // Busca dados existentes da planilha para encontrar linhas a atualizar
    const idColumn = tableName === 'historico_vagas' ? 'requisicao' : 'id_candidato';
    const idHeaderIdx = headers.findIndex(h => {
      const field = headerToField[h];
      return field === idColumn || field === 'id';
    });

    let synced = 0;

    for (const row of result.rows) {
      try {
        // Monta linha de dados na ordem dos headers
        const rowData = headers.map(header => {
          const field = headerToField[header] || header;
          let value = row[field];

          if (value === null || value === undefined) return '';

          // Formata datas
          if (field.includes('_at') || field.includes('data') || field.includes('date')) {
            if (value instanceof Date || (typeof value === 'string' && !isNaN(Date.parse(value)))) {
              value = formatDate(value, dateFormat);
            }
          }

          return String(value);
        });

        // Append a nova linha
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${sheetName}'!A:A`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [rowData] }
        });

        synced++;
      } catch (rowErr) {
        if (rowErr.message?.includes('Quota')) {
          console.warn('Quota do Google Sheets atingida, aguardando...');
          await new Promise(resolve => setTimeout(resolve, 30000));
        } else {
          console.error(`Erro ao sincronizar linha:`, rowErr.message);
        }
      }
    }

    return synced;
  } catch (err) {
    console.error(`Erro ao sincronizar ${tableName} -> ${sheetName}:`, err.message);
    return 0;
  }
}

/**
 * Loop principal
 */
async function mainLoop() {
  if (!sheets) return;

  try {
    const schemasPath = path.join(__dirname, 'schemas.json');
    if (!fs.existsSync(schemasPath)) return;

    const config = JSON.parse(fs.readFileSync(schemasPath, 'utf8'));
    const activeSchemas = config.schemas.filter(s => s.active);

    for (const schema of activeSchemas) {
      // Sync vagas
      const vagasSynced = await syncTable(
        schema.name,
        schema.spreadsheetId,
        'historico_vagas',
        schema.sheetHistoricoVagas || 'Historico vagas'
      );

      // Sync candidatos
      const candSynced = await syncTable(
        schema.name,
        schema.spreadsheetId,
        'historico_candidatos',
        schema.sheetHistoricoCandidatos || 'Historico candidatos'
      );

      if (vagasSynced > 0 || candSynced > 0) {
        console.log(`[${schema.name}] Sync sheets: ${vagasSynced} vagas, ${candSynced} candidatos`);
      }
    }
  } catch (err) {
    console.error('Erro no loop principal sheets sync:', err.message);
  }
}

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

async function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando worker sheets sync...`);
  try { await pool.end(); } catch (err) { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ========================================
// INICIAR
// ========================================

async function start() {
  console.log('');
  console.log('========================================');
  console.log('RPO V5 - Worker Sheets Sync RODANDO');
  console.log('========================================');
  console.log('Sync interval: 60s | Lookback: 2 min');
  console.log('========================================');
  console.log('');

  const ok = await initGoogleSheets();
  if (!ok) {
    console.error('Falha ao inicializar Google Sheets. Worker nao iniciara.');
    process.exit(1);
  }

  // Sync a cada 60s
  setInterval(mainLoop, 60000);

  // Primeira execucao apos 5s
  setTimeout(mainLoop, 5000);
}

start().catch(err => {
  console.error('Erro fatal no worker sheets sync:', err);
  process.exit(1);
});
