import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';
import { ESTADOS_TAREA, PRIORIDADES_TAREA } from '../models/Tarea.js';

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateEspacioId = [
    param('eid').isInt({ min: 1 }),
    validator
];

export const validateEspacioLista = [
    param('eid').isInt({ min: 1 }),
    param('lid').isInt({ min: 1 }),
    validator
];

export const validateLista = [
    param('eid').isInt({ min: 1 }),
    body('nombre').isString().trim().notEmpty().withMessage('El nombre de la lista es obligatorio').isLength({ max: 100 }),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    validator
];

export const validateListaUpdate = [
    param('lid').isInt({ min: 1 }),
    ...validateLista
];

// Filtros del listado (los inválidos se descartan en el service; acá solo formas).
export const validateListTareas = [
    param('eid').isInt({ min: 1 }),
    param('lid').isInt({ min: 1 }),
    query('estado').optional().isString(),
    query('prioridad').optional().isString(),
    query('texto').optional().isString().isLength({ max: 100 }),
    query('asignadoA').optional().isInt({ min: -1 }),
    query('creadoPor').optional().isInt({ min: 0 }),
    query('vencDesde').optional().isDate(),
    query('vencHasta').optional().isDate(),
    query('inicioDesde').optional().isDate(),
    query('inicioHasta').optional().isDate(),
    query('creadaDesde').optional().isDate(),
    query('creadaHasta').optional().isDate(),
    query('soloVencidas').optional().isBoolean(),
    query('sinVencimiento').optional().isBoolean(),
    query('conDescripcion').optional().isBoolean(),
    query('incluirCompletadas').optional().isBoolean(),
    validator
];

/**
 * Análisis de tareas: todo opcional (sin nada, el service usa el mes actual y el año en
 * curso). `e` viaja como texto «1,4» y lo interseca el service contra los espacios visibles.
 */
export const validateAnalisis = [
    query('desde').optional({ checkFalsy: true }).isDate(),
    query('hasta').optional({ checkFalsy: true }).isDate(),
    query('anio').optional({ checkFalsy: true }).isInt({ min: 2000, max: 2100 }),
    query('estancadas').optional({ checkFalsy: true }).isInt({ min: 1, max: 365 }),
    query('e').optional({ checkFalsy: true }).isString().isLength({ max: 500 }),
    validator
];

/** Orden manual de las tareas de una lista: `ids` en el orden nuevo. */
export const validateOrdenTareas = [
    param('eid').isInt({ min: 1 }).toInt(),
    param('lid').isInt({ min: 1 }).toInt(),
    body('ids').isArray({ min: 1 }).withMessage('ids debe ser una lista de identificadores'),
    body('ids.*').isInt({ min: 1 }).toInt(),
    validator
];

/** Ids de un lote (tope 200: más que eso es un script, no un usuario seleccionando). */
const idsDelLote = [
    body('ids').isArray({ min: 1, max: 200 }).withMessage('Elegí al menos una tarea'),
    body('ids.*').isInt({ min: 1 }).toInt()
];

export const validateLoteEstado = [
    ...idsDelLote,
    body('estado').isIn(ESTADOS_TAREA).withMessage('Estado inválido'),
    validator
];

export const validateLoteMover = [
    ...idsDelLote,
    body('listaId').isInt({ min: 1 }).toInt(),
    validator
];

export const validateLoteEliminar = [...idsDelLote, validator];

/** Campos comunes de alta/edición completa. */
const camposTarea = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre de la tarea es obligatorio').isLength({ max: 200 }),
    body('asignadoA').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    body('prioridad').optional().isIn(PRIORIDADES_TAREA).withMessage('Prioridad inválida'),
    body('estado').optional().isIn(ESTADOS_TAREA).withMessage('Estado inválido'),
    body('fechaInicio').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('fechaVencimiento').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('descripcion').optional({ nullable: true, checkFalsy: true }).isString()
];

export const validateCreate = [
    // `listaId` obligatorio salvo que vengan varias listas: el alta acepta las dos formas.
    body('listaId').if(body('listaIds').not().exists()).isInt({ min: 1 }).withMessage('Elegí una lista'),
    // Crear la misma tarea en varias listas (una tarea por lista).
    body('listaIds').optional().isArray({ min: 1, max: 20 }).withMessage('Elegí entre 1 y 20 listas'),
    body('listaIds.*').isInt({ min: 1 }),
    ...camposTarea,
    // Adjuntos subidos durante el alta (todavía sin tarea): el service los liga.
    body('archivoIds').optional().isArray(),
    body('archivoIds.*').isInt({ min: 1 }),
    validator
];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...camposTarea,
    validator
];

// Edición rápida: SOLO estos 4 campos (matchedData whitelistea; descripción/estado no entran).
export const validateRapida = [
    param('id').isInt({ min: 1 }),
    body('nombre').isString().trim().notEmpty().withMessage('El nombre de la tarea es obligatorio').isLength({ max: 200 }),
    body('asignadoA').optional({ nullable: true }).isInt({ min: 0 }).toInt(),
    body('fechaVencimiento').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('prioridad').optional().isIn(PRIORIDADES_TAREA).withMessage('Prioridad inválida'),
    validator
];

// Estado inválido → 422 acá (el legado lo normalizaba a 'abierta' y podía reabrir completadas).
export const validateEstado = [
    param('id').isInt({ min: 1 }),
    body('estado').isIn(ESTADOS_TAREA).withMessage('Estado inválido'),
    validator
];

export const validateMover = [
    param('id').isInt({ min: 1 }),
    body('listaId').isInt({ min: 1 }).withMessage('Elegí la lista destino'),
    validator
];

export const validateClonarTarea = [
    param('id').isInt({ min: 1 }),
    // Sin lista destino se clona en la misma; sin nombre se numera solo («… (copia 2)»).
    body('listaId').optional().isInt({ min: 1 }),
    body('nombre').optional().isString().trim().isLength({ max: 200 }),
    validator
];

export const validateClonarLista = [
    param('eid').isInt({ min: 1 }),
    param('lid').isInt({ min: 1 }),
    body('nombre').optional().isString().trim().isLength({ max: 100 }),
    body('conTareas').optional().isBoolean().toBoolean(),
    validator
];

export const validateComentario = [
    param('id').isInt({ min: 1 }),
    body('texto').isString().trim().notEmpty().withMessage('El comentario no puede estar vacío').isLength({ max: 2000 }),
    validator
];

export const validateArchivoId = [
    param('id').isInt({ min: 1 }),
    validator
];
