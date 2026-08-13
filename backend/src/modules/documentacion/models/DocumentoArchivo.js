import { DataTypes } from 'sequelize';

/**
 * Modelo DocumentoArchivo: archivos de un documento — imágenes embebidas en el cuerpo y
 * ADJUNTOS (el caso "la documentación ES un PDF").
 *
 * El binario vive en disco privado (storage/documentacion, fuera del webroot) con nombre
 * aleatorio `YYYYMM_<20hex>.ext`; esta tabla es el índice: valida el mime al servir, lista
 * los adjuntos del documento y habilita el GC de huérfanos (documentoId null viejos).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo DocumentoArchivo.
 */
export const defineDocumentoArchivoModel = (db) => {
    const DocumentoArchivo = db.define('documento_archivos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        // Nombre en disco (aleatorio, validado por regex al servir).
        nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
        nombreOriginal: { type: DataTypes.STRING(200), allowNull: false },
        tipo: { type: DataTypes.ENUM('imagen', 'archivo'), allowNull: false },
        mime: { type: DataTypes.STRING(100), allowNull: false },
        size: { type: DataTypes.INTEGER, allowNull: false },
        // null = subido durante la edición y todavía no ligado a un documento (candidato a GC).
        documentoId: { type: DataTypes.INTEGER, allowNull: true },
        userId: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'documento_archivos',
        timestamps: true,
        indexes: [
            { fields: ['documentoId'] },
            { fields: ['createdAt'] }
        ]
    });

    DocumentoArchivo.associate = (models) => {
        if (models.Documento) DocumentoArchivo.belongsTo(models.Documento, { foreignKey: 'documentoId' });
        if (models.User) DocumentoArchivo.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return DocumentoArchivo;
};
