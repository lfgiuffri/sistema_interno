import { DataTypes } from 'sequelize';

/**
 * Modelo PortalLoginAttempt: intentos de login del PORTAL DE CLIENTES.
 *
 * Tabla separada de `login_attempts` a propósito, y no es purismo. `lockout.service.js` borra
 * los intentos fallidos de una IP cuando alguien loguea bien desde ahí. Compartiendo tabla,
 * un cliente logueándose desde la IP de su oficina **le limpiaría el contador de fuerza bruta
 * al login interno** para esa misma IP: un atacante tendría reintentos infinitos con solo
 * tener una credencial de portal válida.
 *
 * Como `lockout.service.js` hace `const { LoginAttempt } = models`, alcanza con pasarle
 * `{ LoginAttempt: models.PortalLoginAttempt }` y funciona sin tocar una línea del kernel.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo PortalLoginAttempt.
 */
export const definePortalLoginAttemptModel = (db) => db.define('portal_login_attempts', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(160), allowNull: true },
    ip: { type: DataTypes.STRING(45), allowNull: true },
    success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE, allowNull: false }
}, {
    tableName: 'portal_login_attempts',
    timestamps: true,
    updatedAt: false,
    indexes: [{ fields: ['username', 'ip', 'createdAt'] }]
});
