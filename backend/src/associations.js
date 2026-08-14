/**
 * Sistema Interno — Auto-discovery de modelos y asociaciones (single-tenant).
 *
 * Reemplaza a tenantAssociations.js de la base multi-tenant original. Escanea las tres ubicaciones de modelos
 * (kernel/, modules/, services/) buscando factories `define<Nombre>Model(db)`, las instancia
 * sobre la conexión única y ejecuta sus `associate(models)`. No hay registro central:
 * agregar un modelo = crear el archivo en una carpeta `models/`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Cache de definiciones (los archivos se importan una sola vez por proceso). */
let modelDefinitionsCache = null;

/**
 * Busca recursivamente archivos de modelos (carpetas `models/`, excluyendo tests).
 * @param {string|null} dir - Directorio a escanear (null = no existe, devuelve acumulado).
 * @param {string[]} modelFiles - Acumulador de rutas encontradas.
 * @returns {string[]} Rutas absolutas de archivos de modelo.
 */
const findModelFiles = (dir, modelFiles = []) => {
    if (!dir || !fs.existsSync(dir)) return modelFiles;

    for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            findModelFiles(fullPath, modelFiles);
        } else if (file.endsWith('.js')
            && fullPath.split(path.sep).includes('models')
            && !file.includes('.test.') && !file.includes('.spec.')) {
            modelFiles.push(fullPath);
        }
    }
    return modelFiles;
};

/**
 * Importa un archivo de modelo y extrae su factory `define<Nombre>Model`.
 * @param {string} modelPath - Ruta absoluta del archivo.
 * @returns {Promise<{name: string, defineFunction: Function}|null>} Info del modelo o null.
 */
const loadModel = async (modelPath) => {
    try {
        const module = await import(pathToFileURL(modelPath).href);
        const defineFunction = Object.keys(module).find(key =>
            key.startsWith('define') && key.endsWith('Model') && typeof module[key] === 'function'
        );
        if (!defineFunction) return null;
        return {
            name: defineFunction.replace(/^define/, '').replace(/Model$/, ''),
            defineFunction: module[defineFunction]
        };
    } catch (error) {
        console.warn(`⚠️ Error cargando modelo ${modelPath}:`, error.message);
        return null;
    }
};

/**
 * Carga (con cache) todas las definiciones de modelos de kernel/, modules/ y services/.
 * @returns {Promise<Array<{name: string, defineFunction: Function}>>} Definiciones encontradas.
 */
const loadModelDefinitions = async () => {
    if (modelDefinitionsCache) return modelDefinitionsCache;

    const allModelFiles = [
        ...findModelFiles(path.join(__dirname, 'kernel')),
        ...findModelFiles(path.join(__dirname, 'modules')),
        ...findModelFiles(path.join(__dirname, 'services')),
    ];

    const modelDefinitions = [];
    for (const modelFile of allModelFiles) {
        const modelInfo = await loadModel(modelFile);
        if (modelInfo) modelDefinitions.push(modelInfo);
    }

    modelDefinitionsCache = modelDefinitions;
    console.log(`📦 [MODELS] ${modelDefinitions.length} definiciones de modelos cargadas`);
    return modelDefinitionsCache;
};

/**
 * Instancia todos los modelos sobre la conexión dada y ejecuta sus asociaciones.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {Promise<object>} Mapa nombre → modelo Sequelize.
 */
export const setupModels = async (db) => {
    const modelDefinitions = await loadModelDefinitions();
    const models = {};
    // En desarrollo fallamos fuerte: un modelo roto debe notarse YA, no desaparecer en silencio.
    const failLoud = process.env.NODE_ENV === 'development';

    for (const modelInfo of modelDefinitions) {
        try {
            models[modelInfo.name] = modelInfo.defineFunction(db);
        } catch (error) {
            console.error(`❌ [MODELS] Error instanciando modelo ${modelInfo.name}:`, error.message);
            if (failLoud) throw error;
        }
    }

    Object.values(models).forEach(model => {
        if (model && typeof model.associate === 'function') {
            try {
                model.associate(models);
            } catch (associateError) {
                console.error('❌ [MODELS] Error en asociaciones:', associateError.message);
                if (failLoud) throw associateError;
            }
        }
    });

    console.log(`📦 [MODELS] ${Object.keys(models).length} modelos instanciados`);
    return models;
};

/**
 * Limpia la cache de definiciones (útil en tests/dev).
 * @returns {void}
 */
export const clearModelCache = () => { modelDefinitionsCache = null; };
