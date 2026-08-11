/**
 * Manifest del módulo `espacios` — espacios de trabajo del módulo de tareas.
 * Segunda capa de permisos: acceso ver/editar POR USUARIO (matriz de doble eje).
 */

import router from './routes/espacios.routes.js';

/** @type {object} */
export default {
    key: 'espacios',
    name: 'Espacios de trabajo',
    version: '1.0.0',
    description: 'Espacios de trabajo: contenedores de listas y tareas con acceso por usuario.',
    basePath: '/espacios',
    models: ['EspacioTrabajo', 'UsuarioEspacio'],
    capabilities: [
        'espacios:read', 'espacios:create', 'espacios:update', 'espacios:toggle',
        'espacios:delete', 'espacios:asignar-usuarios'
    ],
    dependsOn: [],
    router
};
