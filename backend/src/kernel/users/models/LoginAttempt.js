import { DataTypes } from 'sequelize';

/**
 * Modelo LoginAttempt: bitácora de intentos de login (protección de fuerza bruta).
 * Es append-only: nunca se edita; los fallos viejos salen de la ventana solos.
 * No es paranoid a propósito — un intento de login no se "borra lógicamente".
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo LoginAttempt.
 */
export const defineLoginAttemptModel = (db) => {
    const LoginAttempt = db.define('login_attempts', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        username: { type: DataTypes.STRING(160), allowNull: false },
        ip: { type: DataTypes.STRING(45), allowNull: false },
        success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }, {
        timestamps: true,
        updatedAt: false, // bitácora: solo createdAt
        indexes: [
            { fields: ['username', 'createdAt'] },
            { fields: ['ip', 'createdAt'] }
        ]
    });

    return LoginAttempt;
};
