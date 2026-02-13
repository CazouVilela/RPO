/**
 * VALKEY CACHE - RPO V5
 *
 * Prefixo: RPO_V5:{schema}:...
 * Suporta vagas E candidatos (V4 so tinha vagas no cache)
 */

require('dotenv').config();
const Redis = require('ioredis');
const { VALKEY_KEYS, PREFIX } = require('./constants/valkey-keys');
const { TTL } = require('./constants/timeouts');

const valkey = new Redis({
  host: process.env.VALKEY_HOST || 'localhost',
  port: process.env.VALKEY_PORT || 6379,
  password: process.env.VALKEY_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
  enableReadyCheck: true,
  enableOfflineQueue: true,
  lazyConnect: false
});

valkey.on('connect', () => console.log('Valkey conectado:', new Date().toISOString()));
valkey.on('error', (err) => console.error('Erro no Valkey:', err.message));
valkey.on('ready', () => console.log('Valkey pronto para uso'));

// ========================================
// FUNCOES AUXILIARES
// ========================================

async function getFuncaoSistemaDoStatus(schema, status) {
  try {
    const statusData = await valkey.hget(VALKEY_KEYS.statusVagas(schema), status);
    if (!statusData) return null;
    const parsed = JSON.parse(statusData);
    return parsed.funcao_sistema || null;
  } catch (err) {
    console.error('Erro ao buscar funcao_sistema:', err.message);
    return null;
  }
}

// ========================================
// HISTORICO VAGAS
// ========================================

async function addHistoricoVagas(schema, data) {
  try {
    const timestamp = Date.now();
    const linha = { ...data, cached_at: timestamp };

    const funcaoSistema = await getFuncaoSistemaDoStatus(schema, data.status);
    const funcaoLower = funcaoSistema ? funcaoSistema.toLowerCase() : '';

    const pipeline = valkey.pipeline();
    const linhaStr = JSON.stringify(linha);
    const ttl = TTL.THIRTY_DAYS;

    // Historico geral
    pipeline.zadd(VALKEY_KEYS.histVagas(schema, data.requisicao), timestamp, linhaStr);
    pipeline.expire(VALKEY_KEYS.histVagas(schema, data.requisicao), ttl);

    // Indices por funcao do sistema
    if (data.status === 'PROPOSTA') {
      pipeline.zadd(VALKEY_KEYS.idxProposta(schema, data.requisicao), timestamp, linhaStr);
      pipeline.expire(VALKEY_KEYS.idxProposta(schema, data.requisicao), ttl);
    }

    if (funcaoLower.includes('shortlist')) {
      pipeline.zadd(VALKEY_KEYS.idxShortlist(schema, data.requisicao), timestamp, linhaStr);
      pipeline.expire(VALKEY_KEYS.idxShortlist(schema, data.requisicao), ttl);
    }

    if (funcaoLower.includes('cancelada')) {
      pipeline.zadd(VALKEY_KEYS.idxCancelada(schema, data.requisicao), timestamp, linhaStr);
      pipeline.expire(VALKEY_KEYS.idxCancelada(schema, data.requisicao), ttl);
    }

    if (funcaoLower.includes('fechada')) {
      pipeline.zadd(VALKEY_KEYS.idxFechada(schema, data.requisicao), timestamp, linhaStr);
      pipeline.expire(VALKEY_KEYS.idxFechada(schema, data.requisicao), ttl);
    }

    // Marca para sincronizacao
    pipeline.sadd(VALKEY_KEYS.syncQueue(schema), data.requisicao);

    await pipeline.exec();
    return true;

  } catch (err) {
    console.error('Erro ao adicionar historico vagas no Valkey:', err.message);
    return false;
  }
}

async function getHistoricoVagas(schema, requisicao) {
  try {
    const results = await valkey.zrange(VALKEY_KEYS.histVagas(schema, requisicao), 0, -1);
    return results.map(item => JSON.parse(item));
  } catch (err) {
    console.error('Erro ao buscar historico vagas no Valkey:', err.message);
    return [];
  }
}

async function getPropostaRecente(schema, requisicao, ordem = 'ultima') {
  try {
    const offset = ordem === 'ultima' ? 0 : 1;
    const results = await valkey.zrevrange(VALKEY_KEYS.idxProposta(schema, requisicao), offset, offset);
    if (results.length === 0) return null;
    return JSON.parse(results[0]);
  } catch (err) {
    console.error('Erro ao buscar proposta recente no Valkey:', err.message);
    return null;
  }
}

async function getShortlistRecente(schema, requisicao) {
  try {
    const results = await valkey.zrevrange(VALKEY_KEYS.idxShortlist(schema, requisicao), 0, 0);
    if (results.length === 0) return null;
    return JSON.parse(results[0]);
  } catch (err) {
    return null;
  }
}

async function updatePropostaStatus(schema, requisicao, operacao_status_proposta, ordem) {
  try {
    const proposta = await getPropostaRecente(schema, requisicao, ordem);
    if (!proposta) return false;

    const timestamp = proposta.cached_at || Date.now();

    proposta.operacao_status_proposta = operacao_status_proposta;
    proposta.updated_at = Date.now();

    const pipeline = valkey.pipeline();
    pipeline.zremrangebyscore(VALKEY_KEYS.histVagas(schema, requisicao), timestamp, timestamp);
    pipeline.zremrangebyscore(VALKEY_KEYS.idxProposta(schema, requisicao), timestamp, timestamp);
    pipeline.zadd(VALKEY_KEYS.histVagas(schema, requisicao), timestamp, JSON.stringify(proposta));
    pipeline.zadd(VALKEY_KEYS.idxProposta(schema, requisicao), timestamp, JSON.stringify(proposta));
    pipeline.sadd(VALKEY_KEYS.syncQueue(schema), requisicao);

    await pipeline.exec();
    return true;
  } catch (err) {
    console.error('Erro ao atualizar proposta status no Valkey:', err.message);
    return false;
  }
}

async function updateDadosCandidatos(schema, requisicao, dados) {
  try {
    const shortlist = await getShortlistRecente(schema, requisicao);
    if (!shortlist) return false;

    const timestamp = shortlist.cached_at || Date.now();
    const updated = { ...shortlist, ...dados, updated_at: Date.now() };

    const pipeline = valkey.pipeline();
    pipeline.zremrangebyscore(VALKEY_KEYS.histVagas(schema, requisicao), timestamp, timestamp);
    pipeline.zremrangebyscore(VALKEY_KEYS.idxShortlist(schema, requisicao), timestamp, timestamp);
    pipeline.zadd(VALKEY_KEYS.histVagas(schema, requisicao), timestamp, JSON.stringify(updated));
    pipeline.zadd(VALKEY_KEYS.idxShortlist(schema, requisicao), timestamp, JSON.stringify(updated));
    pipeline.sadd(VALKEY_KEYS.syncQueue(schema), requisicao);

    await pipeline.exec();
    return true;
  } catch (err) {
    console.error('Erro ao atualizar dados candidatos no Valkey:', err.message);
    return false;
  }
}

async function updateDadosSelecionado(schema, requisicao, dados) {
  try {
    const proposta = await getPropostaRecente(schema, requisicao, 'ultima');
    if (!proposta) return false;

    const timestamp = proposta.cached_at || Date.now();
    const updated = { ...proposta, ...dados, updated_at: Date.now() };

    const pipeline = valkey.pipeline();
    pipeline.zremrangebyscore(VALKEY_KEYS.histVagas(schema, requisicao), timestamp, timestamp);
    pipeline.zremrangebyscore(VALKEY_KEYS.idxProposta(schema, requisicao), timestamp, timestamp);
    pipeline.zadd(VALKEY_KEYS.histVagas(schema, requisicao), timestamp, JSON.stringify(updated));
    pipeline.zadd(VALKEY_KEYS.idxProposta(schema, requisicao), timestamp, JSON.stringify(updated));
    pipeline.sadd(VALKEY_KEYS.syncQueue(schema), requisicao);

    await pipeline.exec();
    return true;
  } catch (err) {
    console.error('Erro ao atualizar dados selecionado no Valkey:', err.message);
    return false;
  }
}

// ========================================
// HISTORICO CANDIDATOS
// ========================================

async function addHistoricoCandidatos(schema, data) {
  try {
    const timestamp = Date.now();
    const linha = { ...data, cached_at: timestamp };

    const pipeline = valkey.pipeline();
    const linhaStr = JSON.stringify(linha);
    const ttl = TTL.THIRTY_DAYS;

    pipeline.zadd(VALKEY_KEYS.histCandidatos(schema, data.id_candidato), timestamp, linhaStr);
    pipeline.expire(VALKEY_KEYS.histCandidatos(schema, data.id_candidato), ttl);
    pipeline.sadd(VALKEY_KEYS.syncQueueCandidatos(schema), data.id_candidato);

    await pipeline.exec();
    return true;

  } catch (err) {
    console.error('Erro ao adicionar historico candidatos no Valkey:', err.message);
    return false;
  }
}

async function getHistoricoCandidatos(schema, candidatoId) {
  try {
    const results = await valkey.zrange(VALKEY_KEYS.histCandidatos(schema, candidatoId), 0, -1);
    return results.map(item => JSON.parse(item));
  } catch (err) {
    console.error('Erro ao buscar historico candidatos no Valkey:', err.message);
    return [];
  }
}

// ========================================
// DADOS DE REFERENCIA
// ========================================

async function loadStatusVagas(schema, statusList) {
  try {
    const pipeline = valkey.pipeline();
    const key = VALKEY_KEYS.statusVagas(schema);

    pipeline.del(key);
    for (const item of statusList) {
      pipeline.hset(key, item.status, JSON.stringify(item));
    }
    pipeline.expire(key, TTL.THIRTY_DAYS);

    await pipeline.exec();
    console.log(`Status vagas carregado no Valkey: ${statusList.length} itens`);
    return true;
  } catch (err) {
    console.error('Erro ao carregar status vagas no Valkey:', err.message);
    return false;
  }
}

async function loadStatusCandidatos(schema, statusList) {
  try {
    const pipeline = valkey.pipeline();
    const key = VALKEY_KEYS.statusCandidatos(schema);

    pipeline.del(key);
    for (const item of statusList) {
      pipeline.hset(key, item.status, JSON.stringify(item));
    }
    pipeline.expire(key, TTL.THIRTY_DAYS);

    await pipeline.exec();
    console.log(`Status candidatos carregado no Valkey: ${statusList.length} itens`);
    return true;
  } catch (err) {
    console.error('Erro ao carregar status candidatos no Valkey:', err.message);
    return false;
  }
}

async function loadDicionarioVagas(schema, dicList) {
  try {
    const pipeline = valkey.pipeline();
    const key = VALKEY_KEYS.dicVagas(schema);

    pipeline.del(key);
    for (const item of dicList) {
      pipeline.hset(key, item.nome_fixo, JSON.stringify(item));
    }
    pipeline.expire(key, TTL.THIRTY_DAYS);

    await pipeline.exec();
    console.log(`Dicionario vagas carregado no Valkey: ${dicList.length} itens`);
    return true;
  } catch (err) {
    console.error('Erro ao carregar dicionario vagas no Valkey:', err.message);
    return false;
  }
}

async function loadDicionarioCandidatos(schema, dicList) {
  try {
    const pipeline = valkey.pipeline();
    const key = VALKEY_KEYS.dicCandidatos(schema);

    pipeline.del(key);
    for (const item of dicList) {
      pipeline.hset(key, item.nome_fixo, JSON.stringify(item));
    }
    pipeline.expire(key, TTL.THIRTY_DAYS);

    await pipeline.exec();
    console.log(`Dicionario candidatos carregado no Valkey: ${dicList.length} itens`);
    return true;
  } catch (err) {
    console.error('Erro ao carregar dicionario candidatos no Valkey:', err.message);
    return false;
  }
}

async function loadConfig(schema, configList) {
  try {
    const pipeline = valkey.pipeline();
    const key = VALKEY_KEYS.config(schema);

    pipeline.del(key);
    for (const item of configList) {
      pipeline.hset(key, item.config_label, item.value);
    }
    pipeline.expire(key, TTL.THIRTY_DAYS);

    await pipeline.exec();
    console.log(`Config carregada no Valkey: ${configList.length} itens`);
    return true;
  } catch (err) {
    console.error('Erro ao carregar config no Valkey:', err.message);
    return false;
  }
}

async function getConfig(schema, label) {
  try {
    return await valkey.hget(VALKEY_KEYS.config(schema), label);
  } catch (err) {
    return null;
  }
}

// ========================================
// CONTROLE DE SYNC
// ========================================

async function addToFallbackLog(schema, requisicao) {
  try {
    await valkey.sadd(VALKEY_KEYS.fallbackLog(schema), requisicao);
    return true;
  } catch (err) {
    return false;
  }
}

async function getSyncQueue(schema) {
  try {
    return await valkey.smembers(VALKEY_KEYS.syncQueue(schema));
  } catch (err) {
    return [];
  }
}

async function removeSyncQueue(schema, requisicao) {
  try {
    await valkey.srem(VALKEY_KEYS.syncQueue(schema), requisicao);
    return true;
  } catch (err) {
    return false;
  }
}

async function getSyncQueueCandidatos(schema) {
  try {
    return await valkey.smembers(VALKEY_KEYS.syncQueueCandidatos(schema));
  } catch (err) {
    return [];
  }
}

async function removeSyncQueueCandidatos(schema, candidatoId) {
  try {
    await valkey.srem(VALKEY_KEYS.syncQueueCandidatos(schema), candidatoId);
    return true;
  } catch (err) {
    return false;
  }
}

// ========================================
// INVALIDACAO DE CACHE
// ========================================

async function invalidateCacheForRequisicao(schema, requisicao) {
  try {
    const keys = [
      VALKEY_KEYS.histVagas(schema, requisicao),
      VALKEY_KEYS.idxProposta(schema, requisicao),
      VALKEY_KEYS.idxShortlist(schema, requisicao),
      VALKEY_KEYS.idxCancelada(schema, requisicao),
      VALKEY_KEYS.idxFechada(schema, requisicao)
    ];
    await valkey.del(...keys);
    return true;
  } catch (err) {
    console.error('Erro ao invalidar cache para requisicao:', err.message);
    return false;
  }
}

async function invalidateCacheForCandidato(schema, candidatoId) {
  try {
    await valkey.del(VALKEY_KEYS.histCandidatos(schema, candidatoId));
    return true;
  } catch (err) {
    console.error('Erro ao invalidar cache para candidato:', err.message);
    return false;
  }
}

async function clearHistoricoVagas(schema) {
  try {
    const pattern = VALKEY_KEYS.patterns.allHistVagas(schema);
    let cursor = '0';
    do {
      const [newCursor, keys] = await valkey.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      if (keys.length > 0) await valkey.del(...keys);
    } while (cursor !== '0');
    return true;
  } catch (err) {
    console.error('Erro ao limpar historico vagas:', err.message);
    return false;
  }
}

async function clearHistoricoCandidatos(schema) {
  try {
    const pattern = VALKEY_KEYS.patterns.allHistCand(schema);
    let cursor = '0';
    do {
      const [newCursor, keys] = await valkey.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      if (keys.length > 0) await valkey.del(...keys);
    } while (cursor !== '0');
    return true;
  } catch (err) {
    console.error('Erro ao limpar historico candidatos:', err.message);
    return false;
  }
}

// ========================================
// HEALTH CHECK
// ========================================

async function checkHealth() {
  try {
    const start = Date.now();
    await valkey.ping();
    const latency = Date.now() - start;

    const info = await valkey.info('memory');
    const usedMemory = info.match(/used_memory_human:(.+)/)?.[1]?.trim() || 'N/A';

    return {
      connected: true,
      latency_ms: latency,
      memory: usedMemory
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  valkey,
  // Vagas
  addHistoricoVagas,
  getHistoricoVagas,
  getPropostaRecente,
  getShortlistRecente,
  updatePropostaStatus,
  updateDadosCandidatos,
  updateDadosSelecionado,
  // Candidatos
  addHistoricoCandidatos,
  getHistoricoCandidatos,
  // Dados de referencia
  loadStatusVagas,
  loadStatusCandidatos,
  loadDicionarioVagas,
  loadDicionarioCandidatos,
  loadConfig,
  getConfig,
  // Sync
  addToFallbackLog,
  getSyncQueue,
  removeSyncQueue,
  getSyncQueueCandidatos,
  removeSyncQueueCandidatos,
  // Invalidacao
  invalidateCacheForRequisicao,
  invalidateCacheForCandidato,
  clearHistoricoVagas,
  clearHistoricoCandidatos,
  // Health
  checkHealth
};
