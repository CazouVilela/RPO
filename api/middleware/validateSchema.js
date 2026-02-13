/**
 * Middleware de Validacao de Schema - RPO V5
 *
 * V5: Aceita schema via header X-Schema, body, query ou params
 * Prefixo padrao: RPO_template_v5
 */

const { sanitizeSchema } = require('../helpers/db');

function validateSchemaMiddleware(options = {}) {
  const { checkExists = false, required = false } = options;

  return async (req, res, next) => {
    try {
      // V5: Aceita schema via X-Schema header alem de body/query/params
      const schemaInput = req.headers['x-schema'] || req.body?.schema || req.query?.schema || req.params?.schema;

      if (!schemaInput) {
        if (required) {
          return res.status(400).json({
            success: false,
            error: 'Schema e obrigatorio',
            hint: 'Forneca o schema via header X-Schema, body.schema, query.schema ou params.schema'
          });
        }

        const defaultSchema = process.env.PGSCHEMA || 'RPO_template_v5';

        try {
          req.validatedSchema = sanitizeSchema(defaultSchema);
          return next();
        } catch (sanitizeError) {
          return res.status(500).json({
            success: false,
            error: 'Schema padrao (.env) e invalido',
            details: sanitizeError.message
          });
        }
      }

      let safeSchema;
      try {
        safeSchema = sanitizeSchema(schemaInput);
      } catch (sanitizeError) {
        return res.status(400).json({
          success: false,
          error: 'Schema invalido',
          details: sanitizeError.message,
          schema_fornecido: schemaInput
        });
      }

      if (checkExists) {
        const { getPool } = require('../helpers/db-pool');
        const pool = getPool();

        try {
          const checkQuery = `
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name = $1
          `;
          const result = await pool.query(checkQuery, [safeSchema]);

          if (result.rows.length === 0) {
            return res.status(404).json({
              success: false,
              error: 'Schema nao encontrado',
              schema: safeSchema,
              hint: 'Execute o setup para criar o schema'
            });
          }
        } catch (dbError) {
          console.error('Erro ao verificar existencia do schema:', dbError.message);
          return res.status(500).json({
            success: false,
            error: 'Erro ao verificar schema no banco',
            details: dbError.message
          });
        }
      }

      req.validatedSchema = safeSchema;
      next();

    } catch (error) {
      console.error('Erro no middleware validateSchema:', error);
      res.status(500).json({
        success: false,
        error: 'Erro interno ao validar schema',
        details: error.message
      });
    }
  };
}

const validateSchemaBasic = validateSchemaMiddleware({ checkExists: false, required: false });
const validateSchemaStrict = validateSchemaMiddleware({ checkExists: true, required: false });
const validateSchemaRequired = validateSchemaMiddleware({ checkExists: false, required: true });
const validateSchemaFull = validateSchemaMiddleware({ checkExists: true, required: true });

module.exports = {
  validateSchemaMiddleware,
  validateSchemaBasic,
  validateSchemaStrict,
  validateSchemaRequired,
  validateSchemaFull
};
