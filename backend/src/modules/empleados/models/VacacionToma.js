import { DataTypes } from 'sequelize';

/**
 * Modelo VacacionToma: un período de vacaciones tomado (días CORRIDOS inclusive).
 * `dias` se congela al cargar; el sobregiro NO se persiste (lo recalcula la simulación
 * cada vez — así una carga fuera de orden se refleja sola, mejora del PRD §6.4).
 * Borrado físico (patrón del legado).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo VacacionToma.
 */
export const defineVacacionTomaModel = (db) => {
    const VacacionToma = db.define('vacacion_tomas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        empleadoId: { type: DataTypes.INTEGER, allowNull: false },
        fechaDesde: { type: DataTypes.DATEONLY, allowNull: false },
        fechaHasta: { type: DataTypes.DATEONLY, allowNull: false },
        dias: { type: DataTypes.INTEGER, allowNull: false },
        observacion: { type: DataTypes.STRING(255), allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        timestamps: true,
        indexes: [{ fields: ['empleadoId', 'fechaDesde'] }]
    });

    VacacionToma.associate = (models) => {
        if (models.Empleado) VacacionToma.belongsTo(models.Empleado, { foreignKey: 'empleadoId' });
    };

    return VacacionToma;
};
