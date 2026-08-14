import { DataTypes } from 'sequelize';

/**
 * Modelo SitioChequeo: bitácora de cada chequeo de disponibilidad (uno cada 5 minutos).
 *
 * Sirve para responder "¿cuándo se cayó y por cuánto?" y para calcular el % de
 * disponibilidad. El GC diario purga lo de más de 30 días, igual que las métricas.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SitioChequeo.
 */
export const defineSitioChequeoModel = (db) => {
    const SitioChequeo = db.define('sitio_chequeos', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        sitioId: { type: DataTypes.INTEGER, allowNull: false },
        estado: { type: DataTypes.ENUM('online', 'sin_marcador', 'offline'), allowNull: false },
        httpStatus: { type: DataTypes.INTEGER, allowNull: true },
        tiempoMs: { type: DataTypes.INTEGER, allowNull: true },
        motivo: { type: DataTypes.STRING(200), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'sitio_chequeos',
        timestamps: true,
        updatedAt: false,
        indexes: [{ fields: ['sitioId', 'createdAt'] }]
    });

    SitioChequeo.associate = (models) => {
        if (models.SitioWeb) SitioChequeo.belongsTo(models.SitioWeb, { foreignKey: 'sitioId' });
    };

    return SitioChequeo;
};
