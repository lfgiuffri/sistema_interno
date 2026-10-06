import { DataTypes } from 'sequelize';

/**
 * Resultado de un trabajo EN UNA BASE concreta.
 *
 * Existe porque el script PHP que esto reemplaza no lo tenía: anotaba la query en un `.txt` y
 * nada más, así que si fallaba en el sitio 12 de 30 el registro decía igual que la query se
 * había corrido. Acá cada base deja su propia fila con filas afectadas o el error textual, y
 * recién cuando están todas se sabe si el trabajo salió bien.
 *
 * ⚠️ NO guarda credenciales. El agente lee `config_site.php` en el servidor y manda solo el
 * nombre del sitio y el de la base: usuario y contraseña de los clientes nunca viajan a la app
 * ni se persisten acá.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ServidorTrabajoResultado.
 */
export const defineServidorTrabajoResultadoModel = (db) => {
    const ServidorTrabajoResultado = db.define('servidor_trabajo_resultados', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        trabajoId: { type: DataTypes.INTEGER, allowNull: false },
        /** Carpeta del sitio (ej. `/home/clienteX`): es como lo identifica el agente. */
        sitio: { type: DataTypes.STRING(255), allowNull: false },
        /** Nombre de la base. Nunca el usuario ni la contraseña. */
        base: { type: DataTypes.STRING(120), allowNull: true },
        estado: { type: DataTypes.ENUM('ok', 'error', 'omitido'), allowNull: false },
        /** true si esta fila es la prueba que se corre ANTES de aprobar el resto. */
        esCanario: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        filasAfectadas: { type: DataTypes.INTEGER, allowNull: true },
        /** Cuántas sentencias del SQL llegaron a aplicarse (para saber dónde cortó). */
        sentenciasOk: { type: DataTypes.INTEGER, allowNull: true },
        error: { type: DataTypes.STRING(1000), allowNull: true },
        ms: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'servidor_trabajo_resultados',
        timestamps: true,
        updatedAt: false,  // append-only: un resultado no se corrige, se vuelve a correr
        paranoid: false,
        indexes: [{ fields: ['trabajoId'] }, { fields: ['trabajoId', 'estado'] }]
    });

    /**
     * Asociación con su trabajo.
     * @param {object} models - Modelos de la app.
     * @returns {void}
     */
    ServidorTrabajoResultado.associate = (models) => {
        if (models.ServidorTrabajo) {
            ServidorTrabajoResultado.belongsTo(models.ServidorTrabajo, { foreignKey: 'trabajoId' });
        }
    };

    return ServidorTrabajoResultado;
};
