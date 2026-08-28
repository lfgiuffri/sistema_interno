import { body, param, query } from 'express-validator';
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
    // Qué alertas crea este servidor (todas true por defecto en el modelo).
    body('alertaOffline').optional().isBoolean().toBoolean(),
    body('alertaCpu').optional().isBoolean().toBoolean(),
    body('alertaRam').optional().isBoolean().toBoolean(),
    body('alertaDisco').optional().isBoolean().toBoolean(),
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

/** Campos comunes de alta/edición de una vista de sitio. */
const camposVista = [
    // La ruta la normaliza el service (`/tienda/` → `/tienda`, y acepta una URL completa):
    // acá solo se controla el largo y que sea texto.
    body('ruta').optional().isString().trim().isLength({ max: 190 }),
    body('nombre').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('verificaMarcador').optional().isBoolean().toBoolean(),
    // Cadena vacía = «usá el marcador global». Igual que `dominioVenceAt`: con
    // `optional({ nullable: true })` el null se cae de `matchedData` y el borrado no llegaría
    // nunca al service.
    body('marcadorId')
        .optional()
        .custom((v) => v === '' || /^[A-Za-z][A-Za-z0-9_:-]{0,63}$/.test(String(v)))
        .withMessage('El id del marcador tiene que empezar con una letra y usar solo letras, números, guiones, guiones bajos o dos puntos'),
    body('activo').optional().isBoolean().toBoolean(),
];

export const validateCreateVista = [
    param('id').isInt({ min: 1 }),
    // En el alta la ruta es obligatoria: una vista sin ruta sería un duplicado de la home,
    // que ya existe siempre.
    body('ruta').isString().trim().notEmpty().withMessage('La ruta es obligatoria').isLength({ max: 190 }),
    ...camposVista.slice(1),
    validator
];

export const validateUpdateVista = [
    param('id').isInt({ min: 1 }),
    ...camposVista,
    validator
];

export const validateOrdenVistas = [
    param('id').isInt({ min: 1 }),
    body('ids').isArray({ min: 1, max: 100 }).withMessage('Hace falta la lista de ids'),
    body('ids.*').isInt({ min: 1 }).toInt(),
    validator
];

export const validateVelocidad = [
    param('id').isInt({ min: 1 }),
    query('granularidad').optional().isIn(['hora', 'dia', 'mes', 'anio']).withMessage('La granularidad tiene que ser hora, dia, mes o anio'),
    query('vistaId').optional().isInt({ min: 1 }).toInt(),
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
