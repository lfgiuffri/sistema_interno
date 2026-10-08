/**
 * `sitios_web.usaFullglass` (2026-10-07): marcar qué sitios corren FullGlass.
 *
 * Hay sitios viejos que no lo usan, y sin distinguirlos el listado mezclaría peras con
 * manzanas: a los que no son FullGlass no se les puede ver la rama ni cambiársela, y mostrar
 * una columna vacía para ellos invita a pensar que falta un dato.
 *
 * Es el mismo criterio que `servidores.tieneFullglass`: una marca explícita y no deducirlo de
 * que la ruta esté cargada. Un sitio puede ser de FullGlass y todavía no tener la carpeta
 * vinculada —el orden en que se cargan los datos no debería cambiar lo que el sitio ES—, y así
 * «no usa FullGlass» no se confunde con «usa, pero falta vincularlo».
 *
 * Va separada de la `0016` porque esa ya está aplicada: reescribir una migración corrida es
 * pedir que la base de alguien quede distinta de la de los demás.
 *
 * Idempotente.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));
    if (!tablas.includes('sitios_web')) return;

    const cols = await q.describeTable('sitios_web');
    if (cols.usaFullglass) return;

    await q.addColumn('sitios_web', 'usaFullglass', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false
    });
    console.log('   ✓ sitios_web.usaFullglass');
};
