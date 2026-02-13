/**
 * Helpers para Gerenciamento Dinamico de Campos - RPO V5
 *
 * V5: Nomes de colunas do dicionario usam snake_case
 * (nome_fixo, nome_amigavel, campo_utilizado, grupo_do_campo, tipo_do_dado)
 */

const format = require('pg-format');
const { getPool } = require('./db-pool');

const fieldsCache = {};
const fieldsCacheCandidatos = {};

function needsQuotes(fieldName) {
  return /[A-Z]/.test(fieldName);
}

function quoteField(fieldName) {
  return needsQuotes(fieldName) ? `"${fieldName}"` : fieldName;
}

/**
 * Busca todos os campos do historico de vagas de um schema
 */
async function getHistoricoFields(schema) {
  try {
    if (fieldsCache[schema]) {
      return fieldsCache[schema];
    }

    const pool = getPool();
    const query = format(
      `SELECT
        nome_fixo as field_name,
        grupo_do_campo as field_group,
        campo_utilizado as usado
      FROM %I.%I
      WHERE campo_utilizado = 'Sim'
      ORDER BY grupo_do_campo, nome_fixo`,
      schema, 'dicionario_vagas'
    );

    const result = await pool.query(query);

    const fixedFields = [
      { name: 'id', group: 'SISTEMA' },
      { name: 'requisicao', group: 'SISTEMA' },
      { name: 'status', group: 'SISTEMA' },
      { name: 'alterado_por', group: 'SISTEMA' },
      { name: 'created_at', group: 'SISTEMA' },
      { name: 'updated_at', group: 'SISTEMA' },
      { name: 'version', group: 'SISTEMA' }
    ];

    const fixedFieldNames = fixedFields.map(f => f.name);

    const allFields = [
      ...fixedFields.map(f => ({
        name: f.name,
        quoted: quoteField(f.name),
        group: f.group,
        isDynamic: false
      })),
      ...result.rows
        .filter(row => !fixedFieldNames.includes(row.field_name.toLowerCase()))
        .map(row => ({
          name: row.field_name,
          quoted: quoteField(row.field_name),
          group: row.field_group,
          isDynamic: true
        }))
    ];

    fieldsCache[schema] = allFields;
    return allFields;

  } catch (err) {
    console.error(`Erro ao buscar campos do schema ${schema}:`, err.message);
    return [
      { name: 'id', quoted: 'id', group: 'SISTEMA', isDynamic: false },
      { name: 'requisicao', quoted: 'requisicao', group: 'SISTEMA', isDynamic: false },
      { name: 'status', quoted: 'status', group: 'SISTEMA', isDynamic: false },
      { name: 'alterado_por', quoted: 'alterado_por', group: 'SISTEMA', isDynamic: false },
      { name: 'created_at', quoted: 'created_at', group: 'SISTEMA', isDynamic: false },
      { name: 'updated_at', quoted: 'updated_at', group: 'SISTEMA', isDynamic: false },
      { name: 'version', quoted: 'version', group: 'SISTEMA', isDynamic: false }
    ];
  }
}

/**
 * Busca todos os campos do historico de candidatos de um schema
 */
async function getHistoricoCandidatosFields(schema) {
  try {
    if (fieldsCacheCandidatos[schema]) {
      return fieldsCacheCandidatos[schema];
    }

    const pool = getPool();
    const query = format(
      `SELECT
        nome_fixo as field_name,
        grupo_do_campo as field_group,
        campo_utilizado as usado
      FROM %I.%I
      WHERE campo_utilizado = 'Sim'
      ORDER BY grupo_do_campo, nome_fixo`,
      schema, 'dicionario_candidatos'
    );

    const result = await pool.query(query);

    const fixedFields = [
      { name: 'id', group: 'SISTEMA' },
      { name: 'id_candidato', group: 'SISTEMA' },
      { name: 'status_candidato', group: 'SISTEMA' },
      { name: 'status_micro_candidato', group: 'SISTEMA' },
      { name: 'alterado_por', group: 'SISTEMA' },
      { name: 'created_at', group: 'SISTEMA' },
      { name: 'updated_at', group: 'SISTEMA' },
      { name: 'version', group: 'SISTEMA' }
    ];

    const fixedFieldNames = fixedFields.map(f => f.name);

    const allFields = [
      ...fixedFields.map(f => ({
        name: f.name,
        quoted: quoteField(f.name),
        group: f.group,
        isDynamic: false
      })),
      ...result.rows
        .filter(row => !fixedFieldNames.includes(row.field_name.toLowerCase()))
        .map(row => ({
          name: row.field_name,
          quoted: quoteField(row.field_name),
          group: row.field_group,
          isDynamic: true
        }))
    ];

    fieldsCacheCandidatos[schema] = allFields;
    return allFields;

  } catch (err) {
    console.error(`Erro ao buscar campos de candidatos do schema ${schema}:`, err.message);
    return [
      { name: 'id', quoted: 'id', group: 'SISTEMA', isDynamic: false },
      { name: 'id_candidato', quoted: 'id_candidato', group: 'SISTEMA', isDynamic: false },
      { name: 'status_candidato', quoted: 'status_candidato', group: 'SISTEMA', isDynamic: false },
      { name: 'status_micro_candidato', quoted: 'status_micro_candidato', group: 'SISTEMA', isDynamic: false },
      { name: 'alterado_por', quoted: 'alterado_por', group: 'SISTEMA', isDynamic: false },
      { name: 'created_at', quoted: 'created_at', group: 'SISTEMA', isDynamic: false },
      { name: 'updated_at', quoted: 'updated_at', group: 'SISTEMA', isDynamic: false },
      { name: 'version', quoted: 'version', group: 'SISTEMA', isDynamic: false }
    ];
  }
}

async function getFieldsByGroup(schema, group) {
  const allFields = await getHistoricoFields(schema);
  return allFields.filter(f => f.group === group);
}

async function buildUpdateSet(schema, dados, excludeFields = ['id', 'created_at', 'updated_at', 'version'], startIndex = 1) {
  const allFields = await getHistoricoFields(schema);

  const fields = [];
  const values = [];
  let paramIndex = startIndex;

  for (const field of allFields) {
    if (excludeFields.includes(field.name)) continue;
    if (field.name in dados) {
      fields.push(`${field.quoted} = $${paramIndex++}`);
      values.push(dados[field.name]);
    }
  }

  return { setClause: fields.join(', '), values, fieldCount: fields.length };
}

async function buildUpdateSetCandidatos(schema, dados, excludeFields = ['id', 'created_at', 'updated_at', 'version'], startIndex = 1) {
  const allFields = await getHistoricoCandidatosFields(schema);

  const fields = [];
  const values = [];
  let paramIndex = startIndex;

  for (const field of allFields) {
    if (excludeFields.includes(field.name)) continue;
    if (field.name in dados) {
      fields.push(`${field.quoted} = $${paramIndex++}`);
      values.push(dados[field.name]);
    }
  }

  return { setClause: fields.join(', '), values, fieldCount: fields.length };
}

async function buildInsert(schema, dados) {
  const allFields = await getHistoricoFields(schema);

  const columns = [];
  const placeholders = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allFields) {
    if (['id', 'created_at', 'updated_at', 'version'].includes(field.name)) continue;
    if (field.name in dados) {
      columns.push(field.quoted);
      placeholders.push(`$${paramIndex++}`);
      values.push(dados[field.name]);
    }
  }

  return { columns: columns.join(', '), placeholders: placeholders.join(', '), values, fieldCount: columns.length };
}

function clearFieldsCache(schema = null) {
  if (schema) {
    delete fieldsCache[schema];
    delete fieldsCacheCandidatos[schema];
  } else {
    Object.keys(fieldsCache).forEach(key => delete fieldsCache[key]);
    Object.keys(fieldsCacheCandidatos).forEach(key => delete fieldsCacheCandidatos[key]);
  }
}

module.exports = {
  needsQuotes,
  quoteField,
  getHistoricoFields,
  getHistoricoCandidatosFields,
  getFieldsByGroup,
  buildUpdateSet,
  buildUpdateSetCandidatos,
  buildInsert,
  clearFieldsCache
};
