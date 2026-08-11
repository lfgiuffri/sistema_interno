import { body, param, query } from 'express-validator';
import { validator } from '../../../kernel/index.js';

export const validateEmpleadoId = [
    param('empleadoId').isInt({ min: 1 }),
    validator
];

export const validateSetSueldo = [
    param('empleadoId').isInt({ min: 1 }),
    body('sueldo').isFloat({ min: 0 }).withMessage('El sueldo debe ser un número válido'),
    validator
];

// % puede ser negativo y con decimales (una baja es válida); llega como string o número.
export const validateActualizacion = [
    body('ids').isArray({ min: 1 }).withMessage('No seleccionaste ningún empleado'),
    body('ids.*').isInt({ min: 1 }),
    body('porcentaje').notEmpty().withMessage('Ingresá el porcentaje de actualización'),
    body('overrides').optional().isObject(),
    validator
];

export const validateAumentos = [
    body('ids').isArray({ min: 1 }).withMessage('Elegí al menos un empleado'),
    body('ids.*').isInt({ min: 1 }),
    body('baseAnio').isInt({ min: 2000, max: 2100 }),
    body('baseMes').isInt({ min: 1, max: 12 }),
    body('lineas').isArray({ min: 1 }).withMessage('Cargá al menos un aumento (mes y valor)'),
    body('lineas.*.anio').isInt(),
    body('lineas.*.mes').isInt(),
    body('lineas.*.tipo').isIn(['pct', 'fijo']),
    body('lineas.*.valor').notEmpty(),
    validator
];

export const validatePlanificacionGet = [
    query('anio').optional().isInt(),
    query('mes').optional().isInt(),
    validator
];

export const validatePlanificacionSave = [
    body('anio').isInt({ min: 2000, max: 2100 }),
    body('mes').isInt({ min: 1, max: 12 }),
    body('celdas').isArray(),
    body('celdas.*.empleadoId').isInt({ min: 1 }),
    body('celdas.*.cuentaId').isInt({ min: 1 }),
    body('celdas.*.monto').isFloat({ min: 0 }),
    body('celdas.*.pagado').isBoolean().toBoolean(),
    body('disponibles').isArray(),
    body('disponibles.*.cuentaId').isInt({ min: 1 }),
    body('disponibles.*.monto').isFloat({ min: 0 }),
    validator
];

export const validateCuentaId = [
    param('id').isInt({ min: 1 }),
    validator
];

export const validateCuenta = [
    body('nombre').isString().trim().notEmpty().withMessage('El nombre de la cuenta es obligatorio').isLength({ max: 100 }),
    body('orden').optional().isInt({ min: 0 }).toInt(),
    validator
];

export const validateCuentaUpdate = [
    param('id').isInt({ min: 1 }),
    ...validateCuenta
];
