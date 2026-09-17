import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/clientes.controller.js';
import { validateList, validateId, validateCreate, validateUpdate ,
    validateUsuarioList, validateUsuarioCreate, validateUsuarioUpdate, validateUsuarioId
} from '../validators/clientes.validator.js';

const router = Router();

router.get('/', requireCapability('clientes:read'), validateList, controller.list);
router.get('/:id', requireCapability('clientes:read'), validateId, controller.getById);
router.post('/', requireCapability('clientes:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('clientes:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('clientes:toggle'), validateId, controller.toggle);
// Reactivar una eliminada = volver a darla de alta → misma capability que create.
router.patch('/:id/restore', requireCapability('clientes:create'), validateId, controller.restore);
router.delete('/:id', requireCapability('clientes:delete'), validateId, controller.remove);

// Usuarios de PORTAL del cliente. Capability propia: repartir accesos a gente de afuera no es
// lo mismo que editar la ficha de un cliente.
router.get('/:id/usuarios', requireCapability('clientes:usuarios'), validateUsuarioList, controller.listUsuarios);
router.post('/:id/usuarios', requireCapability('clientes:usuarios'), validateUsuarioCreate, controller.createUsuario);
router.put('/:id/usuarios/:uid', requireCapability('clientes:usuarios'), validateUsuarioUpdate, controller.updateUsuario);
router.patch('/:id/usuarios/:uid/active', requireCapability('clientes:usuarios'), validateUsuarioId, controller.toggleUsuario);
router.delete('/:id/usuarios/:uid', requireCapability('clientes:usuarios'), validateUsuarioId, controller.removeUsuario);

export default router;
