import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/dashboard.controller.js';

const router = Router();

router.get('/', requireCapability('dashboard:read'), controller.get);

export default router;
