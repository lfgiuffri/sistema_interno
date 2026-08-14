/**
 * Sistema Interno — Validadores del feature `webhooks` (express-validator).
 *
 * Cada endpoint declara su validación; el middleware genérico `validator` corta con 422 si
 * algo no cumple. matchedData() en el controller solo expone los campos whitelisteados.
 */

import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

/** Validación de :id en rutas que operan sobre una suscripción puntual. */
export const validateId = [
    param('id').isInt({ min: 1 }).withMessage('id inválido'),
    validator
];

/** Validación de listado de suscripciones: filtro `active` opcional. */
export const validateListSubscriptions = [
    query('active').optional().isBoolean().withMessage('active debe ser booleano'),
    validator
];

/** Validación de creación de suscripción: url requerida (http/https); events/active opcionales. */
export const validateCreateSubscription = [
    body('url')
        .isString().trim().notEmpty().withMessage('La URL es requerida')
        .isURL({ protocols: ['http', 'https'], require_protocol: true })
        .withMessage('La URL debe ser http(s) válida')
        .isLength({ max: 2048 }),
    // events: array de strings (nombres de evento) o ["*"]. Opcional → default ["*"] en el service.
    body('events').optional().isArray().withMessage('events debe ser un array'),
    body('events.*').optional().isString().trim().notEmpty().isLength({ max: 120 }),
    body('active').optional().isBoolean().toBoolean(),
    validator
];

/** Validación del listado de entregas (log): filtros + paginación opcionales. */
export const validateListDeliveries = [
    query('subscriptionId').optional().isInt({ min: 1 }).toInt(),
    query('status').optional().isIn(['pending', 'success', 'failed']),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validator
];

/** Validación del disparo de prueba: event opcional (default en el controller); payload opcional. */
export const validateTest = [
    body('event').optional().isString().trim().notEmpty().isLength({ max: 120 }),
    body('payload').optional().isObject().withMessage('payload debe ser un objeto'),
    validator
];
