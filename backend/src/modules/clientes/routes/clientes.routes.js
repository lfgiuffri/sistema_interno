import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/clientes.controller.js';
import { validateList, validateId, validateCreate, validateUpdate } from '../validators/clientes.validator.js';

const router = Router();

router.get('/', requireCapability('clientes:read'), validateList, controller.list);
router.get('/:id', requireCapability('clientes:read'), validateId, controller.getById);
router.post('/', requireCapability('clientes:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('clientes:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('clientes:toggle'), validateId, controller.toggle);
// Reactivar una eliminada = volver a darla de alta → misma capability que create.
router.patch('/:id/restore', requireCapability('clientes:create'), validateId, controller.restore);
router.delete('/:id', requireCapability('clientes:delete'), validateId, controller.remove);

export default router;
