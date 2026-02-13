/**
 * Database Helpers - Seguranca e Sanitizacao - RPO V5
 */

const format = require('pg-format');

function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'string') {
    throw new Error('Schema e obrigatorio e deve ser string');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
    throw new Error(
      `Schema invalido: "${schema}". Apenas letras, numeros e underscore sao permitidos.`
    );
  }

  if (schema.length > 63) {
    throw new Error('Schema muito longo (maximo 63 caracteres)');
  }

  return schema;
}

function sanitizeTable(table) {
  if (!table || typeof table !== 'string') {
    throw new Error('Tabela e obrigatoria e deve ser string');
  }

  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error(
      `Tabela invalida: "${table}". Apenas letras, numeros e underscore sao permitidos.`
    );
  }

  if (table.length > 63) {
    throw new Error('Nome de tabela muito longo (maximo 63 caracteres)');
  }

  return table;
}

function buildQuery(schema, table, queryTemplate) {
  const safeSchema = sanitizeSchema(schema);
  const safeTable = sanitizeTable(table);
  return format(queryTemplate, safeSchema, safeTable);
}

function buildSchemaQuery(schema, queryTemplate) {
  const safeSchema = sanitizeSchema(schema);
  return format(queryTemplate, safeSchema);
}

function sanitizeArray(values, type = 'text') {
  if (!Array.isArray(values)) {
    throw new Error('Valores devem ser um array');
  }

  if (values.length === 0) {
    return `ARRAY[]::${type}[]`;
  }

  const escapedValues = values.map(v => format.literal(v));
  return `ARRAY[${escapedValues.join(',')}]::${type}[]`;
}

function buildSetClause(data, allowedColumns) {
  const setClauses = [];
  const values = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(data)) {
    if (!allowedColumns.includes(column)) {
      continue;
    }

    setClauses.push(`${format.ident(column)} = $${paramIndex}`);
    values.push(value);
    paramIndex++;
  }

  return { setClauses, values };
}

module.exports = {
  sanitizeSchema,
  sanitizeTable,
  buildQuery,
  buildSchemaQuery,
  sanitizeArray,
  buildSetClause
};
