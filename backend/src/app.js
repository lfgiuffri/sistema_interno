import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";

import { apiReference } from "@scalar/express-api-reference";
import { globalRateLimit } from "./middlewares/index.js";
import routes from "./routes.js";
import { buildOpenApiSpec } from "./services/openapi/openapi.service.js";

const app = express();

// Trust proxy para que req.ip sea correcto detrás de nginx/reverse proxy
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            'media-src': ["'self'"],
        },
    },
}));
app.use(morgan('dev'));
// CORS configurable: CORS_ORIGIN vacío o '*' → permisivo (dev); lista separada por comas → whitelist.
const corsOrigin = (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*')
    ? '*'
    : process.env.CORS_ORIGIN.split(',').map(o => o.trim());
app.use(cors({ origin: corsOrigin }));
// Capturamos el body crudo (req.rawBody) para poder verificar firmas de webhooks
// (Stripe/MercadoPago firman sobre el payload exacto). No afecta el parseo normal.
app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Rate limiting global (desactivado en desarrollo, activo en producción)
app.use(globalRateLimit);

// Servir archivos estáticos desde la carpeta public
// Setea CORP cross-origin y Content-Type correcto para audios
app.use('/public', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (/\.webm$/i.test(req.path) && req.path.includes('/audio/')) {
        res.setHeader('Content-Type', 'audio/webm');
    } else if (/\.ogg$/i.test(req.path) && req.path.includes('/audio/')) {
        res.setHeader('Content-Type', 'audio/ogg');
    } else if (/\.mp3$/i.test(req.path) && req.path.includes('/audio/')) {
        res.setHeader('Content-Type', 'audio/mpeg');
    }
    next();
}, express.static('public'));

// req.io disponible en TODOS los controllers para emisiones real-time.
// io se crea en index.js y se expone via app.set('io', io); leerlo por request acá
// (ANTES del montaje de rutas) evita el problema de orden que dejaba req.io undefined.
app.use((req, res, next) => { req.io = req.app.get('io') || null; next(); });

// ─── Documentación de API (OpenAPI 3 + Scalar) — reemplaza el viejo API Rest/*.http ──
// Spec crudo (consumible por cualquier cliente / generador) y UI Scalar (estética premium).
app.get('/api/openapi.json', (req, res) => res.json(buildOpenApiSpec()));

// Scalar carga su bundle desde el CDN de jsdelivr + un script inline de init. El CSP global
// (`script-src 'self'`) los bloquea → pantalla en blanco. En vez de aflojar el CSP global,
// lo relajamos SOLO en /api/docs con un nonce por request: se permite el CDN de Scalar y los
// dos <script> (bundle + init) que Scalar etiqueta con ese mismo nonce. Best-practice: nonce,
// no un blanket 'unsafe-inline'.
const SCALAR_CDN = 'https://cdn.jsdelivr.net';
const SCALAR_FONTS = 'https://fonts.scalar.com';
const SCALAR_API = 'https://api.scalar.com';
app.use('/api/docs', (req, res, next) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    helmet({
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                'script-src': ["'self'", `'nonce-${nonce}'`, SCALAR_CDN],
                'style-src': ["'self'", "'unsafe-inline'", SCALAR_CDN],
                'font-src': ["'self'", 'data:', SCALAR_CDN, SCALAR_FONTS],
                'img-src': ["'self'", 'data:', SCALAR_CDN],
                'connect-src': ["'self'", SCALAR_CDN, SCALAR_FONTS, SCALAR_API],
                'worker-src': ["'self'", 'blob:'],
            },
        },
    })(req, res, () => {
        res.locals.scalarNonce = nonce;
        next();
    });
}, (req, res) => apiReference({ url: '/api/openapi.json', nonce: res.locals.scalarNonce })(req, res));

// Aplicar todas las rutas
app.use('/api', routes);

app.get('/api/', (req, res) => {
    res.json({ message: 'Sistema Interno API funcionando' });
});


export default app;
