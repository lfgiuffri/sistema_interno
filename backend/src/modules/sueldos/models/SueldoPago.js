import { DataTypes } from 'sequelize';

/**
 * Modelo SueldoPago: una celda de la planificación (empleado × cuenta × período).
 * `fechaPago` se fija la primera vez que se marca pagado y se CONSERVA al re-guardar
 * mientras siga tildado; destildar la anula. Monto 0 borra la fila (patrón del legado).
 * No es paranoid: la matriz del período se reemplaza completa.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo SueldoPago.
 */
export const defineSueldoPagoModel = (db) => {
    const SueldoPago = db.define('sueldo_pagos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        empleadoId: { type: DataTypes.INTEGER, allowNull: false },
        cuentaId: { type: DataTypes.INTEGER, allowNull: false },
        anio: { type: DataTypes.SMALLINT, allowNull: false },
        mes: { type: DataTypes.TINYINT, allowNull: false },
        monto: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
        pagado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fechaPago: { type: DataTypes.DATEONLY, allowNull: true }
    }, {
        timestamps: true,
        indexes: [
            { unique: true, fields: ['empleadoId', 'cuentaId', 'anio', 'mes'] },
            { fields: ['anio', 'mes'] }
        ]
    });

    SueldoPago.associate = (models) => {
        if (models.Empleado) SueldoPago.belongsTo(models.Empleado, { foreignKey: 'empleadoId' });
        if (models.CuentaPago) SueldoPago.belongsTo(models.CuentaPago, { foreignKey: 'cuentaId' });
    };

    return SueldoPago;
};
