import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import { validateId, validateCreateUpdate, validateQuery, validateMyAccount } from '../validators/users.validator.js';
import { requireCapability, registerCapabilities } from '../../capability.js';

// Capabilities del módulo de usuarios (se registran acá porque es infra del kernel,
// sin manifest; los módulos feature las declaran en su module.manifest.js).
registerCapabilities(['usuarios:read', 'usuarios:create', 'usuarios:update', 'usuarios:toggle', 'usuarios:delete']);

const router = Router();

// La propia cuenta no exige capability: cualquier usuario logueado puede verse y editarse
// a sí mismo (campos personales; el rol/estado se administran desde el ABM).
router.get('/my-account', usersController.getMyAccount);
router.put('/my-account', validateMyAccount, usersController.updateMyAccount);

router.get('/:id', requireCapability('usuarios:read'), validateId, usersController.getUser);
router.get('/', requireCapability('usuarios:read'), validateQuery, usersController.getUsers);
router.post('/', requireCapability('usuarios:create'), validateCreateUpdate, usersController.createUpdateUser);
router.put('/:id', requireCapability('usuarios:update'), [validateId, validateCreateUpdate], usersController.createUpdateUser);
router.patch('/:id/active', requireCapability('usuarios:toggle'), validateId, usersController.toggleActive);
router.delete('/:id', requireCapability('usuarios:delete'), validateId, usersController.deleteUser);

export default router;
