import { DataTypes } from 'sequelize';

/**
 * Modelo CuentaPago: cuenta desde la que se pagan sueldos (columna de la planificación).
 * `orden` define el orden de columnas en la matriz. Unicidad de nombre vs no eliminadas
 * en el service (mejora: el legado no tenía unicidad).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo CuentaPago.
 */
export const defineCuentaPagoModel = (db) => {
    const CuentaPago = db.define('cuentas_pago', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        tableName: 'cuentas_pago', // Sequelize pluralizaría mal ("cuentas_pagos")
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['activo'] }]
    });

    CuentaPago.associate = (models) => {
        if (models.SueldoPago) CuentaPago.hasMany(models.SueldoPago, { foreignKey: 'cuentaId' });
        if (models.CuentaDisponible) CuentaPago.hasMany(models.CuentaDisponible, { foreignKey: 'cuentaId' });
    };

    return CuentaPago;
};
