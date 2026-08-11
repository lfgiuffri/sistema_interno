import { DataTypes } from 'sequelize';

/**
 * Modelo CuentaDisponible: dinero disponible en una cuenta para un período (fila
 * "Disponible" de la planificación). Se upsertea aunque sea 0.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo CuentaDisponible.
 */
export const defineCuentaDisponibleModel = (db) => {
    const CuentaDisponible = db.define('cuenta_disponibles', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        cuentaId: { type: DataTypes.INTEGER, allowNull: false },
        anio: { type: DataTypes.SMALLINT, allowNull: false },
        mes: { type: DataTypes.TINYINT, allowNull: false },
        monto: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 }
    }, {
        timestamps: true,
        indexes: [{ unique: true, fields: ['cuentaId', 'anio', 'mes'] }]
    });

    CuentaDisponible.associate = (models) => {
        if (models.CuentaPago) CuentaDisponible.belongsTo(models.CuentaPago, { foreignKey: 'cuentaId' });
    };

    return CuentaDisponible;
};
