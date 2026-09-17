/**
 * Manifest del módulo `incidencias` — reclamos y pedidos de los clientes.
 *
 * Las incidencias entran por dos puertas: este router (sistema interno, detrás de la sesión y
 * las capabilities) y el portal de clientes, que se monta APARTE en `routes.js` porque se
 * autentica con su propio token y no con la sesión de un usuario interno — mismo criterio que
 * `/agente` en mantenimiento.
 */

import router from './routes/incidencias.routes.js';
import { avisoIncidenciaHandler } from './services/avisoIncidencia.handler.js';

/** @type {object} */
export default {
    key: 'incidencias',
    name: 'Incidencias',
    version: '1.0.0',
    description: 'Reclamos y pedidos que cargan los clientes desde su portal, o el equipo en su nombre.',
    basePath: '/incidencias',
    models: ['Incidencia', 'IncidenciaArchivo', 'IncidenciaCambio'],
    capabilities: [
        'incidencias:read', 'incidencias:create', 'incidencias:update',
        // Separada de `update`: mover el estado es lo que le dispara el mail al cliente.
        'incidencias:estado', 'incidencias:delete'
    ],
    dependsOn: ['clientes', 'servicios'],
    // Outbox de los avisos por mail: tick por minuto (ver el service para el porqué).
    schedulerHandler: avisoIncidenciaHandler,
    router
};
