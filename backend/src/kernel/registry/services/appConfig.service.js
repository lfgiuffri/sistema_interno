/**
 * Configuración de aplicación (tabla `configs`, clave/valor tipado).
 *
 * Claves de negocio editables desde la pantalla de Configuración. Cada clave declara
 * su validación acá (fuente única): un valor que no valida no se guarda. Los defaults
 * también viven acá — la lectura NUNCA devuelve un valor fuera de rango aunque alguien
 * toque la base a mano (clamp defensivo, lección del sistema legado).
 */

/**
 * Registro de claves de configuración de negocio.
 * `parse` valida y normaliza el valor de entrada (string) o tira con mensaje de usuario.
 */
export const APP_CONFIG_KEYS = {
    COTIZACION_DOLAR: {
        label: 'Cotización del dólar',
        description: 'Valor del dólar usado por abonos, cobranzas y el panel.',
        default: '1000',
        parse: (raw) => {
            const v = parseFloat(String(raw).replace(',', '.'));
            if (!Number.isFinite(v) || v <= 0) throw new Error('La cotización debe ser un número mayor a 0');
            return String(v);
        },
    },
    REDONDEO_ABONOS: {
        label: 'Redondeo de actualizaciones de abonos',
        description: 'Múltiplo al que se redondean los precios al actualizarlos (100 = a la centena).',
        default: '100',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1) throw new Error('El redondeo debe ser un entero mayor o igual a 1');
            return String(v);
        },
    },
    TAREAS_DIAS_POR_VENCER: {
        label: 'Días de aviso de tareas por vencer',
        description: 'Con cuántos días de anticipación una tarea cuenta como "por vencer" (1 a 60).',
        default: '3',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1 || v > 60) throw new Error('Los días de aviso tienen que estar entre 1 y 60');
            return String(v);
        },
    },
};

/**
 * Lee una clave de configuración de negocio (con default y re-validación defensiva).
 * @param {object} models - Modelos de la app (Config).
 * @param {string} name - Clave (debe existir en APP_CONFIG_KEYS).
 * @returns {Promise<string>} El valor vigente (validado) o el default.
 */
export const getAppConfig = async (models, name) => {
    const def = APP_CONFIG_KEYS[name];
    if (!def) throw new Error(`Clave de configuración desconocida: ${name}`);
    const row = await models.Config.findOne({ where: { name } });
    if (!row) return def.default;
    try {
        return def.parse(row.value);
    } catch {
        // Valor corrupto en base (tocado a mano): degradar al default en vez de romper.
        return def.default;
    }
};

/**
 * Lee una clave numérica de configuración.
 * @param {object} models - Modelos de la app.
 * @param {string} name - Clave.
 * @returns {Promise<number>} Valor numérico.
 */
export const getAppConfigNumber = async (models, name) => Number(await getAppConfig(models, name));

/**
 * Guarda una clave de configuración de negocio (upsert, validada).
 * @param {object} models - Modelos de la app.
 * @param {string} name - Clave (de APP_CONFIG_KEYS).
 * @param {string} rawValue - Valor crudo de entrada.
 * @returns {Promise<string>} El valor normalizado guardado.
 * @throws {Error} Si la clave es desconocida o el valor no valida (statusCode 400).
 */
export const setAppConfig = async (models, name, rawValue) => {
    const def = APP_CONFIG_KEYS[name];
    if (!def) {
        const err = new Error(`Clave de configuración desconocida: ${name}`);
        err.statusCode = 400;
        throw err;
    }
    let value;
    try {
        value = def.parse(rawValue);
    } catch (e) {
        const err = new Error(e.message);
        err.statusCode = 400;
        throw err;
    }
    const [row, created] = await models.Config.findOrCreate({
        where: { name },
        defaults: { name, value, description: def.description }
    });
    if (!created) await row.update({ value });
    return value;
};

/**
 * Devuelve todas las claves de negocio con su valor vigente y metadata (para la UI).
 * @param {object} models - Modelos de la app.
 * @returns {Promise<Array<{name: string, label: string, description: string, value: string}>>}
 */
export const listAppConfig = async (models) => {
    const out = [];
    for (const [name, def] of Object.entries(APP_CONFIG_KEYS)) {
        out.push({ name, label: def.label, description: def.description, value: await getAppConfig(models, name) });
    }
    return out;
};
