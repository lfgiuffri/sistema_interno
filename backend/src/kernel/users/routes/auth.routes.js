import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { validateSignIn, validateChangePassword } from '../validators/auth.validator.js';
import { verifyAccessToken, verifyRefreshToken } from '../../../middlewares/index.js';

const router = Router();

// Públicas (detrás del rate limit de auth que aplica routes.js).
router.post('/signin', validateSignIn, authController.signIn);
router.post('/refresh', verifyRefreshToken, authController.refreshToken);
router.post('/mfa/login', authController.mfaVerifyLogin);

// Autenticadas.
router.post('/change-password', verifyAccessToken, validateChangePassword, authController.changePassword);
router.get('/mfa/status', verifyAccessToken, authController.mfaStatus);
router.post('/mfa/enroll', verifyAccessToken, authController.mfaEnroll);
router.post('/mfa/activate', verifyAccessToken, authController.mfaActivate);
router.post('/mfa/disable', verifyAccessToken, authController.mfaDisable);

export default router;
