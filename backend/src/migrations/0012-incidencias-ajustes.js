import { QueryTypes } from 'sequelize';

/**
 * Ajustes de incidencias (2026-09-18), tres cosas:
 *
 * 1. **Se elimina el estado `cerrada`.** Se pisaba con `resuelta`: en el portal las dos iban al
 *    fondo y decían lo mismo, así que la única diferencia real era acordarse de cerrar. Las
 *    filas existentes en `cerrada` pasan a `resuelta` ANTES de tocar el ENUM (si no, MySQL las
 *    convierte en cadena vacía sin avisar). Cae también `clientes.avisaCerrada`.
 * 2. **`cerradaAt` pasa a `resueltaAt`**, que es lo que mide ahora.
 * 3. **`incidencias.fechaEstimada`**: la fecha en que estimamos resolverla, copiada del
 *    vencimiento de la tarea vinculada, para que el cliente la vea en su portal.
 *
 * Idempotente: se puede correr dos veces.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));
    if (!tablas.includes('incidencias')) {
        console.log('   ↷ incidencias no existe; nada que hacer');
        return;
    }

    const cols = await q.describeTable('incidencias');

    // 1. Los datos ANTES que el ENUM: cambiar el tipo con filas en `cerrada` las dejaría en ''.
    const [{ n: enCerrada }] = await sequelize.query(
        "SELECT COUNT(*) AS n FROM incidencias WHERE estado = 'cerrada'", { type: QueryTypes.SELECT }
    );
    if (Number(enCerrada) > 0) {
        await sequelize.query("UPDATE incidencias SET estado = 'resuelta' WHERE estado = 'cerrada'");
        console.log(`   ✓ ${enCerrada} incidencia(s) pasaron de «cerrada» a «resuelta»`);
    }
    await sequelize.query(
        "UPDATE incidencia_cambios SET evento = 'resuelta', estadoNuevo = 'resuelta' WHERE evento = 'cerrada'"
    ).catch(() => null);

    // 2. ENUMs (idempotente: reescribirlos con el mismo valor no hace daño).
    await sequelize.query(
        "ALTER TABLE incidencias MODIFY COLUMN estado ENUM('nueva','en_progreso','resuelta') NOT NULL DEFAULT 'nueva'"
    );
    await sequelize.query(
        "ALTER TABLE incidencia_cambios MODIFY COLUMN evento ENUM('creada','nueva','en_progreso','resuelta') NOT NULL"
    );
    console.log('   ✓ estados de incidencia: nueva | en_progreso | resuelta');

    // 3. `cerradaAt` → `resueltaAt`.
    if (cols.cerradaAt && !cols.resueltaAt) {
        await q.renameColumn('incidencias', 'cerradaAt', 'resueltaAt');
        console.log('   ✓ incidencias.cerradaAt → resueltaAt');
    }

    // 4. Fecha estimada de resolución.
    if (!cols.fechaEstimada) {
        await q.addColumn('incidencias', 'fechaEstimada', { type: Sequelize.DATEONLY, allowNull: true });
        console.log('   ✓ incidencias.fechaEstimada');
    }

    // 5. El aviso del estado que ya no existe.
    //
    // ⚠️ ALTER a mano y no `q.removeColumn`: con el conector de MariaDB, removeColumn rompe con
    // «Cannot delete property 'meta' of [object Array]» (el mismo choque de la migración 0010).
    // Los ALTER de arriba pasan sin problema, así que se usa la misma forma. El guard por
    // `describeTable` mantiene la idempotencia.
    const colsCliente = await q.describeTable('clientes');
    if (colsCliente.avisaCerrada) {
        await sequelize.query('ALTER TABLE clientes DROP COLUMN avisaCerrada');
        console.log('   ✓ clientes.avisaCerrada eliminada (el estado ya no existe)');
    }
};
