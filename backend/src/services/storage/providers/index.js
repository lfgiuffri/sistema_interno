import { STORAGE } from '../config/storage.config.js';
import { localProvider } from './local.provider.js';
import { s3Provider } from './s3.provider.js';

/** @type {Record<string, object>} Drivers disponibles (agregar uno = sumarlo acá). */
const PROVIDERS = {
    [localProvider.name]: localProvider,
    [s3Provider.name]: s3Provider,
};

/**
 * Devuelve el provider activo según STORAGE_DRIVER.
 *
 * @returns {{ name: string, put: Function, get: Function, del: Function, exists: Function, getUrl: Function }}
 * @throws {Error} Si STORAGE_DRIVER no corresponde a ningún driver registrado.
 */
export const getProvider = () => {
    const provider = PROVIDERS[STORAGE.driver];
    if (!provider) {
        throw new Error(`storage: STORAGE_DRIVER desconocido "${STORAGE.driver}" (válidos: ${Object.keys(PROVIDERS).join(', ')})`);
    }
    return provider;
};
