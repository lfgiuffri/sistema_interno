import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/areas.controller.js';
import { validateList, validateId, validateCreate, validateUpdate } from '../validators/areas.validator.js';

const router = Router();

router.get('/', requireCapability('areas:read'), validateList, controller.list);
router.get('/:id', requireCapability('areas:read'), validateId, controller.getById);
router.post('/', requireCapability('areas:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('areas:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('areas:toggle'), validateId, controller.toggle);
// Reactivar una eliminada = volver a darla de alta → misma capability que create.
router.patch('/:id/restore', requireCapability('areas:create'), validateId, controller.restore);
router.delete('/:id', requireCapability('areas:delete'), validateId, controller.remove);

export default router;
