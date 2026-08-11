/**
 * Manifest del módulo `formas-facturacion` — formas de facturación de los abonos.
 */

import router from './routes/formasFacturacion.routes.js';

/** @type {object} */
export default {
    key: 'formas-facturacion',
    name: 'Formas de facturación',
    version: '1.0.0',
    description: 'Catálogo de formas de facturación (SRL, monotributos, etc.) usadas por los abonos.',
    basePath: '/formas-facturacion',
    models: ['FormaFacturacion'],
    capabilities: ['formas-facturacion:read', 'formas-facturacion:create', 'formas-facturacion:update', 'formas-facturacion:toggle', 'formas-facturacion:delete'],
    dependsOn: [],
    router
};
