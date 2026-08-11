import { DataTypes } from 'sequelize';

/**
 * Modelo de tenant `WebhookDelivery` — LOG de cada intento de entrega de un webhook.
 *
 * Cada vez que se dispara un evento para una suscripción, se crea un WebhookDelivery que
 * registra el payload, el estado (pending/success/failed), la cantidad de intentos y el
 * último error/código de respuesta. Es un registro de auditoría: por eso `paranoid: false`
 * (no tiene sentido soft-delete en un log; se purga por retención si hiciera falta).
 *
 * Nombre del modelo: `WebhookDelivery` → accesible como `models.WebhookDelivery`.
 *
 * @param {import('sequelize').Sequelize} tenantDb - Conexión Sequelize del tenant.
 * @returns {import('sequelize').ModelStatic<any>} El modelo WebhookDelivery ligado a esa conexión.
 */
export const defineWebhookDeliveryModel = (tenantDb) => {
    const WebhookDelivery = tenantDb.define('webhook_deliveries', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        // Suscripción que originó esta entrega (FK a webhook_subscriptions).
        subscriptionId: { type: DataTypes.INTEGER, allowNull: false },
        // Nombre del evento entregado (ej. "item:created").
        event: { type: DataTypes.STRING(120), allowNull: false },
        // Payload completo enviado al receptor (se guarda para reintentos manuales / auditoría).
        payload: { type: DataTypes.JSON, allowNull: true },
        // Estado de la entrega. pending = encolada/en curso; success = 2xx; failed = agotó reintentos.
        status: {
            type: DataTypes.ENUM('pending', 'success', 'failed'),
            allowNull: false,
            defaultValue: 'pending'
        },
        // Cantidad de intentos de POST realizados (se incrementa en cada reintento).
        attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        // Código HTTP de la última respuesta del receptor (null si nunca respondió / error de red).
        responseStatus: { type: DataTypes.INTEGER, allowNull: true },
        // Último mensaje de error (timeout, status no-2xx, etc.). Texto libre para debugging.
        lastError: { type: DataTypes.TEXT, allowNull: true }
    }, {
        timestamps: true,
        paranoid: false, // es un LOG: no se soft-deletea.
        indexes: [
            // El listado de entregas casi siempre se filtra por suscripción.
            { fields: ['subscriptionId'] },
            // Útil para reconciliar/purgar por estado (ej. reintentar todas las failed).
            { fields: ['status'] }
        ]
    });

    /**
     * Declara las relaciones del modelo una vez que todos los modelos del tenant existen.
     * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Mapa de modelos del tenant.
     * @returns {void}
     */
    WebhookDelivery.associate = (models) => {
        // Guard: la suscripción puede no estar presente en un tenant con provisión parcial.
        if (models.WebhookSubscription) {
            // Cada entrega pertenece a una suscripción.
            WebhookDelivery.belongsTo(models.WebhookSubscription, { foreignKey: 'subscriptionId', as: 'subscription' });
        }
    };

    return WebhookDelivery;
};
