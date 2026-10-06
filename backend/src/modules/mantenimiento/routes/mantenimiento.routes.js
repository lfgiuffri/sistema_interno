import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/mantenimiento.controller.js';
import {
    validateId, validateCreate, validateUpdate,
    validateCreateSitio, validateUpdateSitio,
    validateCreateVista, validateUpdateVista, validateOrdenVistas, validateVelocidad,
    validateConfigBd, validateConfigDeploy, validateAnalizarSql, validateCrearTrabajos,
    validateListTrabajos
} from '../validators/mantenimiento.validator.js';

const router = Router();

router.get('/servidores', requireCapability('servidores:read'), controller.list);
router.post('/servidores', requireCapability('servidores:create'), validateCreate, controller.create);
router.get('/servidores/:id', requireCapability('servidores:read'), validateId, controller.getById);
router.put('/servidores/:id', requireCapability('servidores:update'), validateUpdate, controller.update);
router.post('/servidores/:id/token', requireCapability('servidores:update'), validateId, controller.regenerarToken);
router.patch('/servidores/:id/active', requireCapability('servidores:toggle'), validateId, controller.toggle);
router.delete('/servidores/:id', requireCapability('servidores:delete'), validateId, controller.remove);

/* ── FullGlass: configuración y ejecución ──────────────────────────────────────────────
 *
 * CUATRO capabilities, dos por función, porque configurar y ejecutar son riesgos distintos:
 * el comando de deploy corre COMO ROOT en el VPS, así que quien puede editarlo puede hacer
 * cualquier cosa ahí adentro — no tiene por qué ser el mismo que aprieta el botón.
 *
 * Los campos sensibles viven en estos endpoints y NO en el PUT del servidor: como `matchedData`
 * whitelistea, alguien con `servidores:update` no puede setear un comando ni la ruta a recorrer
 * aunque los mande en el body.
 */
router.get('/servidores/:id/sitios', requireCapability('servidores:bd-ejecutar'), validateId, controller.listSitiosServidor);
router.put('/servidores/:id/config-bd', requireCapability('servidores:bd-config'), validateConfigBd, controller.configBd);
router.put('/servidores/:id/config-deploy', requireCapability('servidores:deploy-config'), validateConfigDeploy, controller.configDeploy);

// Analizar es PURO (no crea nada) pero muestra el SQL que se va a correr: pide ejecutar.
router.post('/trabajos/analizar', requireCapability('servidores:bd-ejecutar'), validateAnalizarSql, controller.analizarSql);
// El lanzamiento valida la capability según el tipo DENTRO del controller: un mismo endpoint
// sirve SQL y deploy, y cada uno pide la suya.
router.post('/trabajos', validateCrearTrabajos, controller.crearTrabajos);
router.get('/trabajos', validateListTrabajos, controller.listTrabajos);
router.get('/trabajos/:id', validateId, controller.getTrabajo);
router.post('/trabajos/:id/aprobar', validateId, controller.aprobarTrabajo);
router.post('/trabajos/:id/cancelar', validateId, controller.cancelarTrabajo);

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
