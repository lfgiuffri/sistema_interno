/**
 * Zero 2.0 — Module loader (auto-discovery de módulos feature por manifest).
 *
 * Escanea `src/modules/*\/module.manifest.js`, valida cada manifest, registra sus
 * capabilities y handlers (scheduler/socket) en el handlerRegistry, y monta sus routers
 * detrás de la cadena estándar (sharedMiddleware → planGate → router del módulo).
 *
 * Esto reemplaza el alta manual en routes.js para los módulos feature: agregar un módulo
 * = crear su carpeta con un manifest; no se toca ningún archivo central. Las rutas de
 * infraestructura (master/core/users) siguen montadas explícitamente en routes.js.
 *
 * Nota: el modelo de datos de cada módulo lo sigue descubriendo tenantAssociations
 * (auto-loader idiomático de Sequelize). El manifest DECLARA esos modelos para poder
 * validar disco-vs-manifest. La sincronización del registry en DB (Module/Route/View del
 * módulo core, por tenant) se hace en M5 junto con el gating por plan.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { registerCapabilities, getDeclaredCapabilities } from './capability.js';
import { registerSchedulerHandler, registerSocketHandler } from './handlerRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Cache de manifests cargados (se descubren una sola vez por proceso). */
let manifestsCache = null;

/** Campos obligatorios de todo manifest. */
const REQUIRED_FIELDS = ['key', 'name', 'version', 'basePath', 'router'];

/** Formato canónico de una capability declarada: `modulo:accion` (sin comodín — `*` es solo para roles). */
const CAPABILITY_RE = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;

/**
 * Valida la forma de un manifest individual. Falla fuerte (throw) ante errores de forma:
 * un manifest mal definido es un bug del desarrollador, no algo a tolerar en silencio.
 * @param {object} manifest - El objeto exportado por module.manifest.js.
 * @param {string} folder - Carpeta del módulo (para mensajes de error claros).
 * @returns {void}
 * @throws {Error} Si falta un campo obligatorio o tiene el tipo incorrecto.
 */
const validateManifest = (manifest, folder) => {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error(`[MODULES] ${folder}/module.manifest.js no exporta un objeto por default`);
    }
    for (const field of REQUIRED_FIELDS) {
        if (manifest[field] == null) {
            throw new Error(`[MODULES] Módulo "${folder}": falta el campo requerido "${field}" en el manifest`);
        }
    }
    if (!String(manifest.basePath).startsWith('/')) {
        throw new Error(`[MODULES] Módulo "${manifest.key}": basePath debe empezar con "/" (es "${manifest.basePath}")`);
    }
    if (typeof manifest.router !== 'function') {
        throw new Error(`[MODULES] Módulo "${manifest.key}": router debe ser un Router de Express`);
    }
};

/**
 * Valida el grafo de módulos: claves únicas, basePaths únicos y dependencias resueltas.
 * @param {object[]} manifests - Manifests ya validados individualmente.
 * @returns {void}
 * @throws {Error} Ante claves/basePaths duplicados o dependsOn no resueltas.
 */
const validateGraph = (manifests) => {
    const keys = new Set();
    const basePaths = new Set();
    for (const m of manifests) {
        if (keys.has(m.key)) throw new Error(`[MODULES] Clave de módulo duplicada: "${m.key}"`);
        if (basePaths.has(m.basePath)) throw new Error(`[MODULES] basePath duplicado: "${m.basePath}" (módulo "${m.key}")`);
        keys.add(m.key);
        basePaths.add(m.basePath);
    }
    // Toda dependencia declarada debe existir entre los módulos cargados.
    for (const m of manifests) {
        for (const dep of m.dependsOn || []) {
            if (!keys.has(dep)) {
                throw new Error(`[MODULES] Módulo "${m.key}" depende de "${dep}", que no está disponible`);
            }
        }
    }
};

/**
 * Valida las capabilities DECLARADAS por los manifests: formato `modulo:accion` y unicidad global.
 * Falla fuerte (throw) — una capability malformada (ej. `'read'` sin prefijo) pasaría silenciosa al
 * registro y luego explotaría en runtime como 403 críptico o como un seed de rol que no matchea
 * (tenants.controller filtra por `endsWith(':read')`). Mejor atraparla al boot, con el módulo culpable.
 * @param {object[]} manifests - Manifests ya validados en forma.
 * @returns {void}
 * @throws {Error} Ante formato inválido o capability duplicada entre módulos.
 */
const validateCapabilities = (manifests) => {
    // Caps ya registradas por services (billing:manage, webhooks:manage, etc.) al importar sus rutas,
    // que ocurre ANTES de loadModules en el boot. Las usamos para detectar colisiones módulo↔service.
    const fromServices = new Set(getDeclaredCapabilities());
    const seen = new Map(); // capability → key del módulo que la declaró (para reportar el duplicado)
    for (const m of manifests) {
        for (const cap of m.capabilities || []) {
            if (!CAPABILITY_RE.test(cap)) {
                throw new Error(`[MODULES] Módulo "${m.key}": capability "${cap}" no respeta el formato "modulo:accion"`);
            }
            if (seen.has(cap)) {
                throw new Error(`[MODULES] Capability duplicada "${cap}": declarada por "${seen.get(cap)}" y "${m.key}"`);
            }
            if (fromServices.has(cap)) {
                throw new Error(`[MODULES] Capability "${cap}" del módulo "${m.key}" colisiona con una ya registrada por un service`);
            }
            seen.set(cap, m.key);
        }
    }
};

/**
 * Descubre y valida todos los manifests, y registra capabilities + handlers en el registry.
 * Idempotente: cachea el resultado y no vuelve a escanear.
 * @returns {Promise<object[]>} Lista de manifests cargados.
 */
export const loadModules = async () => {
    if (manifestsCache) return manifestsCache;

    const modulesDir = path.join(__dirname, '..', 'modules');
    const manifests = [];

    // Escaneamos cada subcarpeta de modules/ buscando un module.manifest.js.
    for (const entry of fs.readdirSync(modulesDir)) {
        const manifestPath = path.join(modulesDir, entry, 'module.manifest.js');
        if (!fs.existsSync(manifestPath)) continue; // módulos infra (sin manifest) se ignoran acá

        const mod = await import(pathToFileURL(manifestPath).href);
        const manifest = mod.default;
        validateManifest(manifest, entry);
        manifests.push(manifest);
    }

    validateGraph(manifests);
    validateCapabilities(manifests);

    // Registramos lo que cada módulo aporta a los frameworks genéricos.
    for (const m of manifests) {
        if (m.capabilities) registerCapabilities(m.capabilities);
        if (m.schedulerHandler) registerSchedulerHandler(m.schedulerHandler);
        if (m.socketHandler) registerSocketHandler(m.socketHandler);
    }

    manifestsCache = manifests;
    console.log(`📦 [MODULES] ${manifests.length} módulo(s) feature: ${manifests.map(m => m.key).join(', ') || '(ninguno)'}`);
    return manifestsCache;
};

/**
 * Monta los routers de los módulos descubiertos sobre un router dado.
 * Cada módulo se monta como: basePath → [sharedMiddleware...] → planGate(key) → router.
 * @param {import('express').Router} router - Router destino (el router /api principal).
 * @param {import('express').RequestHandler[]} [sharedMiddleware=[]] - Middlewares comunes (ej. verifyAccessToken).
 * @returns {void}
 * @throws {Error} Si se llama antes de loadModules().
 */
export const mountModuleManifests = (router, sharedMiddleware = []) => {
    if (!manifestsCache) throw new Error('[MODULES] mountModuleManifests: llamá a loadModules() primero');
    for (const m of manifestsCache) {
        // Sin gating por plan (single-tenant): el router del módulo trae requireCapability por ruta.
        router.use(m.basePath, ...sharedMiddleware, m.router);
        console.log(`🔗 [MODULES] "${m.key}" montado en ${m.basePath}`);
    }
};

/**
 * Devuelve los manifests ya cargados (para /me y la UI: qué módulos existen).
 * @returns {object[]} Manifests cargados (vacío si loadModules aún no corrió).
 */
export const getLoadedModules = () => manifestsCache || [];

/**
 * Limpia la cache de manifests (útil en tests/dev para re-descubrir).
 * @returns {void}
 */
export const clearModuleCache = () => { manifestsCache = null; };
