/**
 * `servidores.sitiosReportadosAt` (2026-10-06): cuándo fue la última vez que el agente
 * reportó su inventario de sitios.
 *
 * Sin esto, la pantalla no puede distinguir dos situaciones muy distintas que se ven igual
 * (la tabla `servidor_sitios` vacía): que el worker NUNCA haya hablado —no está instalado, o
 * está fallando— o que haya recorrido la carpeta y no encontrado ningún sitio —la ruta está
 * mal—. Decía «el agente todavía no reportó» en los dos casos, y eso manda a buscar el
 * problema al lugar equivocado.
 *
 * Idempotente.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));
    if (!tablas.includes('servidores')) return;

    const cols = await q.describeTable('servidores');
    if (cols.sitiosReportadosAt) return;

    await q.addColumn('servidores', 'sitiosReportadosAt', { type: Sequelize.DATE, allowNull: true });
    console.log('   ✓ servidores.sitiosReportadosAt');
};
