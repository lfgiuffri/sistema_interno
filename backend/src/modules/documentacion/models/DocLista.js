import { DataTypes } from 'sequelize';

/**
 * Modelo DocLista: agrupador de documentos dentro de un espacio de documentación.
 *
 * `nombre` es el título de la lista (lo que se ve como encabezado de la sección).
 * `orden` sostiene el reordenamiento manual (drag & drop): menor primero, y a igualdad
 * desempata el nombre. Unicidad de nombre POR ESPACIO contra no eliminadas (en el service,
 * con oferta de reactivación).
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo DocLista.
 */
export const defineDocListaModel = (db) => {
    const DocLista = db.define('doc_listas', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        docEspacioId: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(120), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        tableName: 'doc_listas',
        timestamps: true,
        paranoid: true,
        indexes: [{ fields: ['docEspacioId'] }, { fields: ['docEspacioId', 'orden'] }]
    });

    DocLista.associate = (models) => {
        if (models.DocEspacio) DocLista.belongsTo(models.DocEspacio, { foreignKey: 'docEspacioId' });
        if (models.Documento) DocLista.hasMany(models.Documento, { foreignKey: 'docListaId' });
    };

    return DocLista;
};
