/**
 * Alertas configurables por servidor.
 *
 * Hasta acá, todo servidor monitoreado avisaba de las cuatro cosas (caída, CPU, RAM y disco)
 * y lo único regulable era el umbral. Eso no alcanza para el servidor que legítimamente vive
 * con el disco al 95%, ni para el de pruebas que se apaga los fines de semana: la única
 * salida era sacarlo del monitoreo entero y perder también las métricas.
 *
 * Las cuatro columnas nacen en `true`, así que al desplegar NADA cambia: quien no toque nada
 * sigue recibiendo exactamente los mismos avisos que hoy. Apagar es una decisión explícita.
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

    // Sin servidores el módulo de mantenimiento no está montado: no hay nada que migrar.
    if (!tablas.includes('servidores')) {
        console.log('   ↷ servidores no existe; nada que hacer');
        return;
    }

    const columnas = await q.describeTable('servidores');
    for (const nombre of ['alertaOffline', 'alertaCpu', 'alertaRam', 'alertaDisco']) {
        if (columnas[nombre]) continue;
        await q.addColumn('servidores', nombre, {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        });
        console.log(`   ✓ servidores.${nombre}`);
    }
};
