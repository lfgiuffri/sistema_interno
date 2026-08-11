import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateList = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('clienteId').optional().isInt({ min: 1 }),
    query('servicioId').optional().isString(),
    query('formaFacturacionId').optional().isInt({ min: 1 }),
    query('moneda').optional().isIn(['ARS', 'USD', '']),
    query('periodoMeses').optional().isInt({ min: 1 }),
    query('activo').optional().isIn(['true', 'false', '']),
    query('estado').optional().isIn(['vencido', 'proximo', 'aldia', '']),
    validator
];

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateCreate = [
    body('clienteId').isInt({ min: 1 }).withMessage('Seleccioná un cliente'),
    body('servicioId').isInt({ min: 1 }).withMessage('Seleccioná un servicio'),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    body('moneda').isIn(['ARS', 'USD']).withMessage('Moneda inválida'),
    body('precio').isFloat({ min: 0 }).withMessage('El precio debe ser un número válido'),
    body('fechaInicio').isDate().withMessage('La fecha de inicio es obligatoria'),
    body('periodoMeses').isInt({ min: 1 }).withMessage('El período de actualización debe ser mayor a 0 meses'),
    body('fechaUltimaActualizacion').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('formaFacturacionId').optional({ nullable: true }).isInt({ min: 0 }),
    body('observaciones').optional({ nullable: true, checkFalsy: true }).isString().trim(),
    body('activo').optional().isBoolean(),
    validator
];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateCreate
];

/** ids[] + operationId comunes de los flujos preview/aplicar. */
const idsRule = body('ids').isArray({ min: 1 }).withMessage('No seleccionaste ningún abono');
const idsEach = body('ids.*').isInt({ min: 1 });
const operationIdRule = body('operationId').isString().trim().isLength({ min: 8, max: 64 })
    .withMessage('Falta el identificador de operación');

export const validateActualizarPreview = [
    idsRule, idsEach,
    body('porcentaje').optional({ nullable: true }).isString().trim(),
    body('cotizacion').optional({ nullable: true }).isString().trim(),
    body('precioUsd').optional({ nullable: true }).isString().trim(),
    body('overrides').optional({ nullable: true }).isObject(),
    validator
];

export const validateActualizarAplicar = [
    ...validateActualizarPreview.slice(0, -1),
    operationIdRule,
    validator
];

export const validateFacturarPreview = [
    idsRule, idsEach,
    body('anio').isInt({ min: 2000, max: 2100 }).withMessage('Año inválido'),
    body('mes').isInt({ min: 1, max: 12 }).withMessage('Mes inválido'),
    validator
];

export const validateFacturarAplicar = [
    ...validateFacturarPreview.slice(0, -1),
    operationIdRule,
    validator
];

export const validateFacturacionesList = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('anio').optional().isInt({ min: 2000, max: 2100 }),
    query('mes').optional().isInt({ min: 1, max: 12 }),
    query('clienteId').optional().isInt({ min: 1 }),
    query('abonoId').optional().isInt({ min: 1 }),
    query('incluirAnuladas').optional().isIn(['true', 'false', '']),
    validator
];

export const validateAnular = [
    param('id').isInt({ min: 1 }),
    body('motivo').isString().trim().notEmpty().withMessage('El motivo de la anulación es obligatorio').isLength({ max: 255 }),
    validator
];
