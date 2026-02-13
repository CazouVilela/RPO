/**
 * Config Helper - Le config_sheet do banco - RPO V5
 *
 * A config_sheet armazena TODAS as configuracoes:
 * - Nomes de abas da planilha
 * - Formato de datas
 * - Contagem de dias
 * - Banco e schema
 *
 * config_label -> value (ex: "Aba controle de vagas" -> "Controle de vagas")
 */

const format = require('pg-format');
const { getPool } = require('./db-pool');

// Cache em memoria com TTL
const configCache = {};
const CONFIG_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Carrega todas as configuracoes de config_sheet para um schema
 * @param {string} schema - Nome do schema
 * @returns {Promise<Map<string, string>>}
 */
async function loadConfig(schema) {
  // Verifica cache
  const cached = configCache[schema];
  if (cached && (Date.now() - cached.timestamp) < CONFIG_TTL_MS) {
    return cached.data;
  }

  const pool = getPool();
  const query = format(
    'SELECT config_label, value FROM %I.config_sheet',
    schema
  );

  const result = await pool.query(query);
  const configMap = new Map();

  for (const row of result.rows) {
    configMap.set(row.config_label, row.value);
  }

  // Cacheia
  configCache[schema] = {
    data: configMap,
    timestamp: Date.now()
  };

  return configMap;
}

/**
 * Retorna o valor de uma configuracao especifica
 * @param {string} schema - Nome do schema
 * @param {string} label - config_label
 * @returns {Promise<string|null>}
 */
async function getConfig(schema, label) {
  const config = await loadConfig(schema);
  return config.get(label) || null;
}

/**
 * Retorna o nome da aba correspondente a um config_label
 * @param {string} schema - Nome do schema
 * @param {string} configLabel - Label da aba (ex: "Aba controle de vagas")
 * @returns {Promise<string|null>}
 */
async function getTabName(schema, configLabel) {
  return getConfig(schema, configLabel);
}

/**
 * Retorna todas as configuracoes como objeto plano
 * @param {string} schema - Nome do schema
 * @returns {Promise<Object>}
 */
async function getConfigAsObject(schema) {
  const config = await loadConfig(schema);
  const obj = {};
  for (const [key, value] of config) {
    obj[key] = value;
  }
  return obj;
}

/**
 * Limpa cache de configuracao de um schema
 * @param {string} schema - Nome do schema (null = limpa todos)
 */
function clearConfigCache(schema = null) {
  if (schema) {
    delete configCache[schema];
  } else {
    Object.keys(configCache).forEach(key => delete configCache[key]);
  }
}

module.exports = {
  loadConfig,
  getConfig,
  getTabName,
  getConfigAsObject,
  clearConfigCache
};
