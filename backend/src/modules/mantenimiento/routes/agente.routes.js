import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/mantenimiento.controller.js';
import { validateIngesta } from '../validators/mantenimiento.validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Carpeta de los scripts del agente (queda fuera de src/, se copia al build). */
const AGENTE_DIR = path.resolve(__dirname, '../../../../agente');

/**
 * Rutas del AGENTE: se montan FUERA de verifyAccessToken (routes.js) porque quien llama es
 * una máquina, no una sesión. La autenticación es el token propio del servidor
 * (`x-agent-token`), que el service verifica contra su hash.
 */
const router = Router();

// Un agente reporta ~1 vez por minuto: 30/min por IP deja margen de sobra y frena abuso
// si alguien descubre la ruta (igual sin token válido no escribe nada).
const limite = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/metricas', limite, validateIngesta, controller.ingesta);

/**
 * Descarga de los scripts del agente. Son públicos a propósito: el instalador corre en un
 * VPS que todavía no tiene credenciales, y los scripts NO contienen secretos (el token se
 * pasa por variable de entorno al instalar y queda en /etc con permisos 600).
 */
for (const archivo of ['instalar-agente.sh', 'agente-sistema-interno.sh']) {
    router.get(`/${archivo}`, (req, res) => {
        res.type('text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(AGENTE_DIR, archivo));
    });
}

export default router;
