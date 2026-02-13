/**
 * RPO V5 - Constantes Centralizadas
 */

const TABLES = require('./tables');
const { HTTP_STATUS, HTTP_METHODS, HTTP_HEADERS, RESPONSE_SOURCES } = require('./http');
const { TIMEOUTS, INTERVALS, TTL } = require('./timeouts');
const { RATE_LIMITS, BATCH_SIZES, RETRY_CONFIG } = require('./rate-limits');
const { LIMITS, DEFAULTS } = require('./limits');
const { ERROR_MESSAGES, SUCCESS_MESSAGES, INFO_MESSAGES } = require('./messages');
const { VALKEY_KEYS, buildIndexKeys, PREFIX } = require('./valkey-keys');

module.exports = {
  TABLES,
  HTTP_STATUS,
  HTTP_METHODS,
  HTTP_HEADERS,
  RESPONSE_SOURCES,
  TIMEOUTS,
  INTERVALS,
  TTL,
  RATE_LIMITS,
  BATCH_SIZES,
  RETRY_CONFIG,
  LIMITS,
  DEFAULTS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  INFO_MESSAGES,
  VALKEY_KEYS,
  buildIndexKeys,
  PREFIX
};
