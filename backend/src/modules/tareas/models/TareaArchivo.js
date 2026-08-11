import { DataTypes } from 'sequelize';

/**
 * Modelo TareaArchivo: archivos del módulo de tareas — imágenes embebidas en descripciones
 * y ADJUNTOS genéricos (mejora §10.4 del PRD: PDF/docs, no solo imágenes).
 *
 * El binario vive en disco privado (storage/tareas, fuera del webroot) con nombre aleatorio
 * `YYYYMM_<20hex>.ext`; esta tabla es el índice: permite validar el mime al servir, listar
 * los adjuntos de una tarea y hacer GC de huérfanos (tareaId null viejos) en la fase final.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo TareaArchivo.
 */
export const defineTareaArchivoModel = (db) => {
    const TareaArchivo = db.define('tarea_archivos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        // Nombre en disco (aleatorio, validado por regex al servir).
        nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
        nombreOriginal: { type: DataTypes.STRING(200), allowNull: false },
        tipo: { type: DataTypes.ENUM('imagen', 'archivo'), allowNull: false },
        mime: { type: DataTypes.STRING(100), allowNull: false },
        size: { type: DataTypes.INTEGER, allowNull: false },
        // null = subido durante la edición y todavía no ligado a una tarea (candidato a GC).
        tareaId: { type: DataTypes.INTEGER, allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        timestamps: true,
        indexes: [
            { fields: ['tareaId'] },
            { fields: ['createdAt'] }
        ]
    });

    TareaArchivo.associate = (models) => {
        if (models.Tarea) TareaArchivo.belongsTo(models.Tarea, { foreignKey: 'tareaId' });
        if (models.User) TareaArchivo.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return TareaArchivo;
};
