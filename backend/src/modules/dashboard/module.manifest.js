/**
 * Manifest del módulo `dashboard` — el panel: alertas y estadísticas del negocio.
 * Cada bloque interno se calcula solo si el usuario tiene la capability del módulo fuente.
 */

import router from './routes/dashboard.routes.js';

/** @type {object} */
export default {
    key: 'dashboard',
    name: 'Panel',
    version: '1.0.0',
    description: 'Panel con alertas de abonos y estadísticas de facturación.',
    basePath: '/dashboard',
    models: [],
    capabilities: ['dashboard:read'],
    dependsOn: ['abonos'],
    router
};
