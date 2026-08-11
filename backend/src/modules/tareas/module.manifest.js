/**
 * Manifest del módulo `tareas` — listas y tareas por espacio de trabajo.
 * Permiso de DOS capas: capability de sección + ver/editar del espacio (módulo `espacios`,
 * del que este módulo importa los helpers de la capa 2 — por eso el dependsOn).
 */

import router from './routes/tareas.routes.js';

/** @type {object} */
export default {
    key: 'tareas',
    name: 'Tareas',
    version: '1.0.0',
    description: 'Tareas del equipo: listas por espacio, estados con historial, editor con imágenes y adjuntos.',
    basePath: '/tareas',
    models: ['Lista', 'Tarea', 'TareaEstado', 'TareaArchivo', 'TareaComentario'],
    capabilities: [
        'tareas:read', 'tareas:create', 'tareas:update', 'tareas:delete',
        'tareas:estado', 'tareas:asignar'
    ],
    dependsOn: ['espacios'],
    router
};
