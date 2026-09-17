import { DataTypes } from 'sequelize';
import { hashPassword, verifyPassword } from '../../../kernel/auth/password.js';

/**
 * Modelo ClienteUsuario: una persona del CLIENTE que entra al portal.
 *
 * NO es un `User` del sistema interno y no puede serlo: un `User` tiene rol y capabilities
 * sobre los datos de la empresa. Un usuario de portal solo existe para ver lo de su propio
 * cliente, entra desde internet abierto, y su identificador vive en un espacio de ids
 * separado (por eso la autoría de una incidencia tiene dos columnas distintas).
 *
 * Entra con EMAIL, no con username: es lo que un tercero recuerda sin que se lo expliquen.
 *
 * Sin auto-registro y sin «olvidé mi contraseña» en esta versión: las crea y las resetea un
 * usuario interno desde la ficha del cliente, igual que el sistema interno. Eso elimina de
 * entrada el flujo donde vive la enumeración de usuarios.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo ClienteUsuario.
 */
export const defineClienteUsuarioModel = (db) => {
    const ClienteUsuario = db.define('cliente_usuarios', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        clienteId: { type: DataTypes.INTEGER, allowNull: false },
        nombre: { type: DataTypes.STRING(160), allowNull: false },
        email: { type: DataTypes.STRING(160), allowNull: false },
        password: { type: DataTypes.STRING(255), allowNull: false },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ultimoAccesoAt: { type: DataTypes.DATE, allowNull: true },
        ultimoAccesoIp: { type: DataTypes.STRING(45), allowNull: true }
    }, {
        tableName: 'cliente_usuarios',
        timestamps: true,
        paranoid: true,
        indexes: [
            { fields: ['clienteId'] },
            { fields: ['email'] }
        ]
    });

    // Mismos helpers que el User interno (argon2id, con back-compat bcrypt). Ojo con el orden
    // invertido de los argumentos en `comparePassword`: es el del modelo User, se replica tal
    // cual para que las dos superficies se lean igual.
    ClienteUsuario.prototype.encryptPassword = async (password) => hashPassword(password);
    ClienteUsuario.prototype.comparePassword = async (password, hash) => verifyPassword(hash, password);

    ClienteUsuario.associate = (models) => {
        if (models.Cliente) ClienteUsuario.belongsTo(models.Cliente, { foreignKey: 'clienteId' });
    };

    return ClienteUsuario;
};
