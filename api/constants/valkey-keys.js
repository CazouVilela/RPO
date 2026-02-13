/**
 * Constantes de Chaves do Valkey - RPO V5
 *
 * Prefixo: RPO_V5:{schema}:...
 * Diferenca do V4: prefixo global RPO_V5: para isolar do namespace V4
 */

const PREFIX = process.env.VALKEY_PREFIX || 'RPO_V5';

const VALKEY_KEYS = {
  // Historico vagas
  histVagas: (schema, requisicao) => `${PREFIX}:${schema}:hist_vagas:${requisicao}`,

  // Historico candidatos
  histCandidatos: (schema, candidatoId) => `${PREFIX}:${schema}:hist_cand:${candidatoId}`,

  // Indices por funcao do sistema (vagas)
  idxProposta: (schema, requisicao) => `${PREFIX}:${schema}:idx:proposta:${requisicao}`,
  idxShortlist: (schema, requisicao) => `${PREFIX}:${schema}:idx:shortlist:${requisicao}`,
  idxCancelada: (schema, requisicao) => `${PREFIX}:${schema}:idx:cancelada:${requisicao}`,
  idxFechada: (schema, requisicao) => `${PREFIX}:${schema}:idx:fechada:${requisicao}`,

  // Dados de referencia
  statusVagas: (schema) => `${PREFIX}:${schema}:status_vagas`,
  statusCandidatos: (schema) => `${PREFIX}:${schema}:status_cand`,
  dicVagas: (schema) => `${PREFIX}:${schema}:dic_vagas`,
  dicCandidatos: (schema) => `${PREFIX}:${schema}:dic_cand`,
  config: (schema) => `${PREFIX}:${schema}:config`,

  // Controle de sincronizacao
  fallbackLog: (schema) => `${PREFIX}:${schema}:fallback_log`,
  syncQueue: (schema) => `${PREFIX}:${schema}:sync_queue`,
  syncQueueCandidatos: (schema) => `${PREFIX}:${schema}:sync_queue_cand`,

  // Patterns para busca (wildcards)
  patterns: {
    allHistVagas: (schema) => `${PREFIX}:${schema}:hist_vagas:*`,
    allHistCand: (schema) => `${PREFIX}:${schema}:hist_cand:*`,
    allIdx: (schema) => `${PREFIX}:${schema}:idx:*`,
    allSchema: (schema) => `${PREFIX}:${schema}:*`,
    allPrefix: () => `${PREFIX}:*`
  }
};

const buildIndexKeys = (schema, requisicao) => {
  return {
    proposta: VALKEY_KEYS.idxProposta(schema, requisicao),
    shortlist: VALKEY_KEYS.idxShortlist(schema, requisicao),
    cancelada: VALKEY_KEYS.idxCancelada(schema, requisicao),
    fechada: VALKEY_KEYS.idxFechada(schema, requisicao)
  };
};

module.exports = {
  VALKEY_KEYS,
  buildIndexKeys,
  PREFIX
};
