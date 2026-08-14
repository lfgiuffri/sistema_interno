/**
 * Endpoint de salud — para el chequeo EXTERNO del propio Sistema Interno.
 *
 * El monitoreo de servidores y sitios corre DENTRO de este proceso: si el backend se cae,
 * también se cae el que avisa. Por eso el sistema tiene que ser vigilado desde afuera (un
 * watchdog en otra máquina o un servicio de uptime), y esto es lo que ese watchdog consulta.
 *
 * Público a propósito: un chequeo que necesita credenciales no sirve como watchdog. No expone
 * nada sensible — estado, tiempo de respuesta de la base y uptime del proceso.
 *
 * Devuelve 200 solo si la base responde; 503 si no. Un watchdog mira el status, no el cuerpo.
 */

import { Router } from 'express';

const router = Router();

/**
 * GET /api/health — estado del backend y de su conexión a la base.
 */
router.get('/', async (req, res) => {
    const inicio = Date.now();
    try {
        // authenticate() y no un SELECT crudo: el driver de MariaDB rompe al post-procesar el
        // resultado de un `SELECT 1` sin tipo declarado.
        await req.db.authenticate();
        return res.status(200).json({
            ok: true,
            estado: 'ok',
            baseMs: Date.now() - inicio,
            uptimeSeg: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        return res.status(503).json({
            ok: false,
            estado: 'sin_base',
            error: String(e.message).slice(0, 120),
            uptimeSeg: Math.round(process.uptime()),
            timestamp: new Date().toISOString(),
        });
    }
});

export default router;
