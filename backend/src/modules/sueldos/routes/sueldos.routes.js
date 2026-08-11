import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/sueldos.controller.js';
import {
    validateEmpleadoId, validateSetSueldo, validateActualizacion, validateAumentos,
    validatePlanificacionGet, validatePlanificacionSave,
    validateCuentaId, validateCuenta, validateCuentaUpdate
} from '../validators/sueldos.validator.js';

const router = Router();

// Rutas fijas ANTES de /:empleadoId.
router.post('/actualizar/preview', requireCapability('sueldos:actualizar'), validateActualizacion, controller.previewActualizacion);
router.post('/actualizar', requireCapability('sueldos:actualizar'), validateActualizacion, controller.aplicarActualizacion);

router.post('/aumentos/preview', requireCapability('aumentos:read'), validateAumentos, controller.previewAumentos);
router.post('/aumentos', requireCapability('aumentos:manage'), validateAumentos, controller.aplicarAumentos);

router.get('/planificacion', requireCapability('planificacion:read'), validatePlanificacionGet, controller.getPlanificacion);
router.put('/planificacion', requireCapability('planificacion:manage'), validatePlanificacionSave, controller.savePlanificacion);

router.get('/cuentas', requireCapability('cuentas:read'), controller.listCuentas);
router.post('/cuentas', requireCapability('cuentas:create'), validateCuenta, controller.createCuenta);
router.put('/cuentas/:id', requireCapability('cuentas:update'), validateCuentaUpdate, controller.updateCuenta);
router.patch('/cuentas/:id/active', requireCapability('cuentas:toggle'), validateCuentaId, controller.toggleCuenta);
router.patch('/cuentas/:id/restore', requireCapability('cuentas:create'), validateCuentaId, controller.restoreCuenta);
router.delete('/cuentas/:id', requireCapability('cuentas:delete'), validateCuentaId, controller.removeCuenta);

router.get('/', requireCapability('sueldos:read'), controller.list);
router.put('/:empleadoId', requireCapability('sueldos:update'), validateSetSueldo, controller.setSueldo);
router.get('/:empleadoId/historial', requireCapability('sueldos:historial'), validateEmpleadoId, controller.historial);

export default router;
