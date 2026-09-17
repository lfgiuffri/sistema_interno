import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';
import { AVISOS_INCIDENCIA } from '../models/Cliente.js';

export const validateList = [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('search').optional().isString().trim(),
    query('activo').optional().isIn(['true', 'false', '']),
    validator
];

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateCreate = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 160 }),
    body('contacto').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 160 }),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('El email no es válido'),
    body('telefono').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 60 }),
    body('observaciones').optional({ nullable: true, checkFalsy: true }).isString().trim(),
    // Destinatarios de los avisos de incidencias: lista libre (coma, punto y coma o salto de
    // línea). Se valida el formato al usarla, no acá: un mail mal tipeado no puede impedir
    // guardar el resto de la ficha del cliente.
    body('emailsNotificacion').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    // Qué eventos de incidencia avisan (uno por evento, ver AVISOS_INCIDENCIA del modelo).
    ...AVISOS_INCIDENCIA.map(a => body(a.campo).optional().isBoolean().toBoolean()),
    body('activo').optional().isBoolean(),
    validator
];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateCreate
];

/** Usuarios de portal: el alta pide contraseña, la edición solo si se la quiere cambiar. */
export const validateUsuarioList = [param('id').isInt({ min: 1 }).toInt(), validator];

export const validateUsuarioCreate = [
    param('id').isInt({ min: 1 }).toInt(),
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 160 }),
    body('email').isEmail().withMessage('Email inválido').isLength({ max: 160 }),
    body('password').isString().isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    validator
];

export const validateUsuarioUpdate = [
    param('id').isInt({ min: 1 }).toInt(),
    param('uid').isInt({ min: 1 }).toInt(),
    body('nombre').optional().isString().trim().notEmpty().isLength({ max: 160 }),
    body('email').optional().isEmail().isLength({ max: 160 }),
    body('password').optional({ checkFalsy: true }).isString().isLength({ min: 8 })
        .withMessage('La contraseña debe tener al menos 8 caracteres'),
    validator
];

export const validateUsuarioId = [
    param('id').isInt({ min: 1 }).toInt(),
    param('uid').isInt({ min: 1 }).toInt(),
    validator
];
