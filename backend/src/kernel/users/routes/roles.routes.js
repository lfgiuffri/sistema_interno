import { Router } from 'express';
import * as rolesController from '../controllers/roles.controller.js';
import { validateId, validateCreateUpdate, validateQuery } from '../validators/roles.validator.js';
import { requireCapability, registerCapabilities } from '../../capability.js';

// Capabilities del módulo de roles. Administrar roles ES administrar permisos:
// no existe un permiso especial aparte (decisión del PRD, distinta del sistema legado).
registerCapabilities(['roles:read', 'roles:create', 'roles:update', 'roles:delete']);

const router = Router();

// Catálogo de capabilities + datos para el form de alta (antes de crear el rol).
router.get('/create', requireCapability('roles:create'), rolesController.getCreate);

router.get('/:id', requireCapability('roles:read'), validateId, rolesController.getRole);
router.get('/', requireCapability('roles:read'), validateQuery, rolesController.getRoles);
router.post('/', requireCapability('roles:create'), validateCreateUpdate, rolesController.updateRole);
router.put('/:id', requireCapability('roles:update'), [validateId, validateCreateUpdate], rolesController.updateRole);
router.delete('/:id', requireCapability('roles:delete'), validateId, rolesController.deleteRole);

export default router;
