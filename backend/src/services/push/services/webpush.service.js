/**
 * Web Push (navegador) con el protocolo estándar y claves VAPID.
 *
 * Por qué esto y no Firebase: para que a un Chrome le llegue una notificación NO hace falta
 * ninguna cuenta de terceros. El navegador expone un endpoint propio y el servidor le manda
 * el mensaje cifrado, firmado con un par de claves (VAPID) que generamos nosotros. Firebase
 * sigue estando para la app nativa de Android, que sí lo necesita; son dos caminos distintos
 * para dos destinos distintos, y conviven.
 *
 * Configuración: `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en el `.env`. Se generan una vez con
 * `npx web-push generate-vapid-keys` y NO se cambian: la pública queda grabada en cada
 * suscripción de cada navegador, así que rotarla invalida todas.
 */

import webpush from 'web-push';

let configurado = null;

/**
 * Configura la librería con las claves del entorno (una vez por proceso).
 * @returns {boolean} true si hay claves y se puede enviar.
 */
export const webPushConfigurado = () => {
    if (configurado !== null) return configurado;

    const publica = process.env.VAPID_PUBLIC_KEY;
    const privada = process.env.VAPID_PRIVATE_KEY;
    if (!publica || !privada) {
        console.warn('⚠️ [WEBPUSH] Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el .env — las notificaciones del navegador quedan deshabilitadas');
        configurado = false;
        return false;
    }

    // El "subject" identifica a quién contactar si el servicio de push tiene un problema con
    // nuestros envíos. Tiene que ser un mailto: o una URL.
    const contacto = process.env.VAPID_SUBJECT || 'mailto:soporte@positivemedia.com.ar';
    webpush.setVapidDetails(contacto, publica, privada);
    configurado = true;
    return true;
};

/** Clave pública, que el frontend necesita para suscribirse. */
export const clavePublica = () => process.env.VAPID_PUBLIC_KEY || null;

/**
 * Manda una notificación a TODAS las suscripciones de navegador de un usuario.
 *
 * Las suscripciones muertas se borran solas: el servicio de push contesta 404 o 410 cuando el
 * usuario desinstaló la app, limpió los datos del navegador o revocó el permiso. Si no se
 * borraran, cada envío futuro las reintentaría para siempre.
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Destinatario.
 * @param {{titulo: string, cuerpo: string, url?: string, tag?: string}} aviso - Contenido.
 * @returns {Promise<{enviadas: number, eliminadas: number, fallidas: number}>} Resultado.
 */
export const enviarWebPush = async (models, userId, aviso) => {
    const resumen = { enviadas: 0, eliminadas: 0, fallidas: 0 };
    if (!webPushConfigurado() || !models.PushSubscription) return resumen;

    const subs = await models.PushSubscription.findAll({ where: { userId } });
    if (!subs.length) return resumen;

    const payload = JSON.stringify({
        titulo: aviso.titulo,
        cuerpo: aviso.cuerpo,
        url: aviso.url || '/',
        tag: aviso.tag || 'sistema-interno',
    });

    for (const sub of subs) {
        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload,
            );
            await sub.update({ ultimoEnvioAt: new Date() });
            resumen.enviadas++;
        } catch (e) {
            // 404/410 = la suscripción ya no existe del otro lado. Cualquier otro código es un
            // problema transitorio (red, servicio caído) y la suscripción se conserva.
            if (e.statusCode === 404 || e.statusCode === 410) {
                await sub.destroy();
                resumen.eliminadas++;
            } else {
                resumen.fallidas++;
                console.warn(`⚠️ [WEBPUSH] envío fallido (${e.statusCode || 'sin código'}): ${String(e.message).slice(0, 120)}`);
            }
        }
    }
    return resumen;
};

/**
 * Guarda (o actualiza) la suscripción de un navegador.
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Dueño de la suscripción.
 * @param {object} suscripcion - Lo que devuelve `pushManager.subscribe()`.
 * @param {string} [userAgent] - Para distinguir dispositivos en la lista.
 * @returns {Promise<object>} La suscripción guardada.
 */
export const guardarSuscripcion = async (models, userId, suscripcion, userAgent) => {
    const { endpoint, keys } = suscripcion;
    const datos = {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: (userAgent || '').slice(0, 255) || null,
    };

    // El endpoint es único: el mismo navegador re-suscribiéndose actualiza sus claves. Y si
    // la suscripción venía de OTRO usuario (una compu compartida), cambia de dueño.
    const existente = await models.PushSubscription.findOne({ where: { endpoint } });
    if (existente) { await existente.update(datos); return existente; }
    return models.PushSubscription.create(datos);
};

/**
 * Borra una suscripción (el usuario apagó las notificaciones en ese navegador).
 * @param {object} models - Modelos de la app.
 * @param {number} userId - Dueño (se valida para no borrar la de otro).
 * @param {string} endpoint - Identificador de la suscripción.
 * @returns {Promise<boolean>} true si existía y se borró.
 */
export const borrarSuscripcion = async (models, userId, endpoint) => {
    const n = await models.PushSubscription.destroy({ where: { userId, endpoint } });
    return n > 0;
};
