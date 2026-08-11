import { Router } from 'express';
import multer from 'multer';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/tareas.controller.js';
import {
    validateId, validateEspacioId, validateEspacioLista, validateLista, validateListaUpdate,
    validateListTareas, validateCreate, validateUpdate, validateRapida, validateEstado,
    validateMover, validateArchivoId, validateComentario
} from '../validators/tareas.validator.js';

const router = Router();

// Subida en memoria; el límite fino (5 MB imagen / 15 MB adjunto) lo aplica el service.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// Rutas fijas ANTES de /:id.
router.get('/espacios', requireCapability('tareas:read'), controller.home);
router.get('/asignables', requireCapability('tareas:read'), controller.asignables);
router.get('/resumen', requireCapability('tareas:read'), controller.resumen);

// Listas (capa 2 — espacio ver/editar — la exige el service).
router.get('/espacios/:eid/listas', requireCapability('tareas:read'), validateEspacioId, controller.listas);
router.post('/espacios/:eid/listas', requireCapability('tareas:update'), validateLista, controller.createLista);
router.put('/espacios/:eid/listas/:lid', requireCapability('tareas:update'), validateListaUpdate, controller.updateLista);
router.patch('/espacios/:eid/listas/:lid/active', requireCapability('tareas:update'), validateEspacioLista, controller.toggleLista);
router.patch('/espacios/:eid/listas/:lid/restore', requireCapability('tareas:update'), validateEspacioLista, controller.restoreLista);
router.delete('/espacios/:eid/listas/:lid', requireCapability('tareas:update'), validateEspacioLista, controller.removeLista);

// Listado central de tareas.
router.get('/espacios/:eid/listas/:lid/tareas', requireCapability('tareas:read'), validateListTareas, controller.listTareas);

// Archivos (imágenes del editor + adjuntos genéricos).
router.post('/archivos', requireCapability('tareas:update'), upload.single('archivo'), controller.subirArchivo);
router.get('/archivos/:nombre', requireCapability('tareas:read'), controller.servirArchivo);
router.delete('/archivos/:id', requireCapability('tareas:update'), validateArchivoId, controller.eliminarArchivo);

// Comentarios (comentar solo pide VER el espacio — lo valida el service).
router.delete('/comentarios/:id', requireCapability('tareas:read'), validateArchivoId, controller.deleteComentario);
router.post('/:id/comentarios', requireCapability('tareas:read'), validateComentario, controller.addComentario);

// Tareas.
router.post('/', requireCapability('tareas:create'), validateCreate, controller.create);
router.get('/:id', requireCapability('tareas:read'), validateId, controller.getById);
router.put('/:id', requireCapability('tareas:update'), validateUpdate, controller.update);
router.patch('/:id/rapida', requireCapability('tareas:update'), validateRapida, controller.updateRapida);
router.patch('/:id/estado', requireCapability('tareas:estado'), validateEstado, controller.estado);
router.patch('/:id/mover', requireCapability('tareas:update'), validateMover, controller.mover);
router.delete('/:id', requireCapability('tareas:delete'), validateId, controller.remove);

export default router;
