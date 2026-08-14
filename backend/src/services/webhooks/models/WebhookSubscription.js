import { DataTypes } from 'sequelize';

/**
 * Modelo de tenant `WebhookSubscription` — suscripción a webhooks salientes (estilo
 * "database webhooks" de Supabase). Un tenant registra una URL externa y la lista de
 * eventos que quiere recibir; cuando el sistema dispara un evento, se hace POST a esa URL.
 *
 * Sigue el patrón factory que el auto-discovery de tenantAssociations espera: la función
 * `defineWebhookSubscriptionModel(tenantDb)` recibe la conexión del tenant y devuelve el
 * modelo. El nombre del modelo (lo que va entre `define` y `Model`) es `WebhookSubscription`,
 * por lo que queda accesible como `models.WebhookSubscription`.
 *
 * @param {import('sequelize').Sequelize} tenantDb - Conexión Sequelize del tenant.
 * @returns {import('sequelize').ModelStatic<any>} El modelo WebhookSubscription ligado a esa conexión.
 */
export const defineWebhookSubscriptionModel = (tenantDb) => {
    const WebhookSubscription = tenantDb.define('webhook_subscriptions', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        // Dueño opcional de la suscripción dentro del tenant. Nullable porque una suscripción
        // puede ser "del tenant" (a nivel sistema) y no de un usuario puntual.
        userId: { type: DataTypes.INTEGER, allowNull: true },
        // URL de destino donde se hace el POST del evento. Obligatoria.
        url: { type: DataTypes.STRING(2048), allowNull: false },
        // Lista de eventos suscriptos: array de nombres (ej. ["item:created"]) o ["*"] (todos).
        // Se guarda como JSON para soportar el array directamente.
        events: {
            type: DataTypes.JSON,
            allowNull: false,
            // Por defecto, suscribirse a todo: el comodín "*" matchea cualquier evento.
            defaultValue: ['*']
        },
        // Secreto HMAC por suscripción: con él se firma cada entrega (header X-Sistema-Interno-Signature).
        // Lo genera el server al crear la suscripción; el receptor lo usa para verificar autenticidad.
        secret: { type: DataTypes.STRING(128), allowNull: false },
        // Permite pausar la suscripción sin borrarla. Solo se entregan eventos a suscripciones activas.
        active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    }, {
        timestamps: true,
        paranoid: true, // soft-delete: nunca se borra físico (convención del proyecto).
        indexes: [
            // Acelera el listado por dueño.
            { fields: ['userId'] },
            // El dispatch filtra por `active`; indexarlo agiliza la búsqueda de destinatarios.
            { fields: ['active'] }
        ]
    });

    /**
     * Declara las relaciones del modelo una vez que todos los modelos del tenant existen.
     * @param {Record<string, import('sequelize').ModelStatic<any>>} models - Mapa de modelos del tenant.
     * @returns {void}
     */
    WebhookSubscription.associate = (models) => {
        // Guard con `if(models.X)`: las asociaciones son opcionales según qué modelos tenga el tenant.
        if (models.User) {
            // Una suscripción puede pertenecer a un User (cuando userId no es null).
            WebhookSubscription.belongsTo(models.User, { foreignKey: 'userId' });
        }
        if (models.WebhookDelivery) {
            // Una suscripción tiene muchas entregas (log de cada intento de POST).
            WebhookSubscription.hasMany(models.WebhookDelivery, { foreignKey: 'subscriptionId', as: 'deliveries' });
        }
    };

    return WebhookSubscription;
};
