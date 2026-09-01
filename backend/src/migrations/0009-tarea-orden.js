/**
 * Orden manual de tareas dentro de una lista (arrastrar y soltar).
 *
 * `orden` en múltiplos de 10, igual que en documentación. Nace en **0** para todas: como el
 * listado ordena por `orden` y desempata con el orden automático del legado (prioridad →
 * vencimiento → creación), una lista que nadie acomodó a mano se sigue viendo EXACTAMENTE
 * igual que antes de esta migración. No hace falta sembrar nada.
 *
 * Las completadas no entran en el juego: van al fondo por estado, antes de mirar `orden`.
 *
 * Idempotente: se puede correr dos veces. Ojo con `showAllTables()`, que en MariaDB devuelve
 * OBJETOS (`{ tableName, schema }`) y no strings — sin normalizar, el guard no corta nunca.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));

    if (!tablas.includes('tareas')) {
        console.log('   ↷ tareas no existe; nada que hacer');
        return;
    }

    const columnas = await q.describeTable('tareas');
    if (!columnas.orden) {
        await q.addColumn('tareas', 'orden', {
            type: Sequelize.INTEGER,
            allowNull: false,
            defaultValue: 0,
        });
        console.log('   ✓ tareas.orden');
    }

    // El listado filtra por lista y ordena por `orden`: el índice compuesto es el que sirve.
    const indices = await q.showIndex('tareas');
    if (!indices.some(i => i.name === 'tareas_lista_id_orden')) {
        await q.addIndex('tareas', ['listaId', 'orden'], { name: 'tareas_lista_id_orden' });
        console.log('   ✓ índice tareas_lista_id_orden');
    }
};
