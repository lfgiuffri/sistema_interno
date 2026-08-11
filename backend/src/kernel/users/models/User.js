import { DataTypes } from 'sequelize';
import { hashPassword, verifyPassword } from '../../auth/password.js';

/**
 * Modelo User (single-tenant): usuario del sistema con credenciales y MFA opcional.
 * En Sistema Interno el auth vive acá (no hay MasterUser): password argon2id,
 * TOTP opcional y datos de último login para auditoría.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo User.
 */
export const defineUserModel = (db) => {
    const User = db.define('users', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        name: { type: DataTypes.STRING, allowNull: false },
        lastName: { type: DataTypes.STRING, allowNull: false },
        email: { type: DataTypes.STRING, allowNull: false },
        username: { type: DataTypes.STRING, allowNull: false },
        password: { type: DataTypes.STRING, allowNull: false },
        cellphone: { type: DataTypes.STRING },
        avatar: { type: DataTypes.TEXT('long'), allowNull: true },
        avatarColor: { type: DataTypes.STRING, allowNull: true },
        active: { type: DataTypes.BOOLEAN, defaultValue: true },
        // ── MFA (TOTP) opcional por usuario ──
        mfaEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
        mfaSecret: { type: DataTypes.STRING, allowNull: true },
        mfaBackupCodes: { type: DataTypes.JSON, allowNull: true },
        // ── Auditoría de acceso ──
        lastLoginAt: { type: DataTypes.DATE, allowNull: true },
        lastLoginIp: { type: DataTypes.STRING(45), allowNull: true }
    }, {
        paranoid: true,
        timestamps: true,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        deletedAt: 'deletedAt',
        indexes: [
            // Únicos lógicos: se validan en el service excluyendo soft-deleted;
            // el índice simple acelera el lookup del login.
            { fields: ['username'] },
            { fields: ['email'] }
        ]
    });

    // Hashing con argon2id (verifyPassword soporta hashes bcrypt legacy). Se mantiene el
    // nombre histórico `encryptPassword` para no romper a los callers existentes.
    User.prototype.encryptPassword = async (password) => hashPassword(password);

    User.prototype.comparePassword = async (password, userPassword) => verifyPassword(userPassword, password);

    User.associate = (models) => {
        User.belongsTo(models.Role, { foreignKey: 'roleId' });
        if (models.ActionTracking) User.hasMany(models.ActionTracking, { foreignKey: 'userId' });
    };

    return User;
};
