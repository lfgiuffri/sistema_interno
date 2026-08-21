/**
 * Vistas por sitio + rollup diario de velocidad.
 *
 * Un sitio pasa a tener N URLs chequeables (`/`, `/ecommerce`, …), cada una con su propio
 * «esto lo administramos nosotros» y su propio estado. Para que nada cambie para los sitios
 * que ya existen, la migración le crea a cada uno la vista `/` **heredando su estado actual**:
 * el chequeo sigue de largo sin un ciclo en `desconocido` y sin disparar alertas falsas.
 *
 * También crea `sitio_velocidad_dia`, que es lo que permite preguntar por la velocidad de un
 * mes o de un año: el detalle por chequeo se purga a los 30 días.
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

    // Sin sitios web el módulo no está montado: no hay nada que migrar.
    if (!tablas.includes('sitios_web')) {
        console.log('   ↷ sitios_web no existe; nada que hacer');
        return;
    }

    if (!tablas.includes('sitio_vistas')) {
        await q.createTable('sitio_vistas', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            sitioId: { type: Sequelize.INTEGER, allowNull: false },
            ruta: { type: Sequelize.STRING(190), allowNull: false, defaultValue: '/' },
            nombre: { type: Sequelize.STRING(100), allowNull: true },
            verificaMarcador: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            marcadorId: { type: Sequelize.STRING(100), allowNull: true },
            estado: { type: Sequelize.ENUM('online', 'sin_marcador', 'offline', 'desconocido'), allowNull: false, defaultValue: 'desconocido' },
            ultimoChequeoAt: { type: Sequelize.DATE, allowNull: true },
            ultimoCodigo: { type: Sequelize.INTEGER, allowNull: true },
            tiempoMs: { type: Sequelize.INTEGER, allowNull: true },
            fallosSeguidos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            orden: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false },
            deletedAt: { type: Sequelize.DATE, allowNull: true },
        });
        await q.addIndex('sitio_vistas', ['sitioId'], { name: 'sitio_vistas_sitio' });
        await q.addIndex('sitio_vistas', ['activo'], { name: 'sitio_vistas_activo' });
        await q.addIndex('sitio_vistas', ['estado'], { name: 'sitio_vistas_estado' });
        await q.addConstraint('sitio_vistas', {
            fields: ['sitioId'], type: 'foreign key', name: 'sitio_vistas_sitio_fk',
            references: { table: 'sitios_web', field: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE',
        });
        console.log('   ✓ sitio_vistas creada');
    }

    if (!tablas.includes('sitio_velocidad_dia')) {
        await q.createTable('sitio_velocidad_dia', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            sitioId: { type: Sequelize.INTEGER, allowNull: false },
            vistaId: { type: Sequelize.INTEGER, allowNull: false },
            fecha: { type: Sequelize.DATEONLY, allowNull: false },
            muestras: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
            promedioMs: { type: Sequelize.INTEGER, allowNull: true },
            minMs: { type: Sequelize.INTEGER, allowNull: true },
            maxMs: { type: Sequelize.INTEGER, allowNull: true },
            disponibilidad: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false },
        });
        // Único: el rollup de un día se puede re-correr y actualiza la fila en vez de duplicarla.
        await q.addIndex('sitio_velocidad_dia', ['vistaId', 'fecha'], { unique: true, name: 'sitio_velocidad_dia_vista_fecha' });
        await q.addIndex('sitio_velocidad_dia', ['sitioId', 'fecha'], { name: 'sitio_velocidad_dia_sitio_fecha' });
        console.log('   ✓ sitio_velocidad_dia creada');
    }

    // Columnas nuevas en las tablas que ya existían.
    const columnas = async (tabla) => Object.keys(await q.describeTable(tabla));

    if (tablas.includes('sitio_chequeos')) {
        if (!(await columnas('sitio_chequeos')).includes('vistaId')) {
            await q.addColumn('sitio_chequeos', 'vistaId', { type: Sequelize.INTEGER, allowNull: true });
            await q.addIndex('sitio_chequeos', ['vistaId', 'createdAt'], { name: 'sitio_chequeos_vista' });
            console.log('   ✓ sitio_chequeos.vistaId');
        }
    }
    if (tablas.includes('sitio_incidentes')) {
        if (!(await columnas('sitio_incidentes')).includes('vistaId')) {
            await q.addColumn('sitio_incidentes', 'vistaId', { type: Sequelize.INTEGER, allowNull: true });
            await q.addIndex('sitio_incidentes', ['vistaId', 'tipo', 'resueltoAt'], { name: 'sitio_incidentes_vista' });
            console.log('   ✓ sitio_incidentes.vistaId');
        }
    }

    // A cada sitio sin vistas se le crea la `/` HEREDANDO su estado actual: así el chequeo
    // sigue donde estaba (mismo `fallosSeguidos`, mismo estado) y no avisa una caída falsa.
    const [creadas] = await sequelize.query(`
        INSERT INTO sitio_vistas
            (sitioId, ruta, nombre, verificaMarcador, marcadorId, estado, ultimoChequeoAt,
             ultimoCodigo, tiempoMs, fallosSeguidos, activo, orden, createdAt, updatedAt)
        SELECT s.id, '/', NULL, s.verificaMarcador, NULL, s.estado, s.ultimoChequeoAt,
               s.ultimoCodigo, s.tiempoMs, s.fallosSeguidos, 1, 0, NOW(), NOW()
        FROM sitios_web s
        WHERE s.deletedAt IS NULL
          AND NOT EXISTS (SELECT 1 FROM sitio_vistas v WHERE v.sitioId = s.id AND v.deletedAt IS NULL)
    `);
    console.log(`   ✓ vista «/» creada para ${creadas?.affectedRows ?? 0} sitio(s)`);

    // Los chequeos e incidentes viejos se ligan a esa vista `/`: son de cuando el sitio era
    // una sola URL, así que ahí es donde corresponden. Sin esto, el historial y la velocidad
    // de la home arrancarían vacíos.
    await sequelize.query(`
        UPDATE sitio_chequeos c
          JOIN sitio_vistas v ON v.sitioId = c.sitioId AND v.ruta = '/' AND v.deletedAt IS NULL
           SET c.vistaId = v.id
         WHERE c.vistaId IS NULL
    `);
    // Los de disponibilidad sí (son de la ruta); dominio y TLS NO (son del host).
    await sequelize.query(`
        UPDATE sitio_incidentes i
          JOIN sitio_vistas v ON v.sitioId = i.sitioId AND v.ruta = '/' AND v.deletedAt IS NULL
           SET i.vistaId = v.id
         WHERE i.vistaId IS NULL AND i.tipo IN ('offline', 'sin_marcador')
    `);
    console.log('   ✓ chequeos e incidentes viejos ligados a la vista «/»');
};
