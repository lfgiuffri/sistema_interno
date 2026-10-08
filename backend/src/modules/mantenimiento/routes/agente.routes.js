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

/*
 * FullGlass: el agente PREGUNTA si tiene trabajo y reporta cómo le fue. Es la pieza que
 * habilita ejecución remota sin romper el modelo: la app sigue sin conectarse a ningún
 * servidor ni guardar credenciales de acceso.
 *
 * Límite propio y más alto: cuando hay un trabajo en curso el agente consulta cada 10s en vez
 * de cada minuto, para que lanzar algo se sienta inmediato.
 */
const limiteTrabajos = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/config', limiteTrabajos, controller.agenteConfig);
router.get('/trabajos', limiteTrabajos, controller.agenteTrabajos);
router.post('/trabajos/:id/tomar', limiteTrabajos, controller.agenteTomar);
router.post('/trabajos/:id/resultado', limiteTrabajos, controller.agenteResultado);
// El inventario va en el bucket ALTO y no en el de métricas: lo manda el mismo lazo de 10s
// del worker, así que con 30/min se chocaría contra su propio límite.
router.post('/sitios', limiteTrabajos, controller.agenteSitios);

/**
 * Descarga de los scripts del agente. Son públicos a propósito: el instalador corre en un
 * VPS que todavía no tiene credenciales, y los scripts NO contienen secretos (el token se
 * pasa por variable de entorno al instalar y queda en /etc con permisos 600).
 */
for (const archivo of ['instalar-agente.sh', 'agente-sistema-interno.sh', 'fullglass-worker.php', 'cambiar-rama.sh']) {
    router.get(`/${archivo}`, (req, res) => {
        res.type('text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(AGENTE_DIR, archivo));
    });
}

export default router;
