import { body, param } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

/** Campos comunes de alta/edición de servidor. */
const camposServidor = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 120 }),
    // IPv4/IPv6 o hostname: hay VPS a los que se llega por nombre y no por IP fija.
    body('ip').isString().trim().notEmpty().withMessage('La IP o host es obligatoria').isLength({ max: 45 }),
    body('activo').optional().isBoolean().toBoolean(),
    body('monitorea').optional().isBoolean().toBoolean(),
    body('puertoChequeo').optional().isInt({ min: 1, max: 65535 }).toInt(),
    // null = usar el umbral global.
    body('umbralCpu').optional({ nullable: true }).isInt({ min: 50, max: 100 }).toInt(),
    body('umbralRam').optional({ nullable: true }).isInt({ min: 50, max: 100 }).toInt(),
    body('umbralDisco').optional({ nullable: true }).isInt({ min: 50, max: 100 }).toInt(),
    body('observaciones').optional({ nullable: true }).isString().trim(),
];

export const validateCreate = [...camposServidor, validator];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...camposServidor,
    validator
];

/** Campos comunes de alta/edición de sitio web. */
const camposSitio = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre es obligatorio').isLength({ max: 150 }),
    body('url').isString().trim().notEmpty().withMessage('La URL es obligatoria').isLength({ max: 255 }),
    body('servicioId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('servidorId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('activo').optional().isBoolean().toBoolean(),
    body('verificaMarcador').optional().isBoolean().toBoolean(),
    // Fecha manual. El vacío llega como CADENA vacía —no como null— a propósito: con
    // `optional({ nullable: true })` express-validator considera el null "ausente" y lo saca
    // de `matchedData`, así que el borrado nunca llegaría al service. El service la
    // normaliza a null.
    body('dominioVenceAt')
        .optional()
        .custom((v) => v === '' || /^\d{4}-\d{2}-\d{2}/.test(String(v)))
        .withMessage('La fecha de vencimiento no es válida'),
    body('observacion').optional({ nullable: true }).isString().trim(),
];

export const validateCreateSitio = [...camposSitio, validator];

export const validateUpdateSitio = [
    param('id').isInt({ min: 1 }),
    ...camposSitio,
    validator
];

/** Reporte del agente: porcentajes 0-100 y el detalle de discos. */
export const validateIngesta = [
    body('cpu').isFloat({ min: 0, max: 100 }).toFloat(),
    body('ram').isFloat({ min: 0, max: 100 }).toFloat(),
    body('disco').isFloat({ min: 0, max: 100 }).toFloat(),
    body('discos').optional().isArray({ max: 20 }),
    body('discos.*.montaje').optional().isString().isLength({ max: 60 }),
    body('discos.*.uso').optional().isFloat({ min: 0, max: 100 }).toFloat(),
    body('discos.*.libreGb').optional().isFloat({ min: 0 }).toFloat(),
    body('carga1').optional().isFloat({ min: 0 }).toFloat(),
    body('uptimeSeg').optional().isInt({ min: 0 }).toInt(),
    body('so').optional().isString().isLength({ max: 120 }),
    validator
];
