import { DataTypes } from 'sequelize';

/**
 * Modelo PushSubscription: una suscripción de Web Push (navegador).
 *
 * Es distinto del `pushToken` de `UserSettings`, que es el token de FCM de la app nativa:
 *  - Un usuario tiene UNA app instalada por teléfono, pero puede tener VARIOS navegadores
 *    (la compu de la oficina, la de casa, el celular). Por eso esto es una tabla y no una
 *    columna: cada navegador es una suscripción propia.
 *  - Una suscripción no es un string: son un `endpoint` (la URL del servicio de push del
 *    navegador) y dos claves con las que se cifra el contenido. El servidor no puede leer lo
 *    que manda una vez cifrado; solo el navegador destino puede.
 *
 * El `endpoint` es único: si el mismo navegador se vuelve a suscribir, se actualizan sus
 * claves en vez de duplicar la fila.
 *
 * ⚠️ Sin `paranoid`: cuando el navegador dice que una suscripción murió (410 Gone), hay que
 * BORRARLA de verdad. Una suscripción muerta que sigue en la tabla se reintenta en cada
 * envío y no sirve para nada: no es un dato de negocio, es una dirección que ya no existe.
 * @param {import('sequelize').Sequelize} db - Conexión única de la app.
 * @returns {import('sequelize').ModelStatic<any>} El modelo PushSubscription.
 */
export const definePushSubscriptionModel = (db) => {
    const PushSubscription = db.define('push_subscriptions', {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        userId: { type: DataTypes.INTEGER, allowNull: false },
        endpoint: { type: DataTypes.STRING(500), allowNull: false, unique: true },
        /** Clave pública del navegador para cifrar el contenido. */
        p256dh: { type: DataTypes.STRING(255), allowNull: false },
        /** Secreto de autenticación del navegador. */
        auth: { type: DataTypes.STRING(255), allowNull: false },
        /** Para que el usuario reconozca cuál es cuál en la lista de dispositivos. */
        userAgent: { type: DataTypes.STRING(255), allowNull: true },
        ultimoEnvioAt: { type: DataTypes.DATE, allowNull: true }
    }, {
        tableName: 'push_subscriptions',
        timestamps: true,
        paranoid: false,
        indexes: [{ fields: ['userId'] }]
    });

    PushSubscription.associate = (models) => {
        if (models.User) PushSubscription.belongsTo(models.User, { foreignKey: 'userId' });
    };

    return PushSubscription;
};
