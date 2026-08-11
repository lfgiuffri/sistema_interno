/**
 * Manifest del módulo `areas` — áreas de la empresa (catálogo compartido).
 * Clasifican servicios (y a futuro empleados y la facturación por área del panel).
 */

import router from './routes/areas.routes.js';

/** @type {object} */
export default {
    key: 'areas',
    name: 'Áreas',
    version: '1.0.0',
    description: 'Áreas de la empresa: agrupan servicios y empleados, y clasifican la facturación.',
    basePath: '/areas',
    models: ['Area'],
    capabilities: ['areas:read', 'areas:create', 'areas:update', 'areas:toggle', 'areas:delete'],
    dependsOn: [],
    router
};
