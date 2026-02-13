/**
 * Constantes de Nomes de Tabelas - RPO V5
 *
 * V5: Nomes de tabelas simplificados (sem prefixos RAW_/USO_)
 * Nomes mapeados da config_sheet da planilha
 */

const TABLES = {
  // Tabelas de vagas
  HISTORICO_VAGAS: 'historico_vagas',
  STATUS_VAGAS: 'status_vagas',
  DICIONARIO_VAGAS: 'dicionario_vagas',

  // Tabelas de candidatos
  HISTORICO_CANDIDATOS: 'historico_candidatos',
  STATUS_CANDIDATOS: 'status_candidatos',
  DICIONARIO_CANDIDATOS: 'dicionario_candidatos',

  // Tabelas auxiliares
  FALLBACK_VAGAS: 'fallback_vagas',
  FALLBACK_CANDIDATOS: 'fallback_candidatos',
  FERIADOS: 'feriados',
  CONFIG_SHEET: 'config_sheet',

  // Controle de sincronizacao
  SYNC_QUEUE: 'sync_queue',
  SYNC_QUEUE_CANDIDATOS: 'sync_queue_candidatos',
  FALLBACK_LOG: 'fallback_log'
};

module.exports = TABLES;
