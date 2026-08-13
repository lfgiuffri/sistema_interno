/**
 * Manifest del módulo `documentacion` — base de conocimiento de la empresa.
 *
 * Estructura: espacio → lista → documento. Cada documento tiene título y puede llevar
 * cuerpo de texto enriquecido y/o archivos adjuntos, con historial de versiones.
 *
 * Permisos de DOS CAPAS, igual que tareas: la capability `documentacion:*` habilita la
 * sección, y además hace falta ver/editar el espacio concreto (matriz `usuario_doc_espacios`).
 * Los espacios son PROPIOS del módulo (no los de tareas), con su propia administración —
 * por eso el prefijo `doc-espacios:*` para el ABM y los accesos.
 *
 * No declara dependsOn: resuelve `esRolAdmin` con el kernel y no importa otros módulos.
 */

import router from './routes/documentacion.routes.js';

/** @type {object} */
export default {
    key: 'documentacion',
    name: 'Documentación',
    version: '1.0.0',
    description: 'Documentación por espacios y listas: texto enriquecido, adjuntos, versiones y buscador.',
    basePath: '/documentacion',
    models: ['DocEspacio', 'UsuarioDocEspacio', 'DocLista', 'Documento', 'DocumentoVersion', 'DocumentoArchivo'],
    capabilities: [
        'documentacion:read', 'documentacion:create', 'documentacion:update', 'documentacion:delete',
        'doc-espacios:read', 'doc-espacios:create', 'doc-espacios:update', 'doc-espacios:toggle',
        'doc-espacios:delete', 'doc-espacios:asignar-usuarios'
    ],
    dependsOn: [],
    router
};
