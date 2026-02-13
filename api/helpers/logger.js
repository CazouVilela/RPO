/**
 * Logger Sanitizado - Winston com protecao LGPD - RPO V5
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const SENSITIVE_FIELDS = [
  'nome', 'selecionado_nome', 'selecionado_empresa_anterior',
  'genero', 'selecionado_genero', 'pcd', 'selecionado_pcd',
  'diversidade_racial', 'selecionado_diversidade_racial',
  'orientacao_sexual', 'selecionado_orientacao_sexual',
  'password', 'senha', 'token', 'authorization',
  'api_token', 'bearer', 'secret', 'apikey', 'api_key',
  'pgpassword', 'pguser', 'valkey_password'
];

const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9+/=]+/gi,
  /password["\s:=]+[^\s,"]+/gi,
  /token["\s:=]+[^\s,"]+/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
];

function sanitize(obj, depth = 0) {
  if (depth > 10) return '[MAX_DEPTH]';

  if (typeof obj !== 'object' || obj === null) {
    if (typeof obj === 'string') return sanitizeString(obj);
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitize(item, depth + 1));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitize(value, depth + 1);
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  let sanitized = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

function maskToken(token) {
  if (!token || typeof token !== 'string') return '[REDACTED]';
  if (token.length < 10) return '[REDACTED]';
  return `${token.substring(0, 8)}...[REDACTED]`;
}

const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const sanitizedMeta = sanitize(meta);
    const metaStr = Object.keys(sanitizedMeta).length
      ? '\n' + JSON.stringify(sanitizedMeta, null, 2)
      : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
  })
);

const logDir = path.join(__dirname, '..', 'logs');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    }),
    new DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    new DailyRotateFile({
      level: 'error',
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      zippedArchive: true
    })
  ],
  exceptionHandlers: [
    new DailyRotateFile({
      dirname: logDir,
      filename: 'exceptions-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d'
    })
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      dirname: logDir,
      filename: 'rejections-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d'
    })
  ]
});

function logRequest(req, statusCode, duration) {
  logger.info('HTTP Request', {
    method: req.method,
    path: req.path,
    statusCode,
    duration: `${duration}ms`,
    ip: req.ip
  });
}

module.exports = {
  logger,
  sanitize,
  maskToken,
  logRequest
};
