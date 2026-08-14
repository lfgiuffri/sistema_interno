import { DataTypes } from 'sequelize';

/**
 * Modelo ServidorMetrica: una muestra de métricas reportada por el agente (detalle fino).
 *
 * Es una serie temporal: se guarda un registro por minuto y por servidor. El GC diario
 * borra el detalle de más de 30 días DESPUÉS de resumirlo en `servidor_metricas_dia`, así
 * la tabla no crece sin límite pero la tendencia histórica se conserva.
 *
 * `disco` es el porcentaje del punto de montaje MÁS lleno (lo que dispara la alerta) y
 * `discos` el detalle por montaje, para poder decir cuál es el que está saturado.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ServidorMetrica.
 */
export const defineServidorMetricaModel = (db) => {
    const ServidorMetrica = db.define('servidor_metricas', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        servidorId: { type: DataTypes.INTEGER, allowNull: false },
        cpu: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        ram: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        disco: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
        discos: { type: DataTypes.JSON, allowNull: true },
        carga1: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
        uptimeSeg: { type: DataTypes.INTEGER, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'servidor_metricas',
        timestamps: true,
        updatedAt: false,
        indexes: [{ fields: ['servidorId', 'createdAt'] }]
    });

    ServidorMetrica.associate = (models) => {
        if (models.Servidor) ServidorMetrica.belongsTo(models.Servidor, { foreignKey: 'servidorId' });
    };

    return ServidorMetrica;
};
