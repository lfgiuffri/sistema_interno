import { DataTypes } from 'sequelize';

/**
 * Modelo CotizacionDolar: HISTÓRICO de la cotización (mejora §10.10 del PRD — el legado
 * tenía un único valor mutable sin memoria). Cada cambio de COTIZACION_DOLAR agrega una
 * fila; lo pendiente sigue usando el valor vigente de Config, esto es la evolución.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo CotizacionDolar.
 */
export const defineCotizacionDolarModel = (db) => {
    const CotizacionDolar = db.define('cotizacion_dolar', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        valor: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'cotizacion_dolar',
        timestamps: true,
        updatedAt: false, // bitácora append-only
        indexes: [{ fields: ['createdAt'] }]
    });

    CotizacionDolar.associate = (models) => {
        if (models.User) CotizacionDolar.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return CotizacionDolar;
};
