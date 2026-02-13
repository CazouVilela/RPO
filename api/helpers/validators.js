/**
 * Input Validators - Express-Validator - RPO V5
 */

const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.error('Validacao falhou:', {
      endpoint: `${req.method} ${req.path}`,
      erros: errors.array().map(err => ({
        campo: err.path,
        mensagem: err.msg,
        valor: err.value
      }))
    });

    return res.status(400).json({
      success: false,
      error: 'Validacao falhou',
      details: errors.array().map(err => ({
        campo: err.path,
        mensagem: err.msg,
        valor: err.value
      }))
    });
  }

  next();
};

// Validadores de campos reutilizaveis
const cddFieldValidators = (prefix = '') => [
  body(`${prefix}cdd_totais_SL`).optional({ values: 'falsy' }).isInt({ min: 0 }),
  body(`${prefix}cdd_mulher_SL`).optional({ values: 'falsy' }).isInt({ min: 0 }),
  body(`${prefix}cdd_PCD_SL`).optional({ values: 'falsy' }).isInt({ min: 0 }),
  body(`${prefix}cdd_diversidade_racial_SL`).optional({ values: 'falsy' }).isInt({ min: 0 }),
  body(`${prefix}cdd_diversidade_orientacao_sexual_SL`).optional({ values: 'falsy' }).isInt({ min: 0 })
];

const selecionadoFieldValidators = (prefix = '') => [
  body(`${prefix}selecionado_nome`).optional().trim().isString(),
  body(`${prefix}selecionado_fonte`).optional().trim().isString(),
  body(`${prefix}selecionado_genero`).optional().trim().isString(),
  body(`${prefix}selecionado_PCD`).optional().trim().isString(),
  body(`${prefix}selecionado_diversidade_racial`).optional().trim().isString(),
  body(`${prefix}selecionado_orientacao_sexual`).optional().trim().isString(),
  body(`${prefix}selecionado_tipo`).optional().trim().isString(),
  body(`${prefix}selecionado_empresa_anterior`).optional().trim().isString(),
  body(`${prefix}selecionado_empregado`).optional().trim().isString()
];

// Validadores comuns
const schemaValidator = () =>
  body('schema').optional().trim()
    .matches(/^[a-zA-Z0-9_]+$/).withMessage('Schema deve conter apenas letras, numeros e underscore')
    .isLength({ max: 63 }).withMessage('Schema muito longo (maximo 63 caracteres)');

const requisicaoValidator = () =>
  body('requisicao').notEmpty().withMessage('requisicao e obrigatoria')
    .trim().isString().isLength({ max: 100 });

const statusValidator = () =>
  body('status').notEmpty().withMessage('status e obrigatorio')
    .trim().isString().isLength({ max: 100 });

const ordemValidator = () =>
  body('ordem').notEmpty().withMessage('ordem e obrigatoria')
    .isIn(['ultima', 'penultima']).withMessage('ordem deve ser "ultima" ou "penultima"');

const idParamValidator = () =>
  param('id').notEmpty().withMessage('ID e obrigatorio')
    .isInt({ min: 1 }).withMessage('ID deve ser um inteiro positivo');

const dadosValidator = () =>
  body('dados').optional().isObject().withMessage('dados deve ser um objeto');

// Validadores por endpoint
const validatePostHistoricoVagas = [
  requisicaoValidator(),
  statusValidator(),
  schemaValidator(),
  body('alterado_por').optional().trim().isString().isLength({ max: 255 }),
  ...cddFieldValidators(),
  ...selecionadoFieldValidators(),
  body('operacao_status_proposta').optional().trim().isString(),
  body('operacao_motivo_declinio').optional().trim().isString(),
  handleValidationErrors
];

const validatePostHistoricoCandidatos = [
  body('id_candidato').notEmpty().withMessage('id_candidato e obrigatorio').trim().isString(),
  body('status_candidato').optional().trim().isString(),
  body('status_micro_candidato').optional().trim().isString(),
  schemaValidator(),
  body('alterado_por').optional().trim().isString().isLength({ max: 255 }),
  handleValidationErrors
];

const validatePropostaRecente = [
  requisicaoValidator(),
  ordemValidator(),
  schemaValidator(),
  handleValidationErrors
];

const validatePropostaStatus = [
  requisicaoValidator(),
  body('operacao_status_proposta').notEmpty().withMessage('operacao_status_proposta e obrigatorio').trim().isString(),
  ordemValidator(),
  schemaValidator(),
  handleValidationErrors
];

const validateCandidatosDados = [
  requisicaoValidator(),
  dadosValidator(),
  schemaValidator(),
  ...cddFieldValidators('dados.'),
  handleValidationErrors
];

const validateSelecionadoDados = [
  requisicaoValidator(),
  dadosValidator(),
  schemaValidator(),
  ...selecionadoFieldValidators('dados.'),
  handleValidationErrors
];

const validateLinhaUpdate = [
  idParamValidator(),
  schemaValidator(),
  dadosValidator(),
  body('dados').notEmpty().withMessage('dados e obrigatorio').isObject(),
  handleValidationErrors
];

const validateSetup = [
  body('schema').notEmpty().withMessage('schema e obrigatorio')
    .trim().matches(/^[a-zA-Z0-9_]+$/).isLength({ max: 63 }),
  body('statusData').notEmpty().withMessage('statusData e obrigatorio')
    .isArray({ min: 1 }),
  body('dicionarioData').notEmpty().withMessage('dicionarioData e obrigatorio')
    .isArray({ min: 1 }),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  cddFieldValidators,
  selecionadoFieldValidators,
  schemaValidator,
  requisicaoValidator,
  statusValidator,
  ordemValidator,
  idParamValidator,
  dadosValidator,
  validatePostHistoricoVagas,
  validatePostHistoricoCandidatos,
  validatePropostaRecente,
  validatePropostaStatus,
  validateCandidatosDados,
  validateSelecionadoDados,
  validateLinhaUpdate,
  validateSetup
};
