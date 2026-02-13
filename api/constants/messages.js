/**
 * Constantes de Mensagens - RPO V5
 */

const ERROR_MESSAGES = {
  REQUIRED_FIELDS: (...fields) => `${fields.join(' e ')} sao obrigatorios`,
  INVALID_PARAM: (param) => `Parametro "${param}" invalido`,
  NO_FIELDS_TO_UPDATE: 'Nenhum campo para atualizar',
  NOT_FOUND: (entity) => `${entity} nao encontrado`,
  PROPOSTA_NOT_FOUND: 'Proposta nao encontrada',
  REGISTRO_NOT_FOUND: (id) => `Registro com ID ${id} nao encontrado`,
  SCHEMA_REQUIRED: 'Schema e obrigatorio',
  SCHEMA_INVALID: 'Schema invalido',
  SCHEMA_NOT_FOUND: (schema) => `Schema "${schema}" nao encontrado`,
  CONCURRENCY_CONFLICT: (expected, current) =>
    `Conflito de concorrencia. Version esperada: ${expected}, atual: ${current}`,
  VERSION_REQUIRED: 'Version e obrigatoria para Optimistic Locking',
  VALKEY_UNAVAILABLE: 'Valkey indisponivel',
  POSTGRESQL_UNAVAILABLE: 'PostgreSQL indisponivel',
  BOTH_UNAVAILABLE: 'Valkey e PostgreSQL indisponiveis',
  API_ERROR: (details) => `Erro na API: ${details}`,
  SETUP_FAILED: 'Setup falhou. Verifique logs do servidor.',
  INTERNAL_ERROR: 'Erro interno ao processar requisicao'
};

const SUCCESS_MESSAGES = {
  CREATED: (entity) => `${entity} criado com sucesso`,
  UPDATED: (entity) => `${entity} atualizado com sucesso`,
  DELETED: (entity) => `${entity} deletado com sucesso`,
  SETUP_COMPLETE: 'Setup concluido com sucesso',
  SYNC_SCHEDULED: 'Sincronizacao agendada',
  OPERATION_SUCCESS: 'Operacao realizada com sucesso'
};

const INFO_MESSAGES = {
  USING_FALLBACK: (reason) => `Usando fallback: ${reason}`,
  CACHE_HIT: 'Dados encontrados no cache',
  CACHE_MISS: 'Dados nao encontrados no cache',
  VALKEY_FAILED_USING_PG: 'Valkey falhou, usando PostgreSQL'
};

module.exports = {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  INFO_MESSAGES
};
