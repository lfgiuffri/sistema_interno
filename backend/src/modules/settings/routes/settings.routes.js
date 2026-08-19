import { Router } from 'express';
import * as controller from '../controllers/settings.controller.js';
import { validateUpdate, validatePushToken, validateSuscripcion } from '../validators/settings.validator.js';

const router = Router();

router.get('/', controller.getSettings);
router.put('/', validateUpdate, controller.updateSettings);
router.post('/push-token', validatePushToken, controller.registerPushToken);
router.post('/test-notification', controller.testNotification);

// Web Push (navegador). Son endpoints PERSONALES, sin capability: cada uno administra las
// notificaciones de SUS dispositivos, igual que el resto de /settings.
router.get('/push/clave-publica', controller.clavePublicaWebPush);
router.post('/push/suscripcion', validateSuscripcion, controller.suscribirWebPush);
router.delete('/push/suscripcion', controller.desuscribirWebPush);

export default router;
