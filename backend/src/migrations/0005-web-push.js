/**
 * Migración: suscripciones de Web Push (notificaciones del navegador).
 *
 * Tabla y no columna en `user_settings` porque un usuario puede tener varios navegadores
 * (oficina, casa, celular) y cada uno es una suscripción distinta.
 *
 * SIN `deletedAt`: una suscripción que el navegador ya no reconoce (410 Gone) se BORRA. No es
 * un dato de negocio, es una dirección de entrega que dejó de existir; conservarla solo hace
 * que cada envío futuro la reintente.
 */

/**
 * Aplica la migración.
 * @param {import('sequelize').Sequelize} sequelize - Conexión.
 * @returns {Promise<void>}
 */
export const up = async (sequelize) => {
    const q = sequelize.getQueryInterface();
    // showAllTables() devuelve OBJETOS ({ tableName, schema }) en MariaDB, no strings.
    const existentes = (await q.showAllTables()).map(t => String(t?.tableName ?? t).toLowerCase());

    if (!existentes.includes('push_subscriptions')) {
        await sequelize.query(`CREATE TABLE push_subscriptions (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            userId INT NOT NULL,
            endpoint VARCHAR(500) NOT NULL,
            p256dh VARCHAR(255) NOT NULL,
            auth VARCHAR(255) NOT NULL,
            userAgent VARCHAR(255) NULL,
            ultimoEnvioAt DATETIME NULL,
            createdAt DATETIME NOT NULL,
            updatedAt DATETIME NOT NULL,
            UNIQUE KEY push_subscriptions_endpoint (endpoint),
            INDEX push_subscriptions_user (userId),
            CONSTRAINT push_subscriptions_ibfk_1 FOREIGN KEY (userId)
              REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
    }
};
