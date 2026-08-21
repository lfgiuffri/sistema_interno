import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/mantenimiento.controller.js';
import {
    validateId, validateCreate, validateUpdate,
    validateCreateSitio, validateUpdateSitio,
    validateCreateVista, validateUpdateVista, validateOrdenVistas, validateVelocidad
} from '../validators/mantenimiento.validator.js';

const router = Router();

router.get('/servidores', requireCapability('servidores:read'), controller.list);
router.post('/servidores', requireCapability('servidores:create'), validateCreate, controller.create);
router.get('/servidores/:id', requireCapability('servidores:read'), validateId, controller.getById);
router.put('/servidores/:id', requireCapability('servidores:update'), validateUpdate, controller.update);
router.post('/servidores/:id/token', requireCapability('servidores:update'), validateId, controller.regenerarToken);
router.patch('/servidores/:id/active', requireCapability('servidores:toggle'), validateId, controller.toggle);
router.delete('/servidores/:id', requireCapability('servidores:delete'), validateId, controller.remove);

// Sitios web. Chequear y consultar el dominio a demanda piden `update`: escriben estado.
router.get('/sitios', requireCapability('sitios:read'), controller.listSitios);
router.post('/sitios', requireCapability('sitios:create'), validateCreateSitio, controller.createSitio);
router.get('/sitios/:id', requireCapability('sitios:read'), validateId, controller.getSitio);
router.put('/sitios/:id', requireCapability('sitios:update'), validateUpdateSitio, controller.updateSitio);
router.post('/sitios/:id/chequear', requireCapability('sitios:update'), validateId, controller.chequearAhora);
router.post('/sitios/:id/dominio', requireCapability('sitios:update'), validateId, controller.consultarDominio);
router.patch('/sitios/:id/active', requireCapability('sitios:toggle'), validateId, controller.toggleSitio);
router.delete('/sitios/:id', requireCapability('sitios:delete'), validateId, controller.removeSitio);

// Vistas de un sitio: las URLs concretas que se chequean. Sin capabilities propias — una vista
// es parte del sitio, y quien puede editar el sitio decide qué se le mira.
//
// ⚠️ `/sitios/vistas/:id` va ANTES de las rutas con `/sitios/:id/...`: si fuera al revés,
// Express matchearía `:id = 'vistas'` y el validator lo rechazaría con un 422 confuso.
router.put('/sitios/vistas/:id', requireCapability('sitios:update'), validateUpdateVista, controller.updateVista);
router.patch('/sitios/vistas/:id/active', requireCapability('sitios:toggle'), validateId, controller.toggleVista);
router.delete('/sitios/vistas/:id', requireCapability('sitios:delete'), validateId, controller.removeVista);

router.get('/sitios/:id/vistas', requireCapability('sitios:read'), validateId, controller.listVistas);
router.post('/sitios/:id/vistas', requireCapability('sitios:update'), validateCreateVista, controller.createVista);
router.put('/sitios/:id/vistas/orden', requireCapability('sitios:update'), validateOrdenVistas, controller.reordenarVistas);

// Velocidad: día / mes / año. Solo lectura, con `sitios:read`.
router.get('/sitios/:id/velocidad', requireCapability('sitios:read'), validateVelocidad, controller.velocidadSitio);

export default router;
