/**
 * Manifest del módulo `mantenimiento` — monitoreo de la infraestructura de la empresa.
 *
 * Sección Servidores: inventario de VPS + métricas (CPU, RAM, disco) que reporta un agente
 * instalado en cada uno, estado online por heartbeat, incidentes y alertas multicanal.
 *
 * Sección Sitios web: disponibilidad cada 5 minutos por marcador en el footer, vencimiento
 * de dominio por RDAP y de certificado TLS por handshake.
 *
 * La ruta de ingesta del agente NO va acá: se monta aparte en routes.js porque se autentica
 * con el token del servidor y no con la sesión del usuario.
 */

import router from './routes/mantenimiento.routes.js';

/** @type {object} */
export default {
    key: 'mantenimiento',
    name: 'Mantenimiento',
    version: '1.0.0',
    description: 'Monitoreo de servidores y sitios web: métricas, disponibilidad, vencimientos y alertas.',
    basePath: '/mantenimiento',
    models: [
        'Servidor', 'ServidorMetrica', 'ServidorMetricaDia', 'ServidorIncidente',
        'SitioWeb', 'SitioVista', 'SitioChequeo', 'SitioIncidente', 'SitioVelocidadDia'
    ],
    capabilities: [
        'servidores:read', 'servidores:create', 'servidores:update',
        'servidores:toggle', 'servidores:delete',
        'sitios:read', 'sitios:create', 'sitios:update',
        'sitios:toggle', 'sitios:delete'
    ],
    dependsOn: [],
    router
};
