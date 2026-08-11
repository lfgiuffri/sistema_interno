import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/proyectos.controller.js';
import {
    validateList, validateId, validateCreate, validateUpdate,
    validateAddCobranza, validateCobranzaId, validateMonto, validateMover, validateCobrar,
} from '../validators/proyectos.validator.js';

const router = Router();

// Grilla anual global — ANTES de /:id para no colisionar.
router.get('/grilla', requireCapability('cobranzas:read'), controller.grilla);

// ── Proyectos ──
router.get('/', requireCapability('proyectos:read'), validateList, controller.list);
router.get('/:id', requireCapability('proyectos:read'), validateId, controller.getById);
router.post('/', requireCapability('proyectos:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('proyectos:update'), validateUpdate, controller.update);
router.delete('/:id', requireCapability('proyectos:delete'), validateId, controller.remove);

// ── Cobranzas (scoped por proyecto en TODAS las rutas) ──
router.get('/:id/cobranzas', requireCapability('cobranzas:read'), validateId, controller.cobranzas);
router.post('/:id/cobranzas', requireCapability('cobranzas:create'), validateAddCobranza, controller.addCobranza);
router.patch('/:id/cobranzas/mover', requireCapability('cobranzas:mover'), validateMover, controller.mover);
router.patch('/:id/cobranzas/:cobranzaId/monto', requireCapability('cobranzas:update'), validateMonto, controller.updateMonto);
router.post('/:id/cobranzas/:cobranzaId/cobrar', requireCapability('cobranzas:cobrar'), validateCobrar, controller.cobrar);
router.post('/:id/cobranzas/:cobranzaId/descobrar', requireCapability('cobranzas:descobrar'), validateCobranzaId, controller.descobrar);
router.delete('/:id/cobranzas/:cobranzaId', requireCapability('cobranzas:delete'), validateCobranzaId, controller.removeCobranza);

export default router;
