import { DataTypes } from 'sequelize';

/**
 * Modelo ServidorMetricaDia: resumen DIARIO por servidor (promedio y máximo de cada métrica).
 *
 * Lo escribe el rollup del scheduler antes de purgar el detalle: permite ver la tendencia de
 * meses o años con un registro por día (~365 filas al año por servidor) en vez de medio millón.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ServidorMetricaDia.
 */
export const defineServidorMetricaDiaModel = (db) => {
    const ServidorMetricaDia = db.define('servidor_metricas_dia', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        servidorId: { type: DataTypes.INTEGER, allowNull: false },
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        cpuProm: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        cpuMax: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        ramProm: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        ramMax: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        discoProm: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        discoMax: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        muestras: { type: DataTypes.INTEGER, allowNull: false }
    }, {
        tableName: 'servidor_metricas_dia',
        timestamps: true,
        indexes: [{ unique: true, fields: ['servidorId', 'fecha'] }]
    });

    ServidorMetricaDia.associate = (models) => {
        if (models.Servidor) ServidorMetricaDia.belongsTo(models.Servidor, { foreignKey: 'servidorId' });
    };

    return ServidorMetricaDia;
};
