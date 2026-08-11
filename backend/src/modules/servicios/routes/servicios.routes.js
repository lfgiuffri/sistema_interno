import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/servicios.controller.js';
import { validateList, validateId, validateCreate, validateUpdate } from '../validators/servicios.validator.js';

const router = Router();

router.get('/', requireCapability('servicios:read'), validateList, controller.list);
router.get('/:id', requireCapability('servicios:read'), validateId, controller.getById);
router.post('/', requireCapability('servicios:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('servicios:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('servicios:toggle'), validateId, controller.toggle);
router.patch('/:id/restore', requireCapability('servicios:create'), validateId, controller.restore);
router.delete('/:id', requireCapability('servicios:delete'), validateId, controller.remove);

export default router;
