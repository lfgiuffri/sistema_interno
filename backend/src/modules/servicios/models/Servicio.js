import { DataTypes } from 'sequelize';

/**
 * Modelo Servicio: catálogo de servicios de la empresa (entidad compartida).
 * Un servicio pertenece a UN área (opcional): esa relación clasifica la facturación
 * de abonos y proyectos en la estadística por área del panel.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Servicio.
 */
export const defineServicioModel = (db) => {
    const Servicio = db.define('servicios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(160), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        // Área a la que suma la facturación de este servicio (null = "Sin área").
        areaId: { type: DataTypes.INTEGER, allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['nombre'] },
            { fields: ['areaId'] }
        ]
    });

    Servicio.associate = (models) => {
        if (models.Area) Servicio.belongsTo(models.Area, { foreignKey: 'areaId', onDelete: 'SET NULL' });
        if (models.Abono) Servicio.hasMany(models.Abono, { foreignKey: 'servicioId' });
        if (models.Proyecto) Servicio.hasMany(models.Proyecto, { foreignKey: 'servicioId' });
    };

    return Servicio;
};
