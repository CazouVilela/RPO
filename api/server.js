/**
 * RPO V5 API - Express Server
 * Porta: 7000
 * Valkey-First Architecture com config_sheet dinamica
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { getPool, closePool } = require('./helpers/db-pool');
const { getConfigAsObject } = require('./helpers/config');
const cache = require('./valkey_cache');
const { validateSchemaBasic, validateSchemaRequired } = require('./middleware/validateSchema');
const { validateSetup } = require('./helpers/validators');
const { TABLES, HTTP_STATUS, RATE_LIMITS, DEFAULTS } = require('./constants');

const app = express();
const PORT = process.env.API_PORT || DEFAULTS.PORT_API;

// Middleware
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Pool PostgreSQL
const pool = getPool();

// ========================================
// AUTENTICACAO
// ========================================

const authenticate = (req, res, next) => {
  const token = req.headers['authorization'];
  const expectedToken = `Bearer ${process.env.API_TOKEN}`;

  if (!token || token.length !== expectedToken.length) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
  }

  const tokenBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expectedToken);

  if (!crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Unauthorized' });
  }

  next();
};

// ========================================
// RATE LIMITING
// ========================================

const rateLimitConfig = {
  validate: { xForwardedForHeader: false }
};

const generalLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOW_ONE_MINUTE,
  max: RATE_LIMITS.GENERAL,
  message: { success: false, error: 'Muitas requisicoes. Tente novamente em alguns segundos.', retry_after_seconds: 60 },
  standardHeaders: true, legacyHeaders: false, ...rateLimitConfig
});

const writeLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOW_ONE_MINUTE,
  max: RATE_LIMITS.WRITE,
  message: { success: false, error: `Muitas requisicoes de escrita. Limite: ${RATE_LIMITS.WRITE}/minuto.`, retry_after_seconds: 60 },
  standardHeaders: true, legacyHeaders: false, ...rateLimitConfig
});

const readLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOW_ONE_MINUTE,
  max: RATE_LIMITS.READ,
  message: { success: false, error: `Muitas requisicoes de leitura. Limite: ${RATE_LIMITS.READ}/minuto.`, retry_after_seconds: 60 },
  standardHeaders: true, legacyHeaders: false, ...rateLimitConfig
});

const setupLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOW_ONE_HOUR,
  max: RATE_LIMITS.SETUP,
  message: { success: false, error: `Limite de setup excedido. Limite: ${RATE_LIMITS.SETUP}/hora.`, retry_after_seconds: 3600 },
  standardHeaders: true, legacyHeaders: false, ...rateLimitConfig
});

app.use(generalLimiter);

// ========================================
// HEALTH CHECK (sem auth)
// ========================================

app.get('/health', async (req, res) => {
  try {
    const pgResult = await pool.query('SELECT NOW() as now');
    const valkeyStatus = await cache.checkHealth();

    res.json({
      status: valkeyStatus.connected ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: { connected: true, time: pgResult.rows[0].now },
      valkey: valkeyStatus,
      api: { version: '5.0.0', port: PORT }
    });
  } catch (error) {
    res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({ status: 'unhealthy', error: error.message });
  }
});

// ========================================
// CONFIG ENDPOINT
// ========================================

app.get('/config', authenticate, validateSchemaBasic, async (req, res) => {
  try {
    const targetSchema = req.validatedSchema;
    const config = await getConfigAsObject(targetSchema);

    res.json({
      success: true,
      schema: targetSchema,
      config,
      total: Object.keys(config).length
    });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// ========================================
// ROTAS
// ========================================

// Historico de vagas
const historicoRoutes = require('./routes/historico');
historicoRoutes.setCache(cache);
app.use('/historico/vagas', authenticate, historicoRoutes);

// Historico de candidatos
const candidatosRoutes = require('./routes/candidatos');
candidatosRoutes.setCache(cache);
app.use('/historico/candidatos', authenticate, candidatosRoutes);

// Monitor
const monitorRoutes = require('./routes/monitor');
app.use('/monitor', monitorRoutes);

// ========================================
// SETUP ENDPOINT
// ========================================

app.post('/setup', setupLimiter, authenticate, validateSchemaRequired, validateSetup, async (req, res) => {
  const startTime = Date.now();
  const { statusData, dicionarioData, spreadsheetId } = req.body;
  const schema = req.validatedSchema;

  if (!statusData || !Array.isArray(statusData) || statusData.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'statusData deve ser um array nao vazio' });
  }

  if (!dicionarioData || !Array.isArray(dicionarioData) || dicionarioData.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'dicionarioData deve ser um array nao vazio' });
  }

  try {
    console.log(`\nIniciando setup remoto: ${schema}`);
    console.log(`Status: ${statusData.length} registros`);
    console.log(`Dicionario: ${dicionarioData.length} colunas`);

    const { runSetup } = require('./setup');
    const sucesso = await runSetup(schema, statusData, dicionarioData, spreadsheetId);

    if (sucesso) {
      res.json({
        success: true,
        schema,
        statusCount: statusData.length,
        dicionarioCount: dicionarioData.length,
        execution_time_ms: Date.now() - startTime
      });
    } else {
      res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: 'Setup falhou. Verifique logs do servidor.' });
    }

  } catch (error) {
    console.error(`Setup falhou:`, error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

app.post('/setup-candidatos', setupLimiter, authenticate, validateSchemaRequired, async (req, res) => {
  const startTime = Date.now();
  const { statusCandidatosData, dicionarioCandidatosData, spreadsheetId } = req.body;
  const schema = req.validatedSchema;

  if (!statusCandidatosData || !Array.isArray(statusCandidatosData) || statusCandidatosData.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'statusCandidatosData deve ser um array nao vazio' });
  }

  if (!dicionarioCandidatosData || !Array.isArray(dicionarioCandidatosData) || dicionarioCandidatosData.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'dicionarioCandidatosData deve ser um array nao vazio' });
  }

  try {
    console.log(`\nIniciando setup candidatos: ${schema}`);

    const { runSetupCandidatos } = require('./setup');
    const sucesso = await runSetupCandidatos(schema, statusCandidatosData, dicionarioCandidatosData, spreadsheetId);

    if (sucesso) {
      res.json({
        success: true,
        schema,
        statusCandidatosCount: statusCandidatosData.length,
        dicionarioCandidatosCount: dicionarioCandidatosData.length,
        execution_time_ms: Date.now() - startTime
      });
    } else {
      res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: 'Setup candidatos falhou.' });
    }

  } catch (error) {
    console.error(`Setup candidatos falhou:`, error.message);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

async function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando...`);
  try {
    await closePool();
    await cache.valkey.quit();
    console.log('Shutdown concluido');
  } catch (err) {
    console.error('Erro no shutdown:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ========================================
// INICIAR SERVIDOR
// ========================================

pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('PostgreSQL erro:', err.message);
    process.exit(1);
  }

  console.log('');
  console.log('========================================');
  console.log('RPO V5 API - RODANDO');
  console.log('========================================');
  console.log(`URL: http://localhost:${PORT}`);
  console.log('Valkey-First Architecture');
  console.log(`Prefix: ${process.env.VALKEY_PREFIX || 'RPO_V5'}`);
  console.log('========================================');
  console.log('');

  app.listen(PORT);
});

module.exports = app;
