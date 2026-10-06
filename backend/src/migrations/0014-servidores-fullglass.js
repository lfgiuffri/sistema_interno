/**
 * FullGlass en servidores (2026-10-06): actualización masiva de bases y deploy remoto.
 *
 * Agrega a `servidores` el flag de FullGlass, la ruta a escanear y los dos comandos de deploy,
 * y crea las tres tablas del mecanismo: los trabajos que el agente va a buscar, su resultado
 * POR BASE y el inventario de sitios que alimenta la vista previa.
 *
 * ⚠️ Ninguna de estas tablas guarda credenciales de los clientes. El agente lee
 * `config_site.php` en el servidor y reporta solo el nombre del sitio y el de la base.
 *
 * Idempotente: se puede correr dos veces.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    // ⚠️ showAllTables() devuelve OBJETOS en MariaDB: sin normalizar, el guard nunca corta.
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));

    // ── 1. Campos nuevos en servidores ───────────────────────────────────────────────────
    if (tablas.includes('servidores')) {
        const cols = await q.describeTable('servidores');
        const nuevas = [
            ['tieneFullglass', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
            ['rutaSitios', { type: Sequelize.STRING(255), allowNull: false, defaultValue: '/home' }],
            ['comandoDeployProd', { type: Sequelize.TEXT, allowNull: true }],
            ['comandoDeployDev', { type: Sequelize.TEXT, allowNull: true }]
        ];
        for (const [campo, def] of nuevas) {
            if (cols[campo]) continue;
            await q.addColumn('servidores', campo, def);
            console.log(`   ✓ servidores.${campo}`);
        }
    }

    // ── 2. Trabajos ──────────────────────────────────────────────────────────────────────
    if (!tablas.includes('servidor_trabajos')) {
        await q.createTable('servidor_trabajos', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            loteId: { type: Sequelize.STRING(64), allowNull: false },
            servidorId: { type: Sequelize.INTEGER, allowNull: false },
            tipo: { type: Sequelize.ENUM('sql', 'deploy'), allowNull: false },
            estado: {
                type: Sequelize.ENUM('pendiente', 'canario', 'espera_ok', 'aprobado', 'corriendo', 'ok', 'error', 'cancelado'),
                allowNull: false, defaultValue: 'pendiente'
            },
            sql: { type: Sequelize.TEXT, allowNull: true },
            comando: { type: Sequelize.TEXT, allowNull: true },
            entorno: { type: Sequelize.ENUM('produccion', 'desarrollo'), allowNull: true },
            sitios: { type: Sequelize.TEXT, allowNull: true },
            userId: { type: Sequelize.INTEGER, allowNull: true },
            aprobadoPorUserId: { type: Sequelize.INTEGER, allowNull: true },
            aprobadoAt: { type: Sequelize.DATE, allowNull: true },
            tomadoAt: { type: Sequelize.DATE, allowNull: true },
            finalizadoAt: { type: Sequelize.DATE, allowNull: true },
            salida: { type: Sequelize.TEXT('medium'), allowNull: true },
            error: { type: Sequelize.STRING(500), allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false }
        });
        await q.addIndex('servidor_trabajos', ['servidorId', 'estado'], { name: 'srv_trab_servidor_estado' });
        await q.addIndex('servidor_trabajos', ['loteId'], { name: 'srv_trab_lote' });
        await q.addIndex('servidor_trabajos', ['createdAt'], { name: 'srv_trab_created' });
        console.log('   ✓ servidor_trabajos');
    }

    // ── 3. Resultado por base ────────────────────────────────────────────────────────────
    if (!tablas.includes('servidor_trabajo_resultados')) {
        await q.createTable('servidor_trabajo_resultados', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            trabajoId: { type: Sequelize.INTEGER, allowNull: false },
            sitio: { type: Sequelize.STRING(255), allowNull: false },
            base: { type: Sequelize.STRING(120), allowNull: true },
            estado: { type: Sequelize.ENUM('ok', 'error', 'omitido'), allowNull: false },
            esCanario: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            filasAfectadas: { type: Sequelize.INTEGER, allowNull: true },
            sentenciasOk: { type: Sequelize.INTEGER, allowNull: true },
            error: { type: Sequelize.STRING(1000), allowNull: true },
            ms: { type: Sequelize.INTEGER, allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false }
        });
        await q.addIndex('servidor_trabajo_resultados', ['trabajoId'], { name: 'srv_res_trabajo' });
        await q.addIndex('servidor_trabajo_resultados', ['trabajoId', 'estado'], { name: 'srv_res_trabajo_estado' });
        console.log('   ✓ servidor_trabajo_resultados');
    }

    // ── 4. Inventario de sitios ──────────────────────────────────────────────────────────
    if (!tablas.includes('servidor_sitios')) {
        await q.createTable('servidor_sitios', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            servidorId: { type: Sequelize.INTEGER, allowNull: false },
            ruta: { type: Sequelize.STRING(255), allowNull: false },
            base: { type: Sequelize.STRING(120), allowNull: true },
            problema: { type: Sequelize.STRING(255), allowNull: true },
            ultimoReporteAt: { type: Sequelize.DATE, allowNull: false },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false }
        });
        await q.addIndex('servidor_sitios', ['servidorId', 'ruta'], { unique: true, name: 'srv_sitios_servidor_ruta' });
        console.log('   ✓ servidor_sitios');
    }
};
