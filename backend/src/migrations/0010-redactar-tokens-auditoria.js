import { QueryTypes } from 'sequelize';

/**
 * Tacha los tokens que quedaron en texto plano en las tablas de auditoría.
 *
 * `middlewares/actionTracking.js` guardaba `JSON.stringify(req.headers)` SIN redactar en cada
 * request: al detectarlo había 38.553 de 43.159 filas de `actionTrackings` con el
 * `x-access-token` del usuario legible. La fuga ya está tapada (`libs/redaccion.js`), pero las
 * filas viejas siguen ahí, y ahí siguen también en cualquier backup o dump que se haya hecho.
 *
 * Los tokens históricos ya expiraron (15 minutos), así que el riesgo inmediato es bajo; lo que
 * se corrige es que la tabla deje de ser un repositorio de credenciales. Se tacha el VALOR y se
 * deja la clave, para no perder el dato de auditoría de que el header venía.
 *
 * ⚠️ Solo toca las filas que tienen el patrón: es idempotente y re-ejecutable, y si la tabla
 * está limpia no escribe nada.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));

    /** Claves de header cuyo valor hay que tachar en el JSON ya persistido. */
    const CLAVES = ['x-access-token', 'x-refresh-token', 'authorization', 'cookie'];

    /**
     * Cuántas filas de la tabla todavía tienen un valor sin tachar para alguna de las claves.
     * @param {string} tabla - Tabla de auditoría.
     * @returns {Promise<number>} Cantidad de filas con secretos legibles.
     */
    const pendientes = async (tabla) => {
        const condiciones = CLAVES
            .map(c => `(\`header\` LIKE '%"${c}":"%' AND \`header\` NOT LIKE '%"${c}":"[REDACTED]"%')`)
            .join(' OR ');
        const filas = await sequelize.query(
            `SELECT COUNT(*) AS n FROM \`${tabla}\` WHERE ${condiciones}`,
            { type: QueryTypes.SELECT }
        );
        return Number(filas?.[0]?.n) || 0;
    };

    for (const tabla of ['actionTrackings', 'errorLogs']) {
        if (!tablas.includes(tabla)) continue;

        // Se cuenta antes y después en vez de sumar `affectedRows`: el metadata del UPDATE no
        // viaja igual en todos los dialectos y un conteo que miente no sirve para auditar.
        const antes = await pendientes(tabla);
        if (!antes) continue;

        for (const clave of CLAVES) {
            // REGEXP_REPLACE está en MariaDB 10.0+ y MySQL 8+. Reemplaza `"clave":"loquesea"`
            // por `"clave":"[REDACTED]"` dentro del JSON guardado como texto. El WHERE evita
            // reescribir las filas ya tachadas (y hace la migración barata al re-ejecutarse).
            await sequelize.query(
                `UPDATE \`${tabla}\`
                    SET \`header\` = REGEXP_REPLACE(\`header\`, '"${clave}":"[^"]*"', '"${clave}":"[REDACTED]"')
                  WHERE \`header\` LIKE '%"${clave}":"%'
                    AND \`header\` NOT LIKE '%"${clave}":"[REDACTED]"%'`
            );
        }

        const despues = await pendientes(tabla);
        console.log(`   ✓ ${tabla}: ${antes - despues} fila(s) tachadas, ${despues} pendiente(s)`);
    }
};
