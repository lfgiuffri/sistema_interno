import { DataTypes } from 'sequelize';

/**
 * Modelo RoleCapability (tenant) — micro-permisos por capability.
 *
 * Otorga capabilities (ej. `items:create`) a un rol. La capability `*` es comodín:
 * el rol con `*` puede todo (rol admin del tenant). Las capabilities las declaran los
 * módulos en su manifest; este modelo es el vínculo rol↔capability que `requireCapability`
 * consulta (con cache en Redis) para autorizar cada request.
 *
 * @param {import('sequelize').Sequelize} tenantDb - Conexión Sequelize del tenant.
 * @returns {import('sequelize').ModelStatic<any>} El modelo RoleCapability.
 */
export const defineRoleCapabilityModel = (tenantDb) => {
    const RoleCapability = tenantDb.define('role_capabilities', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        roleId: { type: DataTypes.INTEGER, allowNull: false },
        // Capability concedida: 'modulo:accion' o '*' (comodín = todas).
        capability: { type: DataTypes.STRING(100), allowNull: false }
    }, {
        timestamps: true,
        paranoid: true,
        indexes: [
            // Evita duplicar la misma capability para un rol (considerando soft-delete).
            { unique: true, fields: ['roleId', 'capability', 'deletedAt'] },
            // Acelera la carga de todas las capabilities de un rol.
            { fields: ['roleId'] }
        ]
    });

    /**
     * Relación: cada capability pertenece a un rol.
     * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Modelos del tenant.
     * @returns {void}
     */
    RoleCapability.associate = (models) => {
        if (models.Role) {
            RoleCapability.belongsTo(models.Role, { foreignKey: 'roleId' });
        }
    };

    return RoleCapability;
};
