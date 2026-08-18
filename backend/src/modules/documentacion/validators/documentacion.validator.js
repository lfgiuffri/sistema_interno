import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

// ─── Espacios de documentación ───────────────────────────────────────────────────────

export const validateEspacioId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateEspacioCreate = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre del espacio es obligatorio').isLength({ max: 100 }),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    body('activo').optional().isBoolean().toBoolean(),
    validator
];

export const validateEspacioUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateEspacioCreate
];

export const validateAccesos = [
    param('id').isInt({ min: 1 }),
    body('accesos').isArray().withMessage('accesos debe ser una lista'),
    body('accesos.*.userId').isInt({ min: 1 }),
    body('accesos.*.ver').isBoolean().toBoolean(),
    body('accesos.*.editar').isBoolean().toBoolean(),
    validator
];

export const validateUserId = [
    param('userId').isInt({ min: 1 }),
    validator
];

export const validateEspaciosUsuario = [
    param('userId').isInt({ min: 1 }),
    body('espacios').isArray().withMessage('espacios debe ser una lista'),
    body('espacios.*.docEspacioId').isInt({ min: 1 }),
    body('espacios.*.ver').isBoolean().toBoolean(),
    body('espacios.*.editar').isBoolean().toBoolean(),
    validator
];

// ─── Listas ──────────────────────────────────────────────────────────────────────────

export const validateEid = [
    param('eid').isInt({ min: 1 }),
    validator
];

export const validateEidLid = [
    param('eid').isInt({ min: 1 }),
    param('lid').isInt({ min: 1 }),
    validator
];

export const validateListaCreate = [
    param('eid').isInt({ min: 1 }),
    body('nombre').isString().trim().notEmpty().withMessage('El título de la lista es obligatorio').isLength({ max: 120 }),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    validator
];

export const validateListaUpdate = [
    param('lid').isInt({ min: 1 }),
    ...validateListaCreate
];

export const validateOrdenListas = [
    param('eid').isInt({ min: 1 }),
    body('ids').isArray({ min: 1 }).withMessage('ids debe ser una lista de identificadores'),
    body('ids.*').isInt({ min: 1 }),
    validator
];

// ─── Documentos ──────────────────────────────────────────────────────────────────────

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateDocumentoCreate = [
    body('docEspacioId').isInt({ min: 1 }),
    body('docListaId').isInt({ min: 1 }),
    body('titulo').isString().trim().notEmpty().withMessage('El título es obligatorio').isLength({ max: 200 }),
    // El cuerpo llega como HTML del editor y se sanea en el service (no se valida su forma acá).
    body('contenido').optional({ nullable: true }).isString(),
    // Adjuntos subidos antes de que el documento existiera (alta con archivos).
    body('archivoIds').optional().isArray(),
    body('archivoIds.*').isInt({ min: 1 }),
    validator
];

export const validateDocumentoUpdate = [
    param('id').isInt({ min: 1 }),
    body('titulo').optional().isString().trim().notEmpty().isLength({ max: 200 }),
    body('contenido').optional({ nullable: true }).isString(),
    validator
];

export const validateMover = [
    param('id').isInt({ min: 1 }),
    body('docEspacioId').isInt({ min: 1 }),
    body('docListaId').isInt({ min: 1 }),
    validator
];

export const validateOrdenDocumentos = [
    param('eid').isInt({ min: 1 }),
    param('lid').isInt({ min: 1 }),
    body('ids').isArray({ min: 1 }).withMessage('ids debe ser una lista de identificadores'),
    body('ids.*').isInt({ min: 1 }),
    validator
];

export const validateVersion = [
    param('id').isInt({ min: 1 }),
    param('vid').isInt({ min: 1 }),
    validator
];

export const validateBuscar = [
    query('q').isString().trim().isLength({ min: 2 }).withMessage('Buscá con al menos 2 caracteres'),
    query('docEspacioId').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validator
];

export const validateArchivoId = [
    param('id').isInt({ min: 1 }),
    validator
];
