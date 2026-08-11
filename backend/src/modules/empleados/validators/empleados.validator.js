import { body, param } from 'express-validator';
import { validator } from '../../../kernel/index.js';
import { CATEGORIAS_EMPLEADO } from '../models/Empleado.js';

export const validateId = [
    param('id').isInt({ min: 1 }),
    validator
];

/** Ficha (alta/edición). Los opcionales vacíos se normalizan a null en el service. */
const camposFicha = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre completo es obligatorio').isLength({ max: 150 }),
    body('dni').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 20 }),
    body('cuil').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 20 }),
    body('nacionalidad').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 60 }),
    body('fechaNacimiento').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('domicilio').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 200 }),
    body('telefono').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 40 }),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('El correo electrónico no es válido'),
    body('estadoCivil').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 30 }),
    body('cargasFamiliares').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 200 }),
    body('cuNombre').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 150 }),
    body('cuTelefono').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 40 }),
    body('cuParentesco').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 60 }),
    body('fechaIngreso').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('observaciones').optional({ nullable: true, checkFalsy: true }).isString().trim(),
    body('categoria').optional().isIn(CATEGORIAS_EMPLEADO).withMessage('Categoría inválida'),
    body('vacDiasAnuales').optional().isInt({ min: 0 }).toInt(),
    body('areas').optional().isArray(),
    body('areas.*').isInt({ min: 1 })
];

export const validateCreate = [...camposFicha, validator];

export const validateUpdate = [
    param('id').isInt({ min: 1 }),
    ...camposFicha,
    validator
];

export const validateToma = [
    param('id').isInt({ min: 1 }),
    body('fechaDesde').isDate().withMessage('Cargá la fecha de inicio y de fin'),
    body('fechaHasta').isDate().withMessage('Cargá la fecha de inicio y de fin'),
    body('observacion').optional({ nullable: true, checkFalsy: true }).isString().trim().isLength({ max: 255 }),
    validator
];

export const validateTomaId = [
    param('id').isInt({ min: 1 }),
    param('tomaId').isInt({ min: 1 }),
    validator
];

export const validateAsignacion = [
    param('id').isInt({ min: 1 }),
    body('anio').isInt({ min: 2000, max: 2100 }).withMessage('Año inválido'),
    // null/'' = quitar el ajuste; si viene, entero >= 0.
    body('dias').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }).toInt(),
    validator
];

export const validateArchivoId = [
    param('archivoId').isInt({ min: 1 }),
    validator
];

export const validateArchivoDel = [
    param('id').isInt({ min: 1 }),
    param('archivoId').isInt({ min: 1 }),
    validator
];
