import { DataTypes } from 'sequelize';

/**
 * Modelo TenantSecret (tenant) — almacén de secretos cifrados por tenant.
 *
 * Cada fila guarda un secreto cifrado con AES-256-GCM: el valor NUNCA se persiste en
 * claro. `valueEncrypted` es el ciphertext, `iv` el vector de inicialización aleatorio
 * (12 bytes, base64) y `authTag` la etiqueta de autenticación del modo GCM (base64).
 * El descifrado vive en vault.service.js; este modelo solo es el contenedor.
 *
 * `valueEncrypted` jamás debe exponerse en respuestas HTTP/socket — el service solo
 * devuelve NAMES en listados y el valor descifrado bajo demanda explícita.
 *
 * @param {import('sequelize').Sequelize} tenantDb - Conexión Sequelize del tenant.
 * @returns {import('sequelize').ModelStatic<any>} El modelo TenantSecret ligado a esa conexión.
 */
export const defineTenantSecretModel = (tenantDb) => {
    const TenantSecret = tenantDb.define('tenant_secrets', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        // Identificador lógico del secreto dentro del tenant (ej. 'stripe_api_key'). Único por tenant.
        name: { type: DataTypes.STRING(120), allowNull: false },
        // Ciphertext del secreto (AES-256-GCM). TEXT porque el valor puede ser largo (JSON, tokens, etc.).
        valueEncrypted: { type: DataTypes.TEXT, allowNull: false },
        // Vector de inicialización aleatorio (12 bytes en base64). Distinto por cada cifrado.
        iv: { type: DataTypes.STRING, allowNull: false },
        // Etiqueta de autenticación GCM (base64). Necesaria para verificar integridad al descifrar.
        authTag: { type: DataTypes.STRING, allowNull: false }
    }, {
        timestamps: true,
        paranoid: true, // soft-delete: nunca se borra físico (convención Zero).
        // Ocultamos valueEncrypted en cualquier serialización por defecto (defensa en profundidad:
        // si algún controller devolviera la instancia entera por error, el ciphertext no se filtra).
        defaultScope: {
            attributes: { exclude: ['valueEncrypted', 'iv', 'authTag'] }
        },
        indexes: [
            // Un secreto por nombre dentro del tenant. Incluimos deletedAt para que el soft-delete
            // permita re-crear un secreto con el mismo nombre tras borrarlo (paranoid + unique).
            { unique: true, fields: ['name', 'deletedAt'] }
        ]
    });

    return TenantSecret;
};
