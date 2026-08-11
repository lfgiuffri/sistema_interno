import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ruta de los seeds relativa al CÓDIGO (no al cwd): resuelve a build/exec/data en prod (el build
// los copia con `babel --copy-files`) y a src/exec/data en dev. Antes era './src/exec/data'
// (cwd-relativo) y fallaba en silencio si el proceso no corría desde backend/.
const DEFAULT_DATA_PATH = path.join(__dirname, '..', 'exec', 'data');

/**
 * Función para cargar datos desde archivos JSON
 * @param {string} filename - Nombre del archivo JSON a cargar
 * @param {string} dataPath - Ruta base donde buscar los archivos (por defecto, relativa al código)
 * @returns {Array} - Array con los datos del JSON o array vacío si hay error
 */
export const loadJSONData = (filename, dataPath = DEFAULT_DATA_PATH) => {
    try {
        const filePath = path.join(dataPath, filename);
        const rawData = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error(`Error loading ${filename}:`, error);
        return [];
    }
};

export default loadJSONData;
