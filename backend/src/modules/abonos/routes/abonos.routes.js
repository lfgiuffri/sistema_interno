import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/abonos.controller.js';
import {
    validateList, validateId, validateCreate, validateUpdate,
    validateActualizarPreview, validateActualizarAplicar,
    validateFacturarPreview, validateFacturarAplicar,
    validateFacturacionesList, validateAnular,
} from '../validators/abonos.validator.js';

const router = Router();

// ── Facturaciones (histórico + anulación) — ANTES de /:id para no colisionar ──
router.get('/facturaciones', requireCapability('facturaciones:read'), validateFacturacionesList, controller.facturaciones);
router.post('/facturaciones/:id/anular', requireCapability('facturaciones:anular'), validateAnular, controller.anular);

// ── Flujos de dos pasos ──
router.post('/actualizar/preview', requireCapability('abonos:actualizar-precio'), validateActualizarPreview, controller.actualizarPreview);
router.post('/actualizar', requireCapability('abonos:actualizar-precio'), validateActualizarAplicar, controller.actualizarAplicar);
router.post('/facturar/preview', requireCapability('abonos:facturar'), validateFacturarPreview, controller.facturarPreview);
router.post('/facturar', requireCapability('abonos:facturar'), validateFacturarAplicar, controller.facturarAplicar);

// ── Resumen del listado ──
router.get('/resumen', requireCapability('abonos:read'), validateList, controller.resumen);

// ⚠️ ANTES de `/:id`: con el orden invertido, Express toma «cambios» como un id y el validator
// lo rechaza con un 422 en vez de llegar acá.
router.get('/cambios', requireCapability('abonos:read'), controller.cambios);
// Marcar/desmarcar NO edita el abono, pero sí escribe estado compartido de la empresa, así que
// pide `abonos:update` en vez de `abonos:read`. Se reusa esa capability y no se crea una nueva
// a propósito: una capability nueva nace sin que nadie la tenga y habría que repartirla a mano.
router.post('/cambios/:id/marcar', requireCapability('abonos:update'), validateId, controller.marcarErp);
router.delete('/cambios/:id/marcar', requireCapability('abonos:update'), validateId, controller.desmarcarErp);

// ── CRUD ──
router.get('/', requireCapability('abonos:read'), validateList, controller.list);
router.get('/:id', requireCapability('abonos:read'), validateId, controller.getById);
router.get('/:id/actualizaciones', requireCapability('abonos:read'), validateId, controller.actualizaciones);
router.post('/', requireCapability('abonos:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('abonos:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('abonos:toggle'), validateId, controller.toggle);
router.delete('/:id', requireCapability('abonos:delete'), validateId, controller.remove);

export default router;
