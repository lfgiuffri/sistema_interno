/**
 * Manifest del módulo `sueldos` — salarios del personal.
 * Aumentos, planificación y cuentas tienen capabilities propias (secciones separadas
 * en el legado; granularidad del PRD §4).
 */

import router from './routes/sueldos.routes.js';

/** @type {object} */
export default {
    key: 'sueldos',
    name: 'Sueldos',
    version: '1.0.0',
    description: 'Sueldos: vigente por historial, actualizaciones, aumentos programados, planificación de pagos y cuentas.',
    basePath: '/sueldos',
    models: ['SueldoActualizacion', 'CuentaPago', 'SueldoPago', 'CuentaDisponible'],
    capabilities: [
        'sueldos:read', 'sueldos:update', 'sueldos:actualizar', 'sueldos:historial',
        'aumentos:read', 'aumentos:manage',
        'planificacion:read', 'planificacion:manage',
        'cuentas:read', 'cuentas:create', 'cuentas:update', 'cuentas:toggle', 'cuentas:delete'
    ],
    dependsOn: ['empleados'],
    router
};
