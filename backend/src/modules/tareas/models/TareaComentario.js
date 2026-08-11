import { DataTypes } from 'sequelize';

/**
 * Modelo TareaComentario: hilo simple de comentarios por tarea (mejora §10.9 del PRD).
 * Texto plano; las menciones @username se resuelven al crear y generan notificación.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo TareaComentario.
 */
export const defineTareaComentarioModel = (db) => {
    const TareaComentario = db.define('tarea_comentarios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        tareaId: { type: DataTypes.INTEGER, allowNull: false },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        texto: { type: DataTypes.TEXT, allowNull: false }
    }, {
        timestamps: true,
        updatedAt: false, // no se editan: se borran (propio) y listo
        paranoid: true,
        indexes: [{ fields: ['tareaId', 'createdAt'] }]
    });

    TareaComentario.associate = (models) => {
        if (models.Tarea) TareaComentario.belongsTo(models.Tarea, { foreignKey: 'tareaId' });
        if (models.User) TareaComentario.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return TareaComentario;
};
