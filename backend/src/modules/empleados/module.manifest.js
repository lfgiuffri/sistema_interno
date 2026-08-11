/**
 * Manifest del módulo `empleados` — ficha del personal, vacaciones y archivos.
 * Vacaciones y archivos tienen capabilities propias (granularidad del PRD §4)
 * aunque cuelguen del mismo basePath.
 */

import router from './routes/empleados.routes.js';

/** @type {object} */
export default {
    key: 'empleados',
    name: 'Empleados',
    version: '1.0.0',
    description: 'Ficha del personal: datos, categorías, áreas, vacaciones y archivos.',
    basePath: '/empleados',
    models: ['Empleado', 'EmpleadoArea', 'VacacionAsignacion', 'VacacionToma', 'EmpleadoArchivo'],
    capabilities: [
        'empleados:read', 'empleados:create', 'empleados:update', 'empleados:toggle', 'empleados:delete',
        'vacaciones:read', 'vacaciones:manage',
        'empleados-archivos:read', 'empleados-archivos:upload', 'empleados-archivos:delete'
    ],
    dependsOn: ['areas'],
    router
};
