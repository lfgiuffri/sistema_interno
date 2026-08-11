/**
 * Manifest del módulo `servicios` — catálogo de servicios (entidad compartida).
 * El área del servicio clasifica la facturación de abonos y proyectos.
 */

import router from './routes/servicios.routes.js';

/** @type {object} */
export default {
    key: 'servicios',
    name: 'Servicios',
    version: '1.0.0',
    description: 'Catálogo de servicios de la empresa; su área clasifica la facturación.',
    basePath: '/servicios',
    models: ['Servicio'],
    capabilities: ['servicios:read', 'servicios:create', 'servicios:update', 'servicios:toggle', 'servicios:delete'],
    dependsOn: ['areas'],
    router
};
