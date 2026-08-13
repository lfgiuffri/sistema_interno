import { Router } from 'express';
import { requireCapability } from '../../../kernel/index.js';
import * as controller from '../controllers/dashboard.controller.js';

const router = Router();

router.get('/', requireCapability('dashboard:read'), controller.get);

// Estadísticas: capability PROPIA (`estadisticas:read`), separada de `dashboard:read`, para
// poder dar el panel sin los gráficos de facturación (o al revés) desde la pantalla de Roles.
// El gating fino por gráfico (facturaciones, cobranzas, servicios, áreas) lo aplica el service.
router.get('/estadisticas', requireCapability('estadisticas:read'), controller.getEstadisticas);

export default router;
