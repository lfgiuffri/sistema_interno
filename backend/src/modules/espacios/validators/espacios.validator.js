import { body, param } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateCreate = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre del espacio es obligatorio').isLength({ max: 100 }),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    body('activo').optional().isBoolean().toBoolean(),
    validator
];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateCreate
];

export const validateMatriz = [
    param('id').isInt({ min: 1 }),
    body('usuarios').isArray().withMessage('usuarios debe ser una lista'),
    body('usuarios.*.userId').isInt({ min: 1 }),
    body('usuarios.*.ver').isBoolean().toBoolean(),
    body('usuarios.*.editar').isBoolean().toBoolean(),
    validator
];

export const validateUserId = [
    param('userId').isInt({ min: 1 }),
    validator
];

export const validateEspaciosUsuario = [
    param('userId').isInt({ min: 1 }),
    body('espacios').isArray().withMessage('espacios debe ser una lista'),
    body('espacios.*.espacioId').isInt({ min: 1 }),
    body('espacios.*.ver').isBoolean().toBoolean(),
    body('espacios.*.editar').isBoolean().toBoolean(),
    validator
];
