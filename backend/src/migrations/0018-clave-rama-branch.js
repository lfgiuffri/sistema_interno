/**
 * El default de `servidores.claveRama` pasa de `entorno` a `branch` (2026-10-07).
 *
 * La `0016` la creó con `entorno`, que era una suposición: la clave real con la que FullGlass
 * marca la rama en `config_site.php` es `branch`. Se corrigen también las filas que quedaron
 * con el valor viejo — todas, porque la función todavía no se usó en ningún servidor y nadie
 * pudo haber elegido `entorno` a propósito.
 *
 * Idempotente.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));
    if (!tablas.includes('servidores')) return;

    const cols = await q.describeTable('servidores');
    if (!cols.claveRama) return;

    // ALTER a mano y no `changeColumn`: con el conector de MariaDB, los helpers de
    // queryInterface vienen dando problemas (ver 0012) y un ALTER directo es inequívoco.
    await sequelize.query(
        "ALTER TABLE servidores MODIFY COLUMN claveRama VARCHAR(60) NOT NULL DEFAULT 'branch'"
    );
    const [, meta] = await sequelize.query("UPDATE servidores SET claveRama = 'branch' WHERE claveRama = 'entorno'");
    console.log(`   ✓ servidores.claveRama → default 'branch' (${meta?.affectedRows ?? 0} fila(s) migradas)`);
};
