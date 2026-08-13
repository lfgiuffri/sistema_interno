import { DataTypes } from 'sequelize';

/**
 * Modelo UsuarioDocEspacio: permisos de un usuario sobre un espacio de documentación.
 *
 * Mismas reglas que la matriz de espacios de tareas:
 *  - editar implica ver (se fuerza al guardar).
 *  - Los ADMIN no tienen filas: entran a todo por su rol (incluidos espacios inactivos).
 *  - La matriz se edita desde dos ejes (espacio ↔ usuario) y cada eje reemplaza SOLO lo suyo.
 * No es paranoid: las filas se reemplazan por eje, no hay historial que conservar.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo UsuarioDocEspacio.
 */
export const defineUsuarioDocEspacioModel = (db) => {
    const UsuarioDocEspacio = db.define('usuario_doc_espacios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        docEspacioId: { type: DataTypes.INTEGER, allowNull: false },
        ver: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        editar: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }, {
        tableName: 'usuario_doc_espacios',
        timestamps: true,
        indexes: [
            { unique: true, fields: ['userId', 'docEspacioId'] },
            { fields: ['docEspacioId'] }
        ]
    });

    UsuarioDocEspacio.associate = (models) => {
        if (models.User) UsuarioDocEspacio.belongsTo(models.User, { foreignKey: 'userId' });
        if (models.DocEspacio) UsuarioDocEspacio.belongsTo(models.DocEspacio, { foreignKey: 'docEspacioId' });
    };

    return UsuarioDocEspacio;
};
