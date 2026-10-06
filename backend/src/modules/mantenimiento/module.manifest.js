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
        'SitioWeb', 'SitioVista', 'SitioChequeo', 'SitioIncidente', 'SitioVelocidadDia',
        'ServidorTrabajo', 'ServidorTrabajoResultado', 'ServidorSitio'
    ],
    capabilities: [
        'servidores:read', 'servidores:create', 'servidores:update',
        'servidores:toggle', 'servidores:delete',
        'sitios:read', 'sitios:create', 'sitios:update',
        'sitios:toggle', 'sitios:delete',
        // FullGlass. CONFIGURAR y EJECUTAR son capabilities distintas, y están separadas entre
        // base de datos y deploy: el comando de deploy corre como root en el VPS, así que
        // editarlo es tan sensible como tener acceso al servidor — no es lo mismo que apretar
        // el botón. Ninguna se otorga sola: hay que repartirlas a mano desde Roles.
        'servidores:bd-config', 'servidores:bd-ejecutar',
        'servidores:deploy-config', 'servidores:deploy-ejecutar'
    ],
    dependsOn: [],
    router
};
