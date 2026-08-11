import { DataTypes } from 'sequelize';

/**
 * Modelo Role (single-tenant): un rol es un set de capabilities (ver RoleCapability).
 * El rol Administrador se marca isSystem=true: no se edita ni se elimina desde la UI,
 * para que nadie pueda dejar el sistema sin administración.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo Role.
 */
export const defineRoleModel = (db) => {
    const Role = db.define('roles', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        label: { type: DataTypes.STRING, allowNull: false },
        name: { type: DataTypes.STRING, allowNull: false },
        description: { type: DataTypes.TEXT, allowNull: true },
        // Roles de sistema (Administrador): no se pueden borrar ni renombrar desde la UI.
        isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }, {
        paranoid: true,
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        deletedAt: 'deletedAt'
    });

    Role.associate = (models) => {
        Role.hasMany(models.User, { foreignKey: 'roleId' });
        if (models.RoleCapability) {
            Role.hasMany(models.RoleCapability, { foreignKey: 'roleId' });
        }
    };

    return Role;
};
