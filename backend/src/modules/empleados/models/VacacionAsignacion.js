import { DataTypes } from 'sequelize';

/**
 * Modelo VacacionAsignacion: override de días otorgados para UN año puntual.
 * Sin fila, el año usa `empleados.vacDiasAnuales`. Borrado físico al quitar el ajuste
 * (patrón del legado: el detalle no es bitácora).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo VacacionAsignacion.
 */
export const defineVacacionAsignacionModel = (db) => {
    const VacacionAsignacion = db.define('vacacion_asignaciones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        empleadoId: { type: DataTypes.INTEGER, allowNull: false },
        anio: { type: DataTypes.SMALLINT, allowNull: false },
        dias: { type: DataTypes.INTEGER, allowNull: false }
    }, {
        timestamps: true,
        indexes: [{ unique: true, fields: ['empleadoId', 'anio'] }]
    });

    VacacionAsignacion.associate = (models) => {
        if (models.Empleado) VacacionAsignacion.belongsTo(models.Empleado, { foreignKey: 'empleadoId' });
    };

    return VacacionAsignacion;
};
