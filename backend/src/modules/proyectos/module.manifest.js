/**
 * Manifest del módulo `proyectos` — proyectos con presupuesto y cobranzas en cuotas (USD),
 * con auditoría completa de cobranzas.
 */

import router from './routes/proyectos.routes.js';

/** @type {object} */
export default {
    key: 'proyectos',
    name: 'Proyectos',
    version: '1.0.0',
    description: 'Proyectos de clientes: estados, ciclo de vida y cobranzas planificadas en USD.',
    basePath: '/proyectos',
    models: ['Proyecto', 'Cobranza', 'CobranzaEvento'],
    capabilities: [
        'proyectos:read', 'proyectos:create', 'proyectos:update', 'proyectos:delete',
        'cobranzas:read', 'cobranzas:create', 'cobranzas:update', 'cobranzas:mover',
        'cobranzas:cobrar', 'cobranzas:descobrar', 'cobranzas:delete',
    ],
    dependsOn: ['clientes', 'servicios'],
    router
};
