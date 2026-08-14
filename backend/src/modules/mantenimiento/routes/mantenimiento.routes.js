import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/mantenimiento.controller.js';
import {
    validateId, validateCreate, validateUpdate,
    validateCreateSitio, validateUpdateSitio
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

export default router;
