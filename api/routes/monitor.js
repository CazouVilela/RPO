/**
 * ROTAS - Monitor de Quotas do Apps Script - RPO V5
 */

const express = require('express');
const router = express.Router();
const { getPool } = require('../helpers/db-pool');

const alertasEnviados = new Map();
const dadosDiarios = new Map();

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticacao nao fornecido' });
  }

  const token = authHeader.substring(7);
  const expectedToken = process.env.API_TOKEN;

  if (!expectedToken || token !== expectedToken) {
    return res.status(401).json({ error: 'Token de autenticacao invalido' });
  }

  next();
}

// POST /monitor/quotas
router.post('/quotas', requireAuth, async (req, res) => {
  try {
    const { data, timestamp, quotas, limites, script_id, timezone } = req.body;

    if (!quotas || !limites) {
      return res.status(400).json({ error: 'Dados incompletos: quotas e limites sao obrigatorios' });
    }

    console.log(`[MONITOR] Recebendo dados de quotas para ${data} (script: ${script_id})`);

    const chaveInstancia = `${data}_${script_id}`;
    let dadosDoDia = dadosDiarios.get(chaveInstancia) || {
      url_fetch: 0, execution_time: 0, triggers_time: 0, email: 0
    };

    for (const [tipo, valor] of Object.entries(quotas)) {
      dadosDoDia[tipo] = (dadosDoDia[tipo] || 0) + valor;
    }

    dadosDiarios.set(chaveInstancia, dadosDoDia);

    const alertasParaEnviar = [];
    for (const [tipo, totalUsado] of Object.entries(dadosDoDia)) {
      const limite = limites[tipo];
      if (!limite || limite === 0) continue;

      const percentual = (totalUsado / limite) * 100;

      if (percentual >= 95) {
        const chaveAlerta = `${tipo}_95_${chaveInstancia}`;
        if (!alertasEnviados.has(chaveAlerta)) {
          alertasParaEnviar.push({ tipo, nivel: 'CRITICO', percentual: 95, usado: totalUsado, limite, percentualReal: percentual.toFixed(1) });
          alertasEnviados.set(chaveAlerta, true);
        }
      } else if (percentual >= 80) {
        const chaveAlerta = `${tipo}_80_${chaveInstancia}`;
        if (!alertasEnviados.has(chaveAlerta)) {
          alertasParaEnviar.push({ tipo, nivel: 'AVISO', percentual: 80, usado: totalUsado, limite, percentualReal: percentual.toFixed(1) });
          alertasEnviados.set(chaveAlerta, true);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Dados de quotas processados',
      data: {
        processado: data,
        acumulado: dadosDoDia,
        alertas_disparados: alertasParaEnviar.length,
        alertas: alertasParaEnviar
      }
    });

  } catch (error) {
    console.error('[MONITOR] Erro ao processar quotas:', error);
    res.status(500).json({ error: 'Erro ao processar dados de quotas', details: error.message });
  }
});

// GET /monitor/status
router.get('/status', requireAuth, (req, res) => {
  res.json({
    success: true,
    data: {
      alertas_enviados: alertasEnviados.size,
      alertas: Array.from(alertasEnviados.entries()).map(([chave]) => ({ chave }))
    }
  });
});

// DELETE /monitor/reset
router.delete('/reset', requireAuth, (req, res) => {
  const quantidadeAntes = alertasEnviados.size;
  alertasEnviados.clear();
  res.json({
    success: true,
    message: 'Historico de alertas limpo',
    data: { alertas_removidos: quantidadeAntes }
  });
});

module.exports = router;
