import { Router } from 'express';
import multer from 'multer';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/documentacion.controller.js';
import {
    validateEspacioId, validateEspacioCreate, validateEspacioUpdate, validateAccesos,
    validateUserId, validateEspaciosUsuario,
    validateEid, validateEidLid, validateListaCreate, validateListaUpdate, validateOrdenListas,
    validateId, validateDocumentoCreate, validateDocumentoUpdate, validateMover,
    validateOrdenDocumentos, validateVersion, validateBuscar, validateArchivoId,
} from '../validators/documentacion.validator.js';

const router = Router();

// Subida en memoria; el límite fino (5 MB imagen / 15 MB adjunto) lo aplica el service.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// ─── Administración de espacios (capability propia: administrar accesos NO es editar docs) ──
router.get('/admin/espacios', requireCapability('doc-espacios:read'), controller.listEspacios);
router.post('/admin/espacios', requireCapability('doc-espacios:create'), validateEspacioCreate, controller.createEspacio);
router.put('/admin/espacios/:id', requireCapability('doc-espacios:update'), validateEspacioUpdate, controller.updateEspacio);
router.patch('/admin/espacios/:id/active', requireCapability('doc-espacios:toggle'), validateEspacioId, controller.toggleEspacio);
router.patch('/admin/espacios/:id/restore', requireCapability('doc-espacios:update'), validateEspacioId, controller.restoreEspacio);
router.delete('/admin/espacios/:id', requireCapability('doc-espacios:delete'), validateEspacioId, controller.removeEspacio);
router.get('/admin/espacios/:id/accesos', requireCapability('doc-espacios:asignar-usuarios'), validateEspacioId, controller.getAccesos);
router.put('/admin/espacios/:id/accesos', requireCapability('doc-espacios:asignar-usuarios'), validateAccesos, controller.setAccesos);
router.get('/admin/usuarios/:userId/espacios', requireCapability('doc-espacios:asignar-usuarios'), validateUserId, controller.getAccesosUsuario);
router.put('/admin/usuarios/:userId/espacios', requireCapability('doc-espacios:asignar-usuarios'), validateEspaciosUsuario, controller.setAccesosUsuario);

// ─── Rutas fijas ANTES de las paramétricas ───────────────────────────────────────────
router.get('/espacios', requireCapability('documentacion:read'), controller.home);
router.get('/buscar', requireCapability('documentacion:read'), validateBuscar, controller.buscar);

// Archivos (imágenes del editor + adjuntos). La capa 2 la exige el controller.
router.post('/archivos', requireCapability('documentacion:update'), upload.single('archivo'), controller.subirArchivo);
router.get('/archivos/:nombre', requireCapability('documentacion:read'), controller.servirArchivo);
router.delete('/archivos/:id', requireCapability('documentacion:update'), validateArchivoId, controller.eliminarArchivo);

// ─── Listas (capa 2 — ver/editar del espacio — la exige el service) ──────────────────
router.get('/espacios/:eid/listas', requireCapability('documentacion:read'), validateEid, controller.listas);
router.post('/espacios/:eid/listas', requireCapability('documentacion:update'), validateListaCreate, controller.createLista);
router.patch('/espacios/:eid/listas/orden', requireCapability('documentacion:update'), validateOrdenListas, controller.ordenarListas);
router.put('/espacios/:eid/listas/:lid', requireCapability('documentacion:update'), validateListaUpdate, controller.updateLista);
router.patch('/espacios/:eid/listas/:lid/active', requireCapability('documentacion:update'), validateEidLid, controller.toggleLista);
router.patch('/espacios/:eid/listas/:lid/restore', requireCapability('documentacion:update'), validateEidLid, controller.restoreLista);
router.delete('/espacios/:eid/listas/:lid', requireCapability('documentacion:update'), validateEidLid, controller.removeLista);

// Documentos de una lista + su reordenamiento.
router.get('/espacios/:eid/listas/:lid/documentos', requireCapability('documentacion:read'), validateEidLid, controller.listDocumentos);
router.patch('/espacios/:eid/listas/:lid/documentos/orden', requireCapability('documentacion:update'), validateOrdenDocumentos, controller.ordenarDocumentos);

// ─── Documentos ──────────────────────────────────────────────────────────────────────
router.post('/documentos', requireCapability('documentacion:create'), validateDocumentoCreate, controller.createDocumento);
router.get('/documentos/:id', requireCapability('documentacion:read'), validateId, controller.getDocumento);
router.put('/documentos/:id', requireCapability('documentacion:update'), validateDocumentoUpdate, controller.updateDocumento);
router.patch('/documentos/:id/mover', requireCapability('documentacion:update'), validateMover, controller.moverDocumento);
router.delete('/documentos/:id', requireCapability('documentacion:delete'), validateId, controller.removeDocumento);
router.get('/documentos/:id/versiones', requireCapability('documentacion:read'), validateId, controller.listVersiones);
router.post('/documentos/:id/versiones/:vid/restaurar', requireCapability('documentacion:update'), validateVersion, controller.restaurarVersion);

export default router;
