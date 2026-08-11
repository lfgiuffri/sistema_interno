import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateList = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('activo').optional().isIn(['true', 'false', '']),
    query('areaId').optional().isInt({ min: 1 }),
    validator
];

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateCreate = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 160 }),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    // 0 o null = "sin área" (se normaliza en el service).
    body('areaId').optional({ nullable: true }).isInt({ min: 0 }),
    body('activo').optional().isBoolean(),
    validator
];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateCreate
];
