/**
 * Manifest del módulo `clientes` — clientes de la empresa (entidad compartida).
 */

import router from './routes/clientes.routes.js';

/** @type {object} */
export default {
    key: 'clientes',
    name: 'Clientes',
    version: '1.0.0',
    description: 'Clientes de la empresa: base de abonos y proyectos.',
    basePath: '/clientes',
    models: ['Cliente'],
    capabilities: ['clientes:read', 'clientes:create', 'clientes:update', 'clientes:toggle', 'clientes:delete'],
    dependsOn: [],
    router
};
