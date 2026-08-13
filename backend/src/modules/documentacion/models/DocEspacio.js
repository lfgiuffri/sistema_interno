import { DataTypes } from 'sequelize';

/**
 * Modelo DocEspacio: espacio de DOCUMENTACIÓN, contenedor de listas y documentos con
 * acceso POR USUARIO (segunda capa de permisos, igual que los espacios de tareas).
 *
 * Son espacios PROPIOS, separados de `espacios_trabajo`: la documentación puede tener
 * recortes distintos a los de las tareas (ej. un espacio "Procesos internos" que no
 * corresponde a ningún tablero) y sus accesos se administran aparte.
 * Un espacio inactivo no aparece en la home de Documentación pero conserva su contenido.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo DocEspacio.
 */
export const defineDocEspacioModel = (db) => {
    const DocEspacio = db.define('doc_espacios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        descripcion: { type: DataTypes.STRING(255), allowNull: true },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        tableName: 'doc_espacios',
        timestamps: true,
        // Soft delete; la unicidad de nombre se valida contra NO eliminados en el service
        // (mismo patrón que los catálogos: 409 EXISTE_ELIMINADO + restore).
        paranoid: true,
        indexes: [{ fields: ['activo'] }]
    });

    DocEspacio.associate = (models) => {
        if (models.UsuarioDocEspacio) DocEspacio.hasMany(models.UsuarioDocEspacio, { foreignKey: 'docEspacioId' });
        if (models.DocLista) DocEspacio.hasMany(models.DocLista, { foreignKey: 'docEspacioId' });
        if (models.Documento) DocEspacio.hasMany(models.Documento, { foreignKey: 'docEspacioId' });
    };

    return DocEspacio;
};
