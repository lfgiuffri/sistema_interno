import { DataTypes } from 'sequelize';

/**
 * Modelo UsuarioEspacio: permisos de un usuario sobre un espacio de trabajo (ver / editar).
 *
 * Reglas del legado (../analisis_app_php/03 §2.2):
 *  - editar implica ver (se fuerza al guardar).
 *  - Los ADMIN no tienen filas: entran a todo por su rol (incluidos espacios inactivos).
 *  - La matriz se edita desde dos ejes (espacio ↔ usuario) y cada eje reemplaza SOLO lo suyo.
 * No es paranoid: las filas se reemplazan por eje, no hay historial que conservar.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo UsuarioEspacio.
 */
export const defineUsuarioEspacioModel = (db) => {
    const UsuarioEspacio = db.define('usuario_espacios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        espacioId: { type: DataTypes.INTEGER, allowNull: false },
        ver: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        editar: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }, {
        timestamps: true,
        indexes: [
            { unique: true, fields: ['userId', 'espacioId'] },
            { fields: ['espacioId'] }
        ]
    });

    UsuarioEspacio.associate = (models) => {
        if (models.User) UsuarioEspacio.belongsTo(models.User, { foreignKey: 'userId' });
        if (models.EspacioTrabajo) UsuarioEspacio.belongsTo(models.EspacioTrabajo, { foreignKey: 'espacioId' });
    };

    return UsuarioEspacio;
};
