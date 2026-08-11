import { DataTypes } from 'sequelize';

/**
 * Modelo Area: áreas de la empresa (Gerencia, Administración, Desarrollo, Marketing, Diseño).
 * Agrupan el trabajo y clasifican la facturación: un servicio pertenece a UN área; un
 * empleado (fase 5) puede pertenecer a varias.
 *
 * Nota: el sistema legado llamaba `activa` a esta columna solo en áreas; acá se normaliza
 * a `activo` como en el resto de los catálogos (decisión del PRD).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Area.
 */
export const defineAreaModel = (db) => {
    const Area = db.define('areas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(120), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        // Orden manual de presentación (rige listados y estadísticas).
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            // La unicidad real (vs no-eliminados) se valida en el service: un UNIQUE de base
            // chocaría con el soft delete (lección del sistema legado, bug #6 del análisis).
            { fields: ['nombre'] }
        ]
    });

    Area.associate = (models) => {
        if (models.Servicio) Area.hasMany(models.Servicio, { foreignKey: 'areaId' });
    };

    return Area;
};
