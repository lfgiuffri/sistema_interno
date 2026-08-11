/**
 * Manifest del módulo `abonos` — suscripciones de clientes con actualización de precios
 * e historial, y facturación mensual con montos congelados + anulación auditada.
 */

import router from './routes/abonos.routes.js';

/** @type {object} */
export default {
    key: 'abonos',
    name: 'Abonos',
    version: '1.0.0',
    description: 'Abonos de clientes: precios ARS/USD, actualizaciones con historial y facturación mensual.',
    basePath: '/abonos',
    models: ['Abono', 'AbonoActualizacion', 'Facturacion'],
    capabilities: [
        'abonos:read', 'abonos:create', 'abonos:update', 'abonos:toggle', 'abonos:delete',
        'abonos:actualizar-precio', 'abonos:facturar',
        'facturaciones:read', 'facturaciones:anular',
    ],
    dependsOn: ['clientes', 'servicios', 'formas-facturacion'],
    router
};
