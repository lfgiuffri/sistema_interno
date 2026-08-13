import { DataTypes } from 'sequelize';

/**
 * Modelo Documento: una pieza de documentación dentro de una lista.
 *
 * Un documento tiene SIEMPRE título y puede tener cuerpo de texto enriquecido
 * (`contenido`, HTML saneado en servidor al guardar y al servir) y/o archivos adjuntos
 * (DocumentoArchivo): los dos casos —"subo un PDF" y "escribo el instructivo"— conviven
 * en el mismo registro, así se le puede agregar una nota a un archivo sin duplicar nada.
 *
 * `docEspacioId` va desnormalizado (además de la lista) para poder filtrar por permisos de
 * espacio y buscar sin joins, igual que `tareas.espacioId`. Al mover un documento de lista
 * se actualizan los dos campos juntos.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Documento.
 */
export const defineDocumentoModel = (db) => {
    const Documento = db.define('documentos', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        docEspacioId: { type: DataTypes.INTEGER, allowNull: false },
        docListaId: { type: DataTypes.INTEGER, allowNull: false },
        titulo: { type: DataTypes.STRING(200), allowNull: false },
        contenido: { type: DataTypes.TEXT('medium'), allowNull: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        creadoPor: { type: DataTypes.INTEGER, allowNull: true },
        actualizadoPor: { type: DataTypes.INTEGER, allowNull: true }
    }, {
        tableName: 'documentos',
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['docEspacioId'] },
            { fields: ['docListaId', 'orden'] },
            { fields: ['titulo'] }
        ]
    });

    Documento.associate = (models) => {
        if (models.DocEspacio) Documento.belongsTo(models.DocEspacio, { foreignKey: 'docEspacioId' });
        if (models.DocLista) Documento.belongsTo(models.DocLista, { foreignKey: 'docListaId' });
        if (models.User) {
            Documento.belongsTo(models.User, { as: 'autor', foreignKey: 'creadoPor' });
            Documento.belongsTo(models.User, { as: 'editor', foreignKey: 'actualizadoPor' });
        }
        if (models.DocumentoArchivo) Documento.hasMany(models.DocumentoArchivo, { foreignKey: 'documentoId' });
        if (models.DocumentoVersion) Documento.hasMany(models.DocumentoVersion, { foreignKey: 'documentoId' });
    };

    return Documento;
};
