import 'dotenv/config';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { signNotificationActionToken } from '../../notifications/services/notificationActions.service.js';

/**
 * Push notification service using Firebase Admin SDK (FCM HTTP v1).
 * Requires FIREBASE_SERVICE_ACCOUNT_PATH env var pointing to the service
 * account JSON downloaded from Firebase Console → Project Settings →
 * Service Accounts.
 *
 * Note: legacy FCM (server key + fcm.googleapis.com/fcm/send) was deprecated
 * by Google in June 2024 and no longer works.
 */

let _initialized = false;
let _initFailed = false;

const initFirebase = () => {
    if (_initialized || _initFailed) return _initialized;

    try {
        const credPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
        if (!credPath) {
            console.warn('⚠️ [PUSH] FIREBASE_SERVICE_ACCOUNT_PATH no definido en .env — push deshabilitado');
            _initFailed = true;
            return false;
        }

        const absPath = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
        if (!fs.existsSync(absPath)) {
            console.warn(`⚠️ [PUSH] Service account no encontrado en ${absPath} — push deshabilitado`);
            _initFailed = true;
            return false;
        }

        const serviceAccount = JSON.parse(fs.readFileSync(absPath, 'utf8'));

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        }

        _initialized = true;
        console.log(`✅ [PUSH] Firebase Admin SDK inicializado (project: ${serviceAccount.project_id})`);
        return true;
    } catch (err) {
        console.error('❌ [PUSH] Error inicializando Firebase Admin:', err.message);
        _initFailed = true;
        return false;
    }
};

/**
 * Send push notification to a specific device token (FCM HTTP v1 via firebase-admin).
 */
export const sendPushNotification = async (token, title, body, data = {}) => {
    if (!token) return { success: false, reason: 'no_token' };

    if (!initFirebase()) {
        return { success: false, reason: 'not_configured' };
    }

    try {
        const hasActions = Array.isArray(data?.actions) && data.actions.length > 0;
        const actionTokens = hasActions && data?.userId
            ? Object.fromEntries(data.actions.map(action => [
                action.id,
                signNotificationActionToken({
                    userId: data.userId,
                    value: action.value,
                    actionId: action.id,
                    type: data.type
                })
            ]).filter(([, signed]) => Boolean(signed)))
            : null;

        // Firebase Admin requires all data values to be strings
        const dataWithActionTokens = actionTokens ? { ...data, actionTokens } : data;
        const stringData = Object.fromEntries(
            Object.entries(dataWithActionTokens).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
        );

        // Para botones 100% nativos con la app cerrada/killed, los avisos con actions
        // viajan como data-only. El servicio Android propio los renderiza con
        // NotificationCompat + PendingIntent. Si mandáramos `notification`, Android
        // mostraría una notificación básica sin llamar al servicio nativo.
        const message = hasActions
            ? {
                token,
                data: {
                    ...stringData,
                    _title: title,
                    _body: body,
                    _nativeActions: 'true',
                    _actionEndpoint: process.env.NOTIFICATION_ACTION_ENDPOINT || `${(process.env.PUBLIC_API_URL || 'https://zeroapp.dev/api').replace(/\/$/, '')}/notification-actions/execute`,
                },
                android: {
                    priority: 'high',
                    ttl: 1000 * 60 * 60 * 24,
                },
                apns: {
                    headers: { 'apns-priority': '10' },
                    payload: {
                        aps: {
                            'content-available': 1,
                            sound: 'default',
                            category: data?.type || 'ZERO_DEFAULT',
                        },
                    },
                },
            }
            : {
                token,
                notification: { title, body },
                data: stringData,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'default',
                        sound: 'default',
                        icon: 'ic_stat_notify',
                        color: '#6366f1',
                        tag: data?.type || 'zero',
                    },
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1,
                            'mutable-content': 1,
                            category: data?.type || 'ZERO_DEFAULT',
                        },
                    },
                },
            };

        const response = await admin.messaging().send(message);
        console.log(`✅ [PUSH] Notificación enviada (${title}): ${response}`);
        return { success: true, messageId: response };
    } catch (error) {
        const code = error?.code || error?.errorInfo?.code || 'unknown';
        const invalidToken =
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument';

        console.warn(`⚠️ [PUSH] Error enviando notificación (${code}):`, error.message);
        return { success: false, error: error.message, code, invalidToken };
    }
};

/**
 * Check if current time is within quiet hours
 */
export const isQuietHours = (quietStart, quietEnd) => {
    if (!quietStart || !quietEnd) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startH, startM] = quietStart.split(':').map(Number);
    const [endH, endM] = quietEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
};

/**
 * Send notification respecting quiet hours and DND settings
 */
export const sendSmartNotification = async (userSettings, title, body, data = {}, priority = 'normal') => {
    if (!userSettings?.pushEnabled || !userSettings?.pushToken) {
        return { success: false, reason: 'disabled' };
    }

    if (userSettings.doNotDisturbEnabled && priority !== 'urgent') {
        return { success: false, reason: 'dnd_active' };
    }

    if (priority !== 'urgent' && isQuietHours(userSettings.quietHoursStart, userSettings.quietHoursEnd)) {
        return { success: false, reason: 'quiet_hours' };
    }

    return sendPushNotification(userSettings.pushToken, title, body, {
        ...data,
        userId: data.userId || userSettings.userId
    });
};
