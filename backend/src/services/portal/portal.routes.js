/**
 * Rutas del PORTAL DE CLIENTES.
 *
 * Se montan en `routes.js` FUERA de `verifyAccessToken`, igual que `/agente`: quien llama no
 * es un usuario interno con sesión, y la autenticación la resuelve `verifyPortalToken` con su
 * propio token. Rate limit propio: el de `/auth` son 10 intentos por IP cada 15 minutos, y los
 * clientes salen todos por el NAT de su oficina — con ese presupuesto, un torpe deja afuera a
 * toda la empresa.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { responseManager, validator } from '../../kernel/index.js';
import { getIP } from '../../libs/getIp.js';
import { verifyPortalToken } from './verifyPortalToken.js';
import { loginPortal, refrescarPortal } from './portalAuth.service.js';
import * as incidencias from '../../modules/incidencias/services/incidencia.service.js';
import * as archivos from '../../modules/incidencias/services/archivoIncidencia.service.js';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

/**
 * Límite del login del portal: más generoso que el interno porque la unidad de castigo es la
 * IP y los clientes comparten IP de salida. La defensa real contra fuerza bruta es el lockout
 * por par (email, IP) de `portalAuth.service.js`, que sí discrimina por persona.
 */
const limiteLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false
});

// ─────────────────────────── Sesión ───────────────────────────

router.post('/auth/signin',
    limiteLogin,
    [
        body('email').isString().trim().notEmpty().withMessage('Ingresá tu email'),
        body('password').isString().notEmpty().withMessage('Ingresá tu contraseña'),
        validator
    ],
    async (req, res) => {
        const r = await loginPortal(req.models, req.body.email, req.body.password, getIP(req));
        if (!r.ok) return responseManager(r.status, r.message, req, res, false, r.errorCode ? { errorCode: r.errorCode } : {});
        return responseManager(200, r.sesion, req, res, false);
    });

router.post('/auth/refresh', async (req, res) => {
    const token = req.headers['x-refresh-token'] || req.body?.refreshToken;
    const r = await refrescarPortal(req.models, token);
    if (!r.ok) return responseManager(r.status, r.message, req, res, false);
    return responseManager(200, r.sesion, req, res, false);
});

/** Contexto del usuario logueado (el equivalente de `/me`, para el portal). */
router.get('/me', verifyPortalToken, async (req, res) => {
    const u = req.clienteUsuario;
    return responseManager(200, {
        id: u.id, nombre: u.nombre, email: u.email,
        cliente: { id: u.cliente.id, nombre: u.cliente.nombre }
    }, req, res, false);
});

// ─────────────────────────── Incidencias del cliente ───────────────────────────

/**
 * Servicios que el cliente puede elegir. Salen de SU `clienteId` del middleware, nunca de un
 * parámetro: un id en el query sería un IDOR de manual.
 */
router.get('/servicios', verifyPortalToken, async (req, res) => {
    const data = await incidencias.serviciosDelCliente(req.models, req.clienteId);
    return responseManager(200, data, req, res, false);
});

router.get('/incidencias', verifyPortalToken, async (req, res) => {
    // El alcance lo fija el middleware. El cliente ve TODAS las suyas, con las cerradas al
    // fondo (el orden lo pone el service, compartido con el sistema interno).
    const data = await incidencias.listIncidencias(req.models, { clienteId: req.clienteId }, true);
    return responseManager(200, data, req, res, false);
});

router.get('/incidencias/:id', verifyPortalToken, async (req, res) => {
    // El `clienteId` acota la búsqueda: una incidencia de otro cliente devuelve 404, no 403.
    // A un tercero no se le confirma que ese id existe.
    const data = await incidencias.getIncidencia(req.models, req.params.id, req.clienteId);
    if (!data) return responseManager(404, 'Incidencia no encontrada', req, res, false);
    return responseManager(200, data, req, res, false);
});

router.post('/incidencias',
    verifyPortalToken,
    [
        body('titulo').isString().trim().notEmpty().withMessage('Contanos brevemente qué pasa').isLength({ max: 200 }),
        body('descripcion').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 20000 }),
        body('servicioId').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1 }).toInt(),
        body('archivoIds').optional().isArray({ max: 20 }),
        body('archivoIds.*').isInt({ min: 1 }).toInt(),
        validator
    ],
    async (req, res) => {
        try {
            // `clienteId` del middleware, NO del body: el cliente no elige a nombre de quién
            // carga. El estado tampoco se acepta — lo mueve el equipo, nunca el cliente.
            const data = await incidencias.createIncidencia(req.models, {
                clienteId: req.clienteId,
                servicioId: req.body.servicioId,
                titulo: req.body.titulo,
                descripcion: req.body.descripcion,
                archivoIds: req.body.archivoIds
            }, { clienteUsuarioId: req.clienteUsuario.id }, req.io);

            if (req.io) req.io.to('app').emit('incidencia:creada', { id: data.id, clienteId: req.clienteId });
            return responseManager(201, data, req, res, false);
        } catch (e) {
            const code = e.statusCode || 500;
            return responseManager(code, e.message, req, res, code >= 500);
        }
    });

// ─────────────────────────── Archivos ───────────────────────────

router.post('/archivos', verifyPortalToken, upload.single('archivo'), async (req, res) => {
    try {
        if (!req.file) return responseManager(400, 'No se recibió ningún archivo', req, res, false);
        const data = await archivos.guardarArchivo(req.models, req.file, {
            clienteId: req.clienteId,
            clienteUsuarioId: req.clienteUsuario.id
        });
        return responseManager(201, data, req, res, false);
    } catch (e) {
        const code = e.statusCode || 500;
        return responseManager(code, e.message, req, res, code >= 500);
    }
});

/**
 * Sirve un adjunto del cliente.
 *
 * ⚠️ Acá NO alcanza el modelo de tareas («nombre aleatorio de 80 bits + sesión»). Entre
 * compañeros de trabajo es defendible; entre clientes distintos, no: un nombre filtrado en un
 * mail reenviado o en un log de proxy daría acceso permanente al adjunto de otra empresa. El
 * `clienteId` acota la búsqueda y un archivo ajeno devuelve 404.
 */
router.get('/archivos/:nombre', verifyPortalToken, async (req, res) => {
    try {
        const { nombre } = req.params;
        if (!archivos.NOMBRE_RE.test(nombre)) return res.status(404).end();
        const archivo = await archivos.leerArchivo(req.models, nombre, req.clienteId);
        if (!archivo) return res.status(404).end();

        res.setHeader('Content-Type', archivo.mime || 'application/octet-stream');
        res.setHeader('Content-Disposition', archivo.tipo === 'imagen'
            ? 'inline'
            : `attachment; filename="${encodeURIComponent(archivo.nombreOriginal || nombre)}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.send(archivo.buffer);
    } catch { return res.status(404).end(); }
});

export default router;
