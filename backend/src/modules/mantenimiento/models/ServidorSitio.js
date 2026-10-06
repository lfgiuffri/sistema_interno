import { DataTypes } from 'sequelize';

/**
 * Inventario de sitios de un servidor, tal como lo reporta su agente.
 *
 * Alimenta la VISTA PREVIA: antes de correr un SQL masivo hay que poder ver sobre cuántas
 * bases va a impactar y destildar alguna. Si eso se preguntara al servidor en el momento,
 * lanzar sería un ida y vuelta de un minuto; el agente lo reporta junto con las métricas y la
 * pantalla lo muestra al instante.
 *
 * ⚠️ Acá tampoco hay credenciales: solo la carpeta del sitio y el nombre de la base. Es lo
 * mínimo para poder elegir, y lo máximo que la app tiene derecho a saber.
 *
 * Las filas se REEMPLAZAN en cada reporte (un sitio que ya no está desaparece), por eso
 * `ultimoReporteAt`: una lista vieja llevaría a creer que se va a tocar algo que no existe.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ServidorSitio.
 */
export const defineServidorSitioModel = (db) => {
    const ServidorSitio = db.define('servidor_sitios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        servidorId: { type: DataTypes.INTEGER, allowNull: false },
        /** Carpeta del sitio (ej. `/home/clienteX`). */
        ruta: { type: DataTypes.STRING(255), allowNull: false },
        base: { type: DataTypes.STRING(120), allowNull: true },
        /** Por qué no se pudo leer su config, si pasó (sin credenciales en el texto). */
        problema: { type: DataTypes.STRING(255), allowNull: true },
        ultimoReporteAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'servidor_sitios',
        timestamps: true,
        paranoid: false,
        indexes: [{ unique: true, fields: ['servidorId', 'ruta'] }]
    });

    /**
     * Asociación con su servidor.
     * @param {object} models - Modelos de la app.
     * @returns {void}
     */
    ServidorSitio.associate = (models) => {
        if (models.Servidor) ServidorSitio.belongsTo(models.Servidor, { foreignKey: 'servidorId' });
    };

    return ServidorSitio;
};
