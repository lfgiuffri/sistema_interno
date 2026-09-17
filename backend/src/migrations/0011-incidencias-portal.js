/**
 * Incidencias + portal de clientes: todo el schema de la feature en una migración.
 *
 * Va junto y no en partes porque es un despliegue: las tablas de incidencias sin los usuarios
 * de portal no sirven para nada, y al revés tampoco.
 *
 * Los `avisa*` de `clientes` nacen con los defaults pedidos (avisa al crearse, al resolverse y
 * al cerrarse; los pasos intermedios no), así que un cliente que ya existe queda configurado
 * de entrada sin que nadie toque nada.
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

    // ── 1. Campos nuevos en clientes ────────────────────────────────────────────────
    if (tablas.includes('clientes')) {
        const cols = await q.describeTable('clientes');
        if (!cols.emailsNotificacion) {
            await q.addColumn('clientes', 'emailsNotificacion', { type: Sequelize.TEXT, allowNull: true });
            console.log('   ✓ clientes.emailsNotificacion');
        }
        const avisos = [
            ['avisaCreada', true], ['avisaNueva', false], ['avisaEnProgreso', false],
            ['avisaResuelta', true], ['avisaCerrada', true]
        ];
        for (const [campo, porDefecto] of avisos) {
            if (cols[campo]) continue;
            await q.addColumn('clientes', campo, {
                type: Sequelize.BOOLEAN, allowNull: false, defaultValue: porDefecto
            });
            console.log(`   ✓ clientes.${campo} (default ${porDefecto})`);
        }
    }

    // ── 2. Usuarios del portal ──────────────────────────────────────────────────────
    if (!tablas.includes('cliente_usuarios')) {
        await q.createTable('cliente_usuarios', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            clienteId: { type: Sequelize.INTEGER, allowNull: false },
            nombre: { type: Sequelize.STRING(160), allowNull: false },
            email: { type: Sequelize.STRING(160), allowNull: false },
            password: { type: Sequelize.STRING(255), allowNull: false },
            activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
            ultimoAccesoAt: { type: Sequelize.DATE, allowNull: true },
            ultimoAccesoIp: { type: Sequelize.STRING(45), allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false },
            deletedAt: { type: Sequelize.DATE, allowNull: true }
        });
        await q.addIndex('cliente_usuarios', ['clienteId'], { name: 'cliente_usuarios_cliente' });
        await q.addIndex('cliente_usuarios', ['email'], { name: 'cliente_usuarios_email' });
        await sequelize.query(`ALTER TABLE cliente_usuarios
            ADD CONSTRAINT cliente_usuarios_ibfk_1 FOREIGN KEY (clienteId) REFERENCES clientes (id)
            ON DELETE CASCADE ON UPDATE CASCADE`);
        console.log('   ✓ cliente_usuarios');
    }

    // Lockout del portal en tabla PROPIA: `lockout.service.js` borra los fallos por IP al
    // loguear bien, así que compartir tabla dejaría que un login de portal exitoso limpie el
    // contador de fuerza bruta del login interno para esa IP.
    if (!tablas.includes('portal_login_attempts')) {
        await q.createTable('portal_login_attempts', {
            id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
            username: { type: Sequelize.STRING(160), allowNull: true },
            ip: { type: Sequelize.STRING(45), allowNull: true },
            success: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
            createdAt: { type: Sequelize.DATE, allowNull: false }
        });
        await q.addIndex('portal_login_attempts', ['username', 'ip', 'createdAt'], { name: 'portal_login_attempts_busqueda' });
        console.log('   ✓ portal_login_attempts');
    }

    // ── 3. Incidencias ──────────────────────────────────────────────────────────────
    if (!tablas.includes('incidencias')) {
        await q.createTable('incidencias', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            clienteId: { type: Sequelize.INTEGER, allowNull: false },
            servicioId: { type: Sequelize.INTEGER, allowNull: true },
            titulo: { type: Sequelize.STRING(200), allowNull: false },
            descripcion: { type: Sequelize.TEXT, allowNull: true },
            estado: {
                type: Sequelize.ENUM('nueva', 'en_progreso', 'resuelta', 'cerrada'),
                allowNull: false, defaultValue: 'nueva'
            },
            tareaId: { type: Sequelize.INTEGER, allowNull: true },
            creadaPorClienteUsuarioId: { type: Sequelize.INTEGER, allowNull: true },
            creadaPorUserId: { type: Sequelize.INTEGER, allowNull: true },
            cerradaAt: { type: Sequelize.DATE, allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false },
            deletedAt: { type: Sequelize.DATE, allowNull: true }
        });
        // UNIQUE y no índice común: una incidencia se convierte en UNA tarea. Además hace
        // barata la propagación (buscar por tareaId) y evita el doble vínculo si alguien
        // aprieta dos veces «crear tarea».
        await q.addIndex('incidencias', ['tareaId'], { name: 'incidencias_tarea', unique: true });
        await q.addIndex('incidencias', ['clienteId'], { name: 'incidencias_cliente' });
        await q.addIndex('incidencias', ['estado'], { name: 'incidencias_estado' });
        await q.addIndex('incidencias', ['createdAt'], { name: 'incidencias_created' });
        console.log('   ✓ incidencias');
    }

    if (!tablas.includes('incidencia_cambios')) {
        await q.createTable('incidencia_cambios', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            incidenciaId: { type: Sequelize.INTEGER, allowNull: false },
            evento: {
                type: Sequelize.ENUM('creada', 'nueva', 'en_progreso', 'resuelta', 'cerrada'),
                allowNull: false
            },
            estadoAnterior: { type: Sequelize.STRING(20), allowNull: true },
            estadoNuevo: { type: Sequelize.STRING(20), allowNull: true },
            detalle: { type: Sequelize.STRING(255), allowNull: true },
            userId: { type: Sequelize.INTEGER, allowNull: true },
            clienteUsuarioId: { type: Sequelize.INTEGER, allowNull: true },
            notificadoAt: { type: Sequelize.DATE, allowNull: true },
            notificado: { type: Sequelize.BOOLEAN, allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false }
        });
        await q.addIndex('incidencia_cambios', ['incidenciaId', 'createdAt'], { name: 'incidencia_cambios_inc' });
        // El índice que usa el tick del outbox para encontrar lo pendiente.
        await q.addIndex('incidencia_cambios', ['notificadoAt'], { name: 'incidencia_cambios_pendientes' });
        await sequelize.query(`ALTER TABLE incidencia_cambios
            ADD CONSTRAINT incidencia_cambios_ibfk_1 FOREIGN KEY (incidenciaId) REFERENCES incidencias (id)
            ON DELETE CASCADE ON UPDATE CASCADE`);
        console.log('   ✓ incidencia_cambios');
    }

    if (!tablas.includes('incidencia_archivos')) {
        await q.createTable('incidencia_archivos', {
            id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
            nombre: { type: Sequelize.STRING(60), allowNull: false, unique: true },
            nombreOriginal: { type: Sequelize.STRING(200), allowNull: true },
            tipo: { type: Sequelize.ENUM('imagen', 'archivo'), allowNull: false, defaultValue: 'archivo' },
            mime: { type: Sequelize.STRING(100), allowNull: true },
            size: { type: Sequelize.INTEGER, allowNull: true },
            incidenciaId: { type: Sequelize.INTEGER, allowNull: true },
            // Desnormalizado y NOT NULL: el archivo se sube antes de que exista la incidencia,
            // y durante esa ventana es lo único que dice de quién es.
            clienteId: { type: Sequelize.INTEGER, allowNull: false },
            clienteUsuarioId: { type: Sequelize.INTEGER, allowNull: true },
            userId: { type: Sequelize.INTEGER, allowNull: true },
            createdAt: { type: Sequelize.DATE, allowNull: false },
            updatedAt: { type: Sequelize.DATE, allowNull: false }
        });
        await q.addIndex('incidencia_archivos', ['incidenciaId'], { name: 'incidencia_archivos_inc' });
        await q.addIndex('incidencia_archivos', ['clienteId'], { name: 'incidencia_archivos_cliente' });
        await q.addIndex('incidencia_archivos', ['createdAt'], { name: 'incidencia_archivos_created' });
        console.log('   ✓ incidencia_archivos');
    }
};
