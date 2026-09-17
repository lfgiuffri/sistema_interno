import { Router } from 'express';
import multer from 'multer';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/incidencias.controller.js';
import {
    validateId, validateList, validateCreate, validateUpdate, validateEstado, validateClienteId,
    validateCrearTarea
} from '../validators/incidencias.validator.js';

const router = Router();

// Subida en memoria; el límite fino (5 MB imagen / 15 MB adjunto) lo aplica el service.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// Archivos: rutas fijas, antes de /:id.
router.post('/archivos', requireCapability('incidencias:create'), upload.single('archivo'), controller.subirArchivo);
router.get('/archivos/:nombre', requireCapability('incidencias:read'), controller.servirArchivo);
router.delete('/archivos/:id', requireCapability('incidencias:update'), validateId, controller.eliminarArchivo);

// Rutas fijas ANTES de /:id.
router.get('/', requireCapability('incidencias:read'), validateList, controller.list);
router.get('/servicios/:clienteId', requireCapability('incidencias:read'), validateClienteId, controller.serviciosDeCliente);

router.post('/', requireCapability('incidencias:create'), validateCreate, controller.create);
router.get('/:id', requireCapability('incidencias:read'), validateId, controller.getById);
router.put('/:id', requireCapability('incidencias:update'), validateUpdate, controller.update);
// Mover el estado es la acción que le llega al cliente por mail: capability propia.
router.patch('/:id/estado', requireCapability('incidencias:estado'), validateEstado, controller.cambiarEstado);
// Crear la tarea CREA una tarea, así que pide `tareas:create` además de tocar la incidencia.
router.post('/:id/tarea', requireCapability('tareas:create'), validateCrearTarea, controller.crearTarea);
router.delete('/:id', requireCapability('incidencias:delete'), validateId, controller.remove);

export default router;
