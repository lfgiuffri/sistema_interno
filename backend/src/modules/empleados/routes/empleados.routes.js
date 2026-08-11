import { Router } from 'express';
import multer from 'multer';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/empleados.controller.js';
import {
    validateId, validateCreate, validateUpdate, validateToma, validateTomaId,
    validateAsignacion, validateArchivoId, validateArchivoDel
} from '../validators/empleados.validator.js';

const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// Descarga ANTES de /:id ("archivos" no debe matchear como id).
router.get('/archivos/:archivoId', requireCapability('empleados-archivos:read'), validateArchivoId, controller.descargarArchivo);

router.get('/', requireCapability('empleados:read'), controller.list);
router.get('/:id', requireCapability('empleados:read'), validateId, controller.ficha);
router.post('/', requireCapability('empleados:create'), validateCreate, controller.create);
router.put('/:id', requireCapability('empleados:update'), validateUpdate, controller.update);
router.patch('/:id/active', requireCapability('empleados:toggle'), validateId, controller.toggle);
router.delete('/:id', requireCapability('empleados:delete'), validateId, controller.remove);

// Vacaciones (capability propia — PRD §4).
router.post('/:id/vacaciones/tomas', requireCapability('vacaciones:manage'), validateToma, controller.addToma);
router.delete('/:id/vacaciones/tomas/:tomaId', requireCapability('vacaciones:manage'), validateTomaId, controller.deleteToma);
router.put('/:id/vacaciones/asignacion', requireCapability('vacaciones:manage'), validateAsignacion, controller.setAsignacion);

// Archivos de la ficha (capability propia).
router.post('/:id/archivos', requireCapability('empleados-archivos:upload'), upload.single('archivo'), validateId, controller.subirArchivo);
router.delete('/:id/archivos/:archivoId', requireCapability('empleados-archivos:delete'), validateArchivoDel, controller.eliminarArchivo);

export default router;
