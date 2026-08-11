import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';
import { ESTADOS_PROYECTO } from '../models/Proyecto.js';

export const validateList = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('clienteId').optional().isInt({ min: 1 }),
    query('estado').optional().isString(),
    validator
];

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateCreate = [
    body('clienteId').isInt({ min: 1 }).withMessage('Seleccioná un cliente'),
    body('nombre').isString().trim().notEmpty().withMessage('El nombre del proyecto es obligatorio').isLength({ max: 200 }),
    body('servicioId').optional({ nullable: true }).isInt({ min: 0 }),
    body('estado').isIn(ESTADOS_PROYECTO).withMessage('Estado inválido'),
    body('moneda').isIn(['ARS', 'USD']).withMessage('Moneda inválida'),
    body('total').isFloat({ min: 0 }).withMessage('El presupuesto debe ser un número válido'),
    body('fechaConfirmacion').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('fechaOnboarding').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('fechaAprobacionDiseno').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('fechaEstimadaEntrega').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('fechaEntrega').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('observaciones').optional({ nullable: true, checkFalsy: true }).isString().trim(),
    validator
];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateCreate
];

export const validateAddCobranza = [
    param('id').isInt({ min: 1 }),
    body('anio').isInt({ min: 2000, max: 2100 }).withMessage('Año inválido'),
    body('mes').isInt({ min: 1, max: 12 }).withMessage('Mes inválido'),
    body('montoUsd').isFloat({ gt: 0 }).withMessage('El monto en USD debe ser mayor a 0'),
    validator
];

export const validateCobranzaId = [
    param('id').isInt({ min: 1 }),
    param('cobranzaId').isInt({ min: 1 }),
    validator
];

export const validateMonto = [
    param('id').isInt({ min: 1 }),
    param('cobranzaId').isInt({ min: 1 }),
    body('montoUsd').isFloat({ gt: 0 }).withMessage('El monto en USD debe ser mayor a 0'),
    validator
];

export const validateMover = [
    param('id').isInt({ min: 1 }),
    body('cobranzaIds').isArray({ min: 1 }).withMessage('No seleccionaste ninguna cobranza'),
    body('cobranzaIds.*').isInt({ min: 1 }),
    body('anio').isInt({ min: 2000, max: 2100 }).withMessage('Año inválido'),
    body('mes').isInt({ min: 1, max: 12 }).withMessage('Mes inválido'),
    validator
];

export const validateCobrar = [
    param('id').isInt({ min: 1 }),
    param('cobranzaId').isInt({ min: 1 }),
    body('montoPesos').isFloat({ gt: 0 }).withMessage('El monto en pesos a cobrar debe ser mayor a 0'),
    validator
];
