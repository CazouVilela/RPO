/**
 * ROTAS - Historico de Vagas - RPO V5
 *
 * Endpoints:
 * POST   /                    - Inserir linha no historico
 * POST   /proposta-recente    - Buscar proposta recente
 * PATCH  /proposta-status     - Atualizar status da proposta
 * PATCH  /candidatos-dados    - Atualizar dados de candidatos (na shortlist)
 * PATCH  /selecionado-dados   - Atualizar dados do selecionado
 * PATCH  /linha/:id           - Atualizar linha completa
 * GET    /lista               - Listar historico
 */

const express = require('express');
const router = express.Router();
const format = require('pg-format');
const { getPool } = require('../helpers/db-pool');
const { sanitizeSchema, buildQuery } = require('../helpers/db');
const { buildUpdateSet, buildInsert, getHistoricoFields } = require('../helpers/fields');
const {
  validatePostHistoricoVagas,
  validatePropostaRecente,
  validatePropostaStatus,
  validateCandidatosDados,
  validateSelecionadoDados,
  validateLinhaUpdate
} = require('../helpers/validators');
const { validateSchemaBasic } = require('../middleware/validateSchema');
const { TABLES, HTTP_STATUS } = require('../constants');

// Lazy-loaded cache (set by server.js)
let cache = null;
function setCache(c) { cache = c; }

// POST / - Inserir historico de vaga
router.post('/', validateSchemaBasic, validatePostHistoricoVagas, async (req, res) => {
  const startTime = Date.now();

  try {
    const { requisicao, status, ...campos } = req.body;

    if (!requisicao || !status) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'requisicao e status sao obrigatorios' });
    }

    const targetSchema = req.validatedSchema;
    const pool = getPool();

    // Busca funcaoSistema do status
    const statusQuery = buildQuery(targetSchema, TABLES.STATUS_VAGAS,
      'SELECT funcao_sistema FROM %I.%I WHERE status = $1'
    );
    const statusResult = await pool.query(statusQuery, [status]);

    const funcaoSistema = statusResult.rows.length > 0 ? statusResult.rows[0].funcao_sistema : null;
    const funcaoLower = funcaoSistema ? funcaoSistema.toLowerCase() : '';

    // Filtrar campos baseado no status
    const todosOsCampos = await getHistoricoFields(targetSchema);

    const podeStatusProposta = status === 'PROPOSTA' || funcaoLower.includes('cancelada') || funcaoLower.includes('fechada');
    const podeSelecionado = podeStatusProposta;
    const podeCandidatos = funcaoLower.includes('shortlist') || funcaoLower.includes('cancelada') || funcaoLower.includes('fechada');

    const dadosFiltrados = {
      requisicao,
      status,
      alterado_por: campos.alterado_por || 'sistema'
    };

    for (const campo of todosOsCampos) {
      if (campo.isDynamic && campo.name in campos) {
        if (campo.group === 'DADOS_PROPOSTA' && podeStatusProposta) {
          dadosFiltrados[campo.name] = campos[campo.name];
        } else if (campo.group === 'DADOS_SELECIONADO' && podeSelecionado) {
          dadosFiltrados[campo.name] = campos[campo.name];
        } else if (campo.group === 'DADOS_CANDIDATOS' && podeCandidatos) {
          dadosFiltrados[campo.name] = campos[campo.name];
        } else if (!['DADOS_PROPOSTA', 'DADOS_SELECIONADO', 'DADOS_CANDIDATOS'].includes(campo.group)) {
          dadosFiltrados[campo.name] = campos[campo.name];
        }
      }
    }

    // PRIMARIO: Valkey
    if (cache) {
      try {
        const sucesso = await cache.addHistoricoVagas(targetSchema, dadosFiltrados);
        if (sucesso) {
          return res.status(HTTP_STATUS.CREATED).json({
            success: true,
            fonte: 'valkey',
            execution_time_ms: Date.now() - startTime
          });
        }
      } catch (valkeyError) {
        console.warn(`Valkey falhou: ${valkeyError.message}`);
      }
    }

    // FALLBACK: PostgreSQL
    try {
      const { columns, placeholders, values } = await buildInsert(targetSchema, dadosFiltrados);
      const insertQuery = buildQuery(targetSchema, TABLES.HISTORICO_VAGAS,
        `INSERT INTO %I.%I (${columns}, created_at) VALUES (${placeholders}, NOW()) RETURNING id`
      );
      const result = await pool.query(insertQuery, values);

      if (cache) await cache.addToFallbackLog(targetSchema, requisicao);

      return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        linha: result.rows[0].id,
        fonte: 'postgresql',
        execution_time_ms: Date.now() - startTime,
        sync_agendado: true
      });
    } catch (pgError) {
      console.error(`PostgreSQL falhou: ${pgError.message}`);
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

// POST /proposta-recente
router.post('/proposta-recente', validateSchemaBasic, validatePropostaRecente, async (req, res) => {
  const startTime = Date.now();

  try {
    const { requisicao, ordem } = req.body;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    // PRIMARIO: Valkey
    if (cache) {
      try {
        const proposta = await cache.getPropostaRecente(targetSchema, requisicao, ordem);
        if (proposta) {
          return res.json({ existe: true, linha: proposta, fonte: 'valkey', execution_time_ms: Date.now() - startTime });
        }
      } catch (valkeyError) {
        console.warn(`Valkey falhou: ${valkeyError.message}`);
      }
    }

    // FALLBACK: PostgreSQL
    const offset = ordem === 'ultima' ? 0 : 1;
    const safeSchema = sanitizeSchema(targetSchema);
    const selectQuery = format(
      `SELECT h.*, s.funcao_sistema
      FROM %I.%I h
      INNER JOIN %I.%I s ON s.status = h.status
      WHERE h.requisicao = $1 AND LOWER(s.funcao_sistema) LIKE '%%proposta%%'
      ORDER BY h.created_at DESC OFFSET $2 LIMIT 1`,
      safeSchema, TABLES.HISTORICO_VAGAS, safeSchema, TABLES.STATUS_VAGAS
    );

    const result = await pool.query(selectQuery, [requisicao, offset]);

    if (result.rows.length === 0) {
      return res.json({ existe: false, linha: null });
    }

    res.json({ existe: true, linha: result.rows[0], fonte: 'postgresql', execution_time_ms: Date.now() - startTime });

  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ existe: false, error: error.message });
  }
});

// PATCH /proposta-status
router.patch('/proposta-status', validateSchemaBasic, validatePropostaStatus, async (req, res) => {
  const startTime = Date.now();

  try {
    const { requisicao, operacao_status_proposta, ordem } = req.body;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    // PRIMARIO: Valkey
    if (cache) {
      try {
        const sucesso = await cache.updatePropostaStatus(targetSchema, requisicao, operacao_status_proposta, ordem);
        if (sucesso) {
          return res.json({ success: true, fonte: 'valkey', execution_time_ms: Date.now() - startTime });
        }
      } catch (valkeyError) {
        console.warn(`Valkey falhou: ${valkeyError.message}`);
      }
    }

    // FALLBACK: PostgreSQL
    const offset = ordem === 'ultima' ? 0 : 1;
    const safeSchema = sanitizeSchema(targetSchema);
    const updateQuery = format(
      `UPDATE %I.%I h SET operacao_status_proposta = $2, updated_at = NOW()
      WHERE h.id = (
        SELECT h2.id FROM %I.%I h2
        WHERE h2.requisicao = $1 AND h2.status = 'PROPOSTA'
        ORDER BY h2.created_at DESC OFFSET $3 LIMIT 1
      ) RETURNING id`,
      safeSchema, TABLES.HISTORICO_VAGAS, safeSchema, TABLES.HISTORICO_VAGAS
    );

    const result = await pool.query(updateQuery, [requisicao, operacao_status_proposta, offset]);

    if (result.rows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Proposta nao encontrada' });
    }

    if (cache) await cache.addToFallbackLog(targetSchema, requisicao);

    res.json({ success: true, fonte: 'postgresql', execution_time_ms: Date.now() - startTime, sync_agendado: true });

  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// PATCH /candidatos-dados
router.patch('/candidatos-dados', validateSchemaBasic, validateCandidatosDados, async (req, res) => {
  const startTime = Date.now();

  try {
    const { requisicao, dados } = req.body;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    // PRIMARIO: Valkey
    if (cache) {
      try {
        const sucesso = await cache.updateDadosCandidatos(targetSchema, requisicao, dados);
        if (sucesso) {
          return res.json({ success: true, fonte: 'valkey', execution_time_ms: Date.now() - startTime });
        }
      } catch (valkeyError) {
        console.warn(`Valkey falhou: ${valkeyError.message}`);
      }
    }

    // FALLBACK: PostgreSQL
    const todosOsCampos = await getHistoricoFields(targetSchema);
    const camposCandidatos = todosOsCampos.filter(f => f.group === 'DADOS_CANDIDATOS');

    const dadosParaAtualizar = {};
    for (const campo of camposCandidatos) {
      if (campo.name in dados) dadosParaAtualizar[campo.name] = dados[campo.name];
    }

    if (Object.keys(dadosParaAtualizar).length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Nenhum campo para atualizar' });
    }

    const { setClause, values: updateValues } = await buildUpdateSet(targetSchema, dadosParaAtualizar, undefined, 2);
    const values = [requisicao, ...updateValues];

    const safeSchema = sanitizeSchema(targetSchema);
    const updateQuery = format(
      `UPDATE %I.%I h SET ${setClause}, updated_at = NOW()
      WHERE h.id = (
        SELECT h2.id FROM %I.%I h2
        INNER JOIN %I.%I s ON s.status = h2.status
        WHERE h2.requisicao = $1 AND LOWER(s.funcao_sistema) LIKE '%%shortlist%%'
        ORDER BY h2.created_at DESC LIMIT 1
      ) RETURNING id`,
      safeSchema, TABLES.HISTORICO_VAGAS, safeSchema, TABLES.HISTORICO_VAGAS, safeSchema, TABLES.STATUS_VAGAS
    );

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Shortlist nao encontrada' });
    }

    if (cache) await cache.addToFallbackLog(targetSchema, requisicao);

    res.json({ success: true, fonte: 'postgresql', execution_time_ms: Date.now() - startTime, sync_agendado: true });

  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// PATCH /selecionado-dados
router.patch('/selecionado-dados', validateSchemaBasic, validateSelecionadoDados, async (req, res) => {
  const startTime = Date.now();

  try {
    const { requisicao, dados } = req.body;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    // PRIMARIO: Valkey
    if (cache) {
      try {
        const sucesso = await cache.updateDadosSelecionado(targetSchema, requisicao, dados);
        if (sucesso) {
          return res.json({ success: true, fonte: 'valkey', execution_time_ms: Date.now() - startTime });
        }
      } catch (valkeyError) {
        console.warn(`Valkey falhou: ${valkeyError.message}`);
      }
    }

    // FALLBACK: PostgreSQL
    const todosOsCampos = await getHistoricoFields(targetSchema);
    const camposSelecionado = todosOsCampos.filter(f => f.group === 'DADOS_SELECIONADO');

    const dadosParaAtualizar = {};
    for (const campo of camposSelecionado) {
      if (campo.name in dados) dadosParaAtualizar[campo.name] = dados[campo.name];
    }

    if (Object.keys(dadosParaAtualizar).length === 0) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Nenhum campo para atualizar' });
    }

    const { setClause, values: updateValues } = await buildUpdateSet(targetSchema, dadosParaAtualizar, undefined, 2);
    const values = [requisicao, ...updateValues];

    const safeSchema = sanitizeSchema(targetSchema);
    const updateQuery = format(
      `UPDATE %I.%I h SET ${setClause}, updated_at = NOW()
      WHERE h.id = (
        SELECT h2.id FROM %I.%I h2
        WHERE h2.requisicao = $1 AND h2.status = 'PROPOSTA'
        ORDER BY h2.created_at DESC LIMIT 1
      ) RETURNING id`,
      safeSchema, TABLES.HISTORICO_VAGAS, safeSchema, TABLES.HISTORICO_VAGAS
    );

    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ success: false, message: 'Proposta nao encontrada' });
    }

    if (cache) await cache.addToFallbackLog(targetSchema, requisicao);

    res.json({ success: true, fonte: 'postgresql', execution_time_ms: Date.now() - startTime, sync_agendado: true });

  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// PATCH /linha/:id - Atualizar linha completa
router.patch('/linha/:id', validateSchemaBasic, validateLinhaUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    const { dados } = req.body;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    if (!id || isNaN(parseInt(id))) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'ID invalido' });
    }

    const todosOsCampos = await getHistoricoFields(targetSchema);
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

    const { setClause, values: updateValues } = await buildUpdateSet(targetSchema, dadosParaAtualizar);
    const values = [...updateValues, parseInt(id)];
    const idParamIndex = updateValues.length + 1;

    const updateLinhaQuery = buildQuery(targetSchema, TABLES.HISTORICO_VAGAS,
      `UPDATE %I.%I SET ${setClause}, updated_at = NOW() WHERE id = $${idParamIndex} RETURNING *`
    );

    const result = await pool.query(updateLinhaQuery, values);

    if (result.rows.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ error: `Registro com ID ${id} nao encontrado` });
    }

    const linhaAtualizada = result.rows[0];
    if (cache && linhaAtualizada.requisicao) {
      await cache.invalidateCacheForRequisicao(targetSchema, linhaAtualizada.requisicao);
    }

    res.json({ success: true, message: `Linha ${id} atualizada com sucesso`, linha: linhaAtualizada });

  } catch (error) {
    console.error('Erro ao atualizar linha:', error);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

// GET /lista
router.get('/lista', validateSchemaBasic, async (req, res) => {
  const startTime = Date.now();

  try {
    const { requisicao, updated_since_minutes } = req.query;
    const targetSchema = req.validatedSchema;
    const pool = getPool();

    let query;
    let params;

    if (updated_since_minutes) {
      const minutes = parseInt(updated_since_minutes, 10);
      if (isNaN(minutes) || minutes <= 0) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'updated_since_minutes deve ser um numero positivo' });
      }

      if (requisicao) {
        query = buildQuery(targetSchema, TABLES.HISTORICO_VAGAS,
          'SELECT * FROM %I.%I WHERE updated_at >= NOW() - make_interval(mins => $1) AND requisicao = $2 ORDER BY id ASC');
        params = [minutes, requisicao];
      } else {
        query = buildQuery(targetSchema, TABLES.HISTORICO_VAGAS,
          'SELECT * FROM %I.%I WHERE updated_at >= NOW() - make_interval(mins => $1) ORDER BY id ASC');
        params = [minutes];
      }
    } else {
      if (requisicao) {
        query = buildQuery(targetSchema, TABLES.HISTORICO_VAGAS, 'SELECT * FROM %I.%I WHERE requisicao = $1 ORDER BY id ASC');
        params = [requisicao];
      } else {
        query = buildQuery(targetSchema, TABLES.HISTORICO_VAGAS, 'SELECT * FROM %I.%I ORDER BY id ASC');
        params = [];
      }
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      total: result.rows.length,
      linhas: result.rows,
      filtros: { schema: targetSchema, requisicao: requisicao || 'todas', updated_since_minutes: updated_since_minutes || 'sem filtro' },
      execution_time_ms: Date.now() - startTime
    });

  } catch (error) {
    console.error('Erro ao buscar historico:', error);
    res.status(HTTP_STATUS.INTERNAL_ERROR).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.setCache = setCache;
