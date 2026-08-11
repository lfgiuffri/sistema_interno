import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/espacios.controller.js';
import {
    validateId, validateCreate, validateUpdate, validateMatriz,
    validateUserId, validateEspaciosUsuario
} from '../validators/espacios.validator.js';

const router = Router();

// Eje usuario ANTES de /:id (si no, "usuario" matchea como id).
router.get('/usuario/:userId', requireCapability('espacios:asignar-usuarios'), validateUserId, controller.espaciosUsuario);
router.put('/usuario/:userId', requireCapability('espacios:asignar-usuarios'), validateEspaciosUsuario, controller.setEspaciosUsuario);

router.get('/', requireCapability('espacios:read'), controller.list);
router.get('/:id', requireCapability('espacios:read'), validateId, controller.getById);
router.post('/', requireCapability('espacios:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('espacios:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('espacios:toggle'), validateId, controller.toggle);
// Reactivar un eliminado = volver a darlo de alta → misma capability que create.
router.patch('/:id/restore', requireCapability('espacios:create'), validateId, controller.restore);
router.delete('/:id', requireCapability('espacios:delete'), validateId, controller.remove);

// Matriz de accesos del eje espacio (capability propia — máxima granularidad, PRD §4).
router.get('/:id/usuarios', requireCapability('espacios:asignar-usuarios'), validateId, controller.matriz);
router.put('/:id/usuarios', requireCapability('espacios:asignar-usuarios'), validateMatriz, controller.setMatriz);

export default router;
