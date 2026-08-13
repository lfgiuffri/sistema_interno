import { DataTypes } from 'sequelize';

/**
 * Modelo DocumentoVersion: historial de versiones de un documento (append-only).
 *
 * Cada edición que cambia título o contenido guarda ANTES la versión que se está pisando,
 * con quién la había dejado así. Es decir: las filas son estados ANTERIORES, y el estado
 * actual vive siempre en `documentos` — por eso restaurar es "escribir la vieja como nueva"
 * (que a su vez genera su propia versión, sin perder nada).
 * No es paranoid ni editable: es bitácora.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo DocumentoVersion.
 */
export const defineDocumentoVersionModel = (db) => {
    const DocumentoVersion = db.define('documento_versiones', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        documentoId: { type: DataTypes.INTEGER, allowNull: false },
        titulo: { type: DataTypes.STRING(200), allowNull: false },
        contenido: { type: DataTypes.TEXT('medium'), allowNull: true },
        // Autor de la versión guardada (quien había dejado el documento en ese estado).
        userId: { type: DataTypes.INTEGER, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false }
    }, {
        tableName: 'documento_versiones',
        timestamps: true,
        updatedAt: false,
        indexes: [{ fields: ['documentoId', 'createdAt'] }]
    });

    DocumentoVersion.associate = (models) => {
        if (models.Documento) DocumentoVersion.belongsTo(models.Documento, { foreignKey: 'documentoId' });
        if (models.User) DocumentoVersion.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return DocumentoVersion;
};
