import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';
import { ESTADOS_INCIDENCIA } from '../models/Incidencia.js';

export const validateId = [param('id').isInt({ min: 1 }).toInt(), validator];

export const validateList = [
    query('clienteId').optional({ checkFalsy: true }).isInt({ min: 1 }).toInt(),
    query('servicioId').optional({ checkFalsy: true }).isInt({ min: 1 }).toInt(),
    query('estado').optional({ checkFalsy: true }).isString(),
    query('texto').optional({ checkFalsy: true }).isString().isLength({ max: 100 }),
    query('incluirCerradas').optional().isBoolean(),
    validator
];

/**
 * Campos de la incidencia. `servicioId` es opcional Y nullable: null = «consulta general»,
 * que es lo que ve un cliente sin abonos activos ni proyectos con servicio.
 */
const camposIncidencia = [
    body('titulo').isString().trim().notEmpty().withMessage('El título es obligatorio').isLength({ max: 200 }),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 20000 }),
    body('servicioId').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).toInt(),
    body('archivoIds').optional().isArray({ max: 20 }),
    body('archivoIds.*').isInt({ min: 1 }).toInt()
];

export const validateCreate = [
    body('clienteId').isInt({ min: 1 }).withMessage('Elegí el cliente').toInt(),
    ...camposIncidencia,
    validator
];

export const validateUpdate = [param('id').isInt({ min: 1 }).toInt(), ...camposIncidencia, validator];

export const validateEstado = [
    param('id').isInt({ min: 1 }).toInt(),
    body('estado').isIn(ESTADOS_INCIDENCIA).withMessage('Estado inválido'),
    validator
];

export const validateClienteId = [param('clienteId').isInt({ min: 1 }).toInt(), validator];

export const validateCrearTarea = [
    param('id').isInt({ min: 1 }).toInt(),
    body('listaId').isInt({ min: 1 }).withMessage('Elegí la lista donde va la tarea').toInt(),
    // Opcional: es el vencimiento de la tarea Y la fecha estimada que ve el cliente. Se puede
    // cargar después editando la tarea; el cambio le llega igual a la incidencia.
    body('fechaVencimiento').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Fecha inválida'),
    validator
];
