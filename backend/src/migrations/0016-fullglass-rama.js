/**
 * Rama de cada cliente de FullGlass (2026-10-07): saber si está en `main` o en `dev`, y poder
 * cambiarlo desde la app.
 *
 * Cuando se desarrolla algo a medida para un cliente se lo pasa a `dev` para que lo pruebe, y
 * después vuelve a `main`. Hoy eso se hace entrando al servidor y tocando varios archivos del
 * cliente, y no hay forma de ver de un vistazo quién quedó en dev.
 *
 * La rama NO se guarda como un dato de la app: la REPORTA el agente leyéndola del servidor
 * (`servidor_sitios.rama`). Si la guardáramos nosotros, el día que alguien la cambie a mano
 * la pantalla mentiría y nadie se enteraría — que es justo el error que esto viene a evitar.
 *
 * Idempotente.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @param {object} Sequelize - Constructores de tipos.
 * @returns {Promise<void>}
 */
export const up = async (sequelize, Sequelize) => {
    const q = sequelize.getQueryInterface();
    const tablas = (await q.showAllTables()).map(t => String(t?.tableName ?? t));

    /**
     * Agrega una columna si no está.
     * @param {string} tabla - Tabla.
     * @param {string} campo - Columna.
     * @param {object} def - Definición Sequelize.
     * @returns {Promise<void>}
     */
    const sumar = async (tabla, campo, def) => {
        if (!tablas.includes(tabla)) return;
        const cols = await q.describeTable(tabla);
        if (cols[campo]) return;
        await q.addColumn(tabla, campo, def);
        console.log(`   ✓ ${tabla}.${campo}`);
    };

    // Lo que el agente lee del servidor. Texto libre y no ENUM: si mañana aparece una rama
    // `staging`, la app la muestra igual en vez de romper la ingesta del inventario.
    await sumar('servidor_sitios', 'rama', { type: Sequelize.STRING(60), allowNull: true });

    // Dónde buscar la rama dentro del `config_site.php` del cliente. Configurable porque es una
    // convención de FullGlass que la app no tiene por qué saber de memoria, y puede diferir
    // entre servidores viejos y nuevos.
    await sumar('servidores', 'claveRama', { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'entorno' });

    // El script que cambia de rama lo deja el equipo en cada servidor; acá se guarda CÓMO
    // invocarlo. `{sitio}` y `{rama}` se reemplazan al lanzar.
    await sumar('servidores', 'comandoCambiarRama', { type: Sequelize.TEXT, allowNull: true });

    // Vínculo entre el sitio que se monitorea (su URL) y su carpeta en el servidor. Sin esto
    // no hay manera de saber qué `/home/<cliente>` le corresponde a cada sitio web, y la rama
    // no se podría mostrar en ese listado.
    await sumar('sitios_web', 'rutaFullglass', { type: Sequelize.STRING(255), allowNull: true });

    // Un trabajo de cambio de rama guarda a qué rama se pidió ir.
    await sumar('servidor_trabajos', 'rama', { type: Sequelize.STRING(60), allowNull: true });

    // El tipo de trabajo nuevo. Se reescribe el ENUM con los tres valores (idempotente).
    if (tablas.includes('servidor_trabajos')) {
        await sequelize.query(
            "ALTER TABLE servidor_trabajos MODIFY COLUMN tipo ENUM('sql','deploy','rama') NOT NULL"
        );
        console.log('   ✓ servidor_trabajos.tipo admite «rama»');
    }
};
