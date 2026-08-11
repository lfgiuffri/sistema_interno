import { DataTypes } from 'sequelize';

/**
 * Modelo TareaEstado: bitácora APPEND-ONLY de cambios de estado de una tarea.
 * `estadoAnterior` null = creación. No se anota si el estado no cambió (regla del legado).
 * De acá sale el tiempo de trabajo (tramos en_progreso descontando pausas).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo TareaEstado.
 */
export const defineTareaEstadoModel = (db) => {
    const TareaEstado = db.define('tarea_estados', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        tareaId: { type: DataTypes.INTEGER, allowNull: false },
        estadoAnterior: { type: DataTypes.STRING(20), allowNull: true },
        estadoNuevo: { type: DataTypes.STRING(20), allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        timestamps: true,
        updatedAt: false, // bitácora: solo createdAt
        indexes: [{ fields: ['tareaId', 'createdAt'] }]
    });

    TareaEstado.associate = (models) => {
        if (models.Tarea) TareaEstado.belongsTo(models.Tarea, { foreignKey: 'tareaId' });
        if (models.User) TareaEstado.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return TareaEstado;
};
