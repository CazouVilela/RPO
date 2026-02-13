/**
 * ROTAS - Historico de Candidatos - RPO V5
 *
 * Endpoints:
 * POST   /          - Inserir linha no historico de candidatos
 * GET    /:id       - Buscar candidato por id_candidato
 * PATCH  /linha/:id - Atualizar linha completa
 * GET    /lista     - Listar historico de candidatos
 */

const express = require('express');
const router = express.Router();
const format = require('pg-format');
const { getPool } = require('../helpers/db-pool');
const { sanitizeSchema, buildQuery } = require('../helpers/db');
const { buildUpdateSetCandidatos, getHistoricoCandidatosFields } = require('../helpers/fields');
const { validatePostHistoricoCandidatos, validateLinhaUpdate } = require('../helpers/validators');
const { validateSchemaBasic } = require('../middleware/validateSchema');
const { TABLES, HTTP_STATUS } = require('../constants');

// Lazy-loaded cache
let cache = null;
function setCache(c) { cache = c; }

// POST / - Inserir historico de candidato
router.post('/', validateSchemaBasic, validatePostHistoricoCandidatos, async (req, res) => {
  const startTime = Date.now();

  try {
    const { id_candidato, status_candidato, status_micro_candidato, alterado_por, ...camposDinamicos } = req.body;

    if (!id_candidato) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'id_candidato e obrigatorio' });
    }

    const targetSchema = req.validatedSchema;
    const pool = getPool();

    const dadosHistorico = {
      id_candidato: String(id_candidato),
      status_candidato: status_candidato || null,
      status_micro_candidato: status_micro_candidato || null,
      alterado_por: alterado_por || 'sistema',
      ...camposDinamicos
    };

    // PRIMARIO: Valkey
    if (cache) {
      try {
        const sucesso = await cache.addHistoricoCandidatos(targetSchema, dadosHistorico);
        if (sucesso) {
          return res.status(HTTP_STATUS.CREATED).json({
            success: true,
            fonte: 'valkey',
            execution_time_ms: Date.now() - startTime
          });
        }
      } catch (valkeyError) {
        console.warn(`Valkey falhou (candidatos): ${valkeyError.message}`);
      }
    }

    // FALLBACK: PostgreSQL
    try {
      const safeSchema = sanitizeSchema(targetSchema);
      const colunas = Object.keys(dadosHistorico).filter(k => dadosHistorico[k] !== null && dadosHistorico[k] !== undefined);
      const valores = colunas.map(k => dadosHistorico[k]);
      const placeholders = colunas.map((_, i) => `$${i + 1}`).join(', ');
      const colunasStr = colunas.map(c => format.ident(c)).join(', ');

      const insertQuery = format(
        `INSERT INTO %I.%I (${colunasStr}, created_at) VALUES (${placeholders}, NOW()) RETURNING id`,
        safeSchema, TABLES.HISTORICO_CANDIDATOS
      );

      const result = await pool.query(insertQuery, valores);

      return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        id: result.rows[0].id,
        fonte: 'postgresql',
        execution_time_ms: Date.now() - startTime,
        sync_agendado: true
      });

    } catch (pgError) {
      console.error(`PostgreSQL falhou (candidatos): ${pgError.message}`);
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        success: false,
        error: 'Valkey e PostgreSQL indisponiveis',
        execution_time_ms: Date.now() - startTime
      });
    }

  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// GET /lista
router.get('/lista', validateSchemaBasic, async (req, res) => {
  const startTime = Date.now();

  try {
    const { id_candidato, updated_since_minutes } = req.query;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    let query;
    let params;

    if (updated_since_minutes) {
      const minutes = parseInt(updated_since_minutes, 10);
      if (isNaN(minutes) || minutes <= 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'updated_since_minutes deve ser um numero positivo' });
      }

      if (id_candidato) {
        query = buildQuery(targetSchema, TABLES.HISTORICO_CANDIDATOS,
          'SELECT * FROM %I.%I WHERE updated_at >= NOW() - make_interval(mins => $1) AND id_candidato = $2 ORDER BY id ASC');
        params = [minutes, id_candidato];
      } else {
        query = buildQuery(targetSchema, TABLES.HISTORICO_CANDIDATOS,
          'SELECT * FROM %I.%I WHERE updated_at >= NOW() - make_interval(mins => $1) ORDER BY id ASC');
        params = [minutes];
      }
    } else {
      if (id_candidato) {
        query = buildQuery(targetSchema, TABLES.HISTORICO_CANDIDATOS, 'SELECT * FROM %I.%I WHERE id_candidato = $1 ORDER BY id ASC');
        params = [id_candidato];
      } else {
        query = buildQuery(targetSchema, TABLES.HISTORICO_CANDIDATOS, 'SELECT * FROM %I.%I ORDER BY id ASC');
        params = [];
      }
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      total: result.rows.length,
      linhas: result.rows,
      filtros: { schema: targetSchema, id_candidato: id_candidato || 'todos', updated_since_minutes: updated_since_minutes || 'sem filtro' },
      execution_time_ms: Date.now() - startTime
    });

  } catch (error) {
    console.error('Erro ao buscar historico de candidatos:', error);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// PATCH /linha/:id - Atualizar linha completa do candidato
router.patch('/linha/:id', validateSchemaBasic, validateLinhaUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    const { dados } = req.body;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    if (!id || isNaN(parseInt(id))) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'ID invalido' });
    }

    const todosOsCampos = await getHistoricoCandidatosFields(targetSchema);
    const camposAtualizaveis = todosOsCampos.filter(f => !['id', 'created_at', 'updated_at', 'version'].includes(f.name));

    const dadosParaAtualizar = {};
    for (const campo of camposAtualizaveis) {
      if (campo.name in dados) {
        const valor = dados[campo.name];
        if (valor !== null && valor !== undefined && valor !== '') {
          dadosParaAtualizar[campo.name] = valor;
        }
      }
    }

    if (Object.keys(dadosParaAtualizar).length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Nenhum campo valido para atualizar' });
    }

    const { setClause, values: updateValues } = await buildUpdateSetCandidatos(targetSchema, dadosParaAtualizar);
    const values = [...updateValues, parseInt(id)];
    const idParamIndex = updateValues.length + 1;

    const updateLinhaQuery = buildQuery(targetSchema, TABLES.HISTORICO_CANDIDATOS,
      `UPDATE %I.%I SET ${setClause}, updated_at = NOW() WHERE id = $${idParamIndex} RETURNING *`
    );

    const result = await pool.query(updateLinhaQuery, values);

    if (result.rows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: `Registro com ID ${id} nao encontrado` });
    }

    const linhaAtualizada = result.rows[0];
    if (cache && linhaAtualizada.id_candidato) {
      await cache.invalidateCacheForCandidato(targetSchema, linhaAtualizada.id_candidato);
    }

    res.json({ success: true, message: `Linha ${id} atualizada com sucesso`, linha: linhaAtualizada });

  } catch (error) {
    console.error('Erro ao atualizar linha de candidato:', error);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.setCache = setCache;
