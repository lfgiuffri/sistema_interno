import { DataTypes } from 'sequelize';

/**
 * Modelo Notificacion: notificación in-app PERSONAL (mejora §10.1 del PRD).
 * Se crea desde los módulos vía `crearNotificacion` (barrel) y viaja en vivo por el
 * socket (evento `notificacion` al room user:<id>). `leidaAt` null = no leída.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Notificacion.
 */
export const defineNotificacionModel = (db) => {
    const Notificacion = db.define('notificaciones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        // Tipo semántico (tarea-asignada, tarea-estado, tarea-comentario, abono-vencido, ...).
        tipo: { type: DataTypes.STRING(40), allowNull: false },
        titulo: { type: DataTypes.STRING(150), allowNull: false },
        cuerpo: { type: DataTypes.STRING(255), allowNull: true },
        // Ruta interna del frontend para "ir a" (ej. /tareas/espacios/1/listas/2).
        url: { type: DataTypes.STRING(255), allowNull: true },
        leidaAt: { type: DataTypes.DATE, allowNull: true }
    }, {
        timestamps: true,
        updatedAt: false,
        indexes: [
            { fields: ['userId', 'leidaAt'] },
            { fields: ['createdAt'] }
        ]
    });

    Notificacion.associate = (models) => {
        if (models.User) Notificacion.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return Notificacion;
};
