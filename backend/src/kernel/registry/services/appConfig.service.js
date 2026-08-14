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
    MANTENIMIENTO_UMBRAL_CPU: {
        label: 'Alerta de CPU (%)',
        description: 'Uso de procesador sostenido a partir del cual un servidor alerta (50 a 100).',
        default: '90',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 50 || v > 100) throw new Error('El umbral de CPU tiene que estar entre 50 y 100');
            return String(v);
        },
    },
    MANTENIMIENTO_UMBRAL_RAM: {
        label: 'Alerta de memoria RAM (%)',
        description: 'Uso de memoria a partir del cual un servidor alerta (50 a 100).',
        default: '90',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 50 || v > 100) throw new Error('El umbral de RAM tiene que estar entre 50 y 100');
            return String(v);
        },
    },
    MANTENIMIENTO_UMBRAL_DISCO: {
        label: 'Alerta de disco (%)',
        description: 'Uso del disco más lleno a partir del cual un servidor alerta (50 a 100).',
        default: '85',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 50 || v > 100) throw new Error('El umbral de disco tiene que estar entre 50 y 100');
            return String(v);
        },
    },
    MANTENIMIENTO_MINUTOS_SIN_REPORTE: {
        label: 'Minutos sin reporte para marcar caído',
        description: 'Cuántos minutos sin señal del agente hacen que un servidor cuente como caído (2 a 60).',
        default: '5',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 2 || v > 60) throw new Error('Los minutos sin reporte tienen que estar entre 2 y 60');
            return String(v);
        },
    },
    MANTENIMIENTO_FALLOS_PARA_ALERTA: {
        label: 'Chequeos fallidos para alertar un sitio',
        description: 'Cuántos chequeos seguidos (de 5 minutos) tiene que fallar un sitio antes de avisar (1 a 10).',
        default: '2',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1 || v > 10) throw new Error('Los chequeos fallidos tienen que estar entre 1 y 10');
            return String(v);
        },
    },
    MANTENIMIENTO_DIAS_AVISO_DOMINIO: {
        label: 'Días de aviso de vencimiento de dominio',
        description: 'Con cuánta anticipación se avisa que un dominio está por vencer (1 a 180).',
        default: '30',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1 || v > 180) throw new Error('Los días de aviso de dominio tienen que estar entre 1 y 180');
            return String(v);
        },
    },
    MANTENIMIENTO_DIAS_AVISO_TLS: {
        label: 'Días de aviso de vencimiento de certificado',
        description: 'Con cuánta anticipación se avisa que un certificado HTTPS está por vencer (1 a 90).',
        default: '15',
        parse: (raw) => {
            const v = parseInt(raw, 10);
            if (!Number.isFinite(v) || v < 1 || v > 90) throw new Error('Los días de aviso del certificado tienen que estar entre 1 y 90');
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
