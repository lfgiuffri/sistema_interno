/**
 * Zero 2.0 — Rutas del feature `webhooks` (tenant-facing).
 *
 * Se montan en `/webhooks` detrás de verifyAccessToken (igual que billing): son
 * capability-based, NO usan verifyPermissions. Cada ruta exige `webhooks:manage`.
 *
 * Endpoints:
 *   GET    /subscriptions          — lista suscripciones del tenant
 *   GET    /subscriptions/:id      — una suscripción
 *   POST   /subscriptions          — crea suscripción (server genera el secreto HMAC)
 *   DELETE /subscriptions/:id      — elimina (soft-delete) una suscripción
 *   GET    /deliveries             — log de entregas (paginado, filtrable)
 *   POST   /test                   — dispara un evento de prueba
 */

import { Router } from 'express';
import { requireCapability, registerCapabilities } from '../../../kernel/index.js';
import * as controller from '../controllers/webhooks.controller.js';
import {
    validateId,
    validateListSubscriptions,
    validateCreateSubscription,
    validateListDeliveries,
    validateTest
} from '../validators/webhooks.validator.js';

// Registramos la capability del feature (el rol admin del tenant la tiene vía comodín '*').
registerCapabilities(['webhooks:manage']);

const router = Router();

// ─── Suscripciones ──────────────────────────────────────────────────────────
router.get('/subscriptions', requireCapability('webhooks:manage'), validateListSubscriptions, controller.listSubscriptions);
router.get('/subscriptions/:id', requireCapability('webhooks:manage'), validateId, controller.getSubscription);
router.post('/subscriptions', requireCapability('webhooks:manage'), validateCreateSubscription, controller.createSubscription);
router.delete('/subscriptions/:id', requireCapability('webhooks:manage'), validateId, controller.deleteSubscription);

// ─── Entregas (log) ───────────────────────────────────────────────────────────
router.get('/deliveries', requireCapability('webhooks:manage'), validateListDeliveries, controller.listDeliveries);

// ─── Disparo de prueba ────────────────────────────────────────────────────────
router.post('/test', requireCapability('webhooks:manage'), validateTest, controller.test);

export default router;
