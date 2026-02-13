/**
 * Database Pool Singleton - RPO V5
 */

require('dotenv').config();
const { Pool } = require('pg');

const DEFAULT_POOL_CONFIG = {
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT) || 15432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: parseInt(process.env.PGPOOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.PGPOOL_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.PGPOOL_CONN_TIMEOUT) || 2000
};

let sharedPool = null;

function getPool(config = {}) {
  if (!sharedPool) {
    const poolConfig = { ...DEFAULT_POOL_CONFIG, ...config };
    sharedPool = new Pool(poolConfig);

    sharedPool.on('connect', () => {
      console.log('PostgreSQL: nova conexao no pool');
    });

    sharedPool.on('error', (err) => {
      console.error('PostgreSQL pool error:', err.message);
    });

    console.log(`Pool PostgreSQL criado (max: ${poolConfig.max})`);
  }

  return sharedPool;
}

async function closePool() {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
    console.log('Pool PostgreSQL fechado');
  }
}

async function isPoolConnected() {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getPool,
  closePool,
  isPoolConnected,
  DEFAULT_POOL_CONFIG
};
