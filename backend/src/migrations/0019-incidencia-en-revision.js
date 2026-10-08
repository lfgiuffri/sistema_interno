/**
 * Estado «en revisión» para las incidencias (2026-10-08).
 *
 * Hasta ahora una tarea `en_revision` le mostraba al cliente «en progreso»: el mapeo 5→3
 * escondía a propósito nuestro kanban interno. Pero este estado no es asunto nuestro — es el
 * momento en que la pelota pasa al cliente, y si no se lo decimos el trabajo queda esperando
 * un OK que nadie sabe que hay que dar.
 *
 * Tres cambios, todos aditivos (no se toca ni una fila existente):
 *   1. `incidencias.estado`        + 'en_revision'
 *   2. `incidencia_cambios.evento` + 'en_revision'  (la bitácora registra el paso)
 *   3. `clientes.avisaEnRevision`  (default TRUE: avisarle es el PUNTO del estado)
 *
 * ⚠️ Acá el orden «datos antes que el ALTER» de la migración 0012 NO aplica: aquella QUITABA
 * un valor del ENUM y las filas que lo tenían quedaban en cadena vacía. Esta solo AGREGA, así
 * que ninguna fila existente puede quedar fuera del tipo nuevo.
 *
 * Los ALTER van a mano y no por `queryInterface`: el conector de MariaDB rompe con
 * «Cannot delete property 'meta' of [object Array]» (mismo choque que las migraciones 0010 y
 * 0012). ⚠️ Por el mismo bug, un SELECT suelto con `sequelize.query` TAMBIÉN lo dispara: hay
 * que pasarle `type: QueryTypes.SELECT` o, mejor, no hacer el SELECT y leer el schema con
 * `describeTable`, que es lo que hacen las migraciones que ya funcionan. Para una ENUM alcanza:
 * `describeTable` devuelve el tipo declarado completo.
 *
 * La idempotencia es por ese mismo chequeo, porque MariaDB hace COMMIT implícito en DDL y una
 * corrida a medias no se deshace.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();

    const incidencias = await q.describeTable('incidencias');
    if (incidencias.estado && !String(incidencias.estado.type).includes("'en_revision'")) {
        await sequelize.query(
            `ALTER TABLE \`incidencias\` MODIFY COLUMN \`estado\`
             ENUM('nueva','en_progreso','en_revision','resuelta') NOT NULL DEFAULT 'nueva'`
        );
    }

    const cambios = await q.describeTable('incidencia_cambios');
    if (cambios.evento && !String(cambios.evento.type).includes("'en_revision'")) {
        await sequelize.query(
            `ALTER TABLE \`incidencia_cambios\` MODIFY COLUMN \`evento\`
             ENUM('creada','nueva','en_progreso','en_revision','resuelta') NOT NULL`
        );
    }

    // Default TRUE, y distinto de `avisaEnProgreso` (que nace en false): los pasos internos no
    // le interesan al cliente, pero «esto te está esperando a vos» sí. Un cliente que ya existe
    // no puede quedarse sin ese aviso por omisión.
    const clientes = await q.describeTable('clientes');
    if (!clientes.avisaEnRevision) {
        await sequelize.query(
            'ALTER TABLE `clientes` ADD COLUMN `avisaEnRevision` TINYINT(1) NOT NULL DEFAULT 1 AFTER `avisaEnProgreso`'
        );
    }
};
