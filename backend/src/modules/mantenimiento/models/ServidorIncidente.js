import { DataTypes } from 'sequelize';

/**
 * Modelo ServidorIncidente: bitácora de problemas de un servidor (caída o saturación).
 *
 * Existe para NO spamear: mientras un problema sigue abierto no se vuelve a notificar. Se
 * avisa dos veces —al abrirse y al resolverse— y queda el historial de cuánto duró cada
 * incidente. Un solo incidente abierto por servidor y tipo a la vez.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ServidorIncidente.
 */
export const defineServidorIncidenteModel = (db) => {
    const ServidorIncidente = db.define('servidor_incidentes', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        servidorId: { type: DataTypes.INTEGER, allowNull: false },
        tipo: { type: DataTypes.ENUM('offline', 'cpu', 'ram', 'disco'), allowNull: false },
        // El valor que disparó la alerta y el umbral vigente en ese momento (para el historial).
        valor: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
        umbral: { type: DataTypes.INTEGER, allowNull: true },
        detalle: { type: DataTypes.STRING(255), allowNull: true },
        resueltoAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'servidor_incidentes',
        timestamps: true,
        updatedAt: false,
        indexes: [
            { fields: ['servidorId', 'tipo', 'resueltoAt'] },
            { fields: ['createdAt'] }
        ]
    });

    ServidorIncidente.associate = (models) => {
        if (models.Servidor) ServidorIncidente.belongsTo(models.Servidor, { foreignKey: 'servidorId' });
    };

    return ServidorIncidente;
};
