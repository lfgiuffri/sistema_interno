import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/formasFacturacion.controller.js';
import { validateList, validateId, validateCreate, validateUpdate } from '../validators/formasFacturacion.validator.js';

const router = Router();

router.get('/', requireCapability('formas-facturacion:read'), validateList, controller.list);
router.get('/:id', requireCapability('formas-facturacion:read'), validateId, controller.getById);
router.post('/', requireCapability('formas-facturacion:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('formas-facturacion:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('formas-facturacion:toggle'), validateId, controller.toggle);
router.patch('/:id/restore', requireCapability('formas-facturacion:create'), validateId, controller.restore);
router.delete('/:id', requireCapability('formas-facturacion:delete'), validateId, controller.remove);

export default router;
