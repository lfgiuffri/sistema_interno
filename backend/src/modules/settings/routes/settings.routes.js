import { Router } from 'express';
import * as controller from '../controllers/settings.controller.js';
import { validateUpdate, validatePushToken } from '../validators/settings.validator.js';

const router = Router();

router.get('/', controller.getSettings);
router.put('/', validateUpdate, controller.updateSettings);
router.post('/push-token', validatePushToken, controller.registerPushToken);
router.post('/test-notification', controller.testNotification);

export default router;
