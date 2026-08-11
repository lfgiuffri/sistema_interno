import { DataTypes } from 'sequelize';

/**
 * Modelo EmpleadoArea: relación N:N empleado ↔ área (el área clasifica al personal).
 * No es paranoid: el set se reemplaza completo al guardar la ficha (patrón del legado).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo EmpleadoArea.
 */
export const defineEmpleadoAreaModel = (db) => {
    const EmpleadoArea = db.define('empleado_areas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        empleadoId: { type: DataTypes.INTEGER, allowNull: false },
        areaId: { type: DataTypes.INTEGER, allowNull: false }
    }, {
        timestamps: true,
        indexes: [
            { unique: true, fields: ['empleadoId', 'areaId'] },
            { fields: ['areaId'] }
        ]
    });

    EmpleadoArea.associate = (models) => {
        if (models.Empleado) EmpleadoArea.belongsTo(models.Empleado, { foreignKey: 'empleadoId' });
        if (models.Area) EmpleadoArea.belongsTo(models.Area, { foreignKey: 'areaId' });
    };

    return EmpleadoArea;
};
