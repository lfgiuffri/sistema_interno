/**
 * Sistema Interno — Barrel del KERNEL: superficie pública de infra para los módulos pluggable.
 *
 * Un módulo de `modules/` debe importar la infra SOLO desde acá (no desde rutas profundas
 * tipo `../../../libs/...`). Eso lo vuelve portable: para mover un módulo a otra app
 * con este kernel, se copia su carpeta y sigue importando `kernel` (misma API en todas).
 *
 * Si una pieza de infra cambia de lugar internamente, solo se actualiza este barrel,
 * no cada módulo. Mantener esta superficie CHICA y estable a propósito.
 *
 * (Futuro: cuando se corra ESM nativo sin babel, se puede exponer como subpath import "#kernel".)
 */

// Respuestas estandarizadas y paginación.
export { responseManager } from '../libs/responseManager.js';
export { default as Paginate } from '../libs/paginate.js';

// Validación de input (wrapper de express-validator).
export { validator } from '../middlewares/index.js';

// Micro-permisos por capability (se declara la capability requerida por ruta).
export { requireCapability, registerCapabilities, getDeclaredCapabilities, getRoleCapabilities, setRoleCapabilities } from './capability.js';

// Storage pluggable (local/S3).
export { putFile, getFile, deleteFile, fileExists, getFileUrl, activeStorageDriver } from '../services/storage/storage.service.js';

// Webhooks salientes: un módulo dispara eventos firmados a las URLs suscriptas del tenant.
export { dispatch as dispatchWebhook } from '../services/webhooks/services/webhooks.service.js';

// Embeddings / búsqueda semántica genérica.
export { indexEmbedding, searchEmbeddings, removeEmbeddingsByOwner } from '../services/embeddings/embeddings.service.js';

// Vault de secretos cifrados por tenant (AES-256-GCM).
export { vaultSet, vaultGet, vaultList, vaultDelete } from './vault/vault.service.js';

// Configuración de negocio (clave/valor validado: cotización, redondeos, avisos).
export { getAppConfig, getAppConfigNumber, setAppConfig, listAppConfig } from './registry/services/appConfig.service.js';
export { crearNotificacion } from '../services/notificaciones/notificaciones.service.js';

// Config registry tipado (qué es configurable; secretos enmascarados al exponer).
export { getConfig, getSection, getEffectiveConfig, CONFIG_SCHEMA } from './config-registry/registry.js';

// Registro de handlers pluggable: un módulo puede sumar tareas al scheduler,
// handlers de socket o acciones de notificación.
export {
    registerSchedulerHandler,
    registerSocketHandler,
    registerNotificationAction,
    setSandboxResultHandler
} from './handlerRegistry.js';
export { ordenSeguro } from './ordenTabla.js';
