import { Op } from 'sequelize';
import { getIP } from './getIp.js';
import { getFormattedTimestamp } from './timestamp.js';

/**
 * Sistema de gestión de respuestas con notificaciones integradas
 * Maneja respuestas homogéneas y notificaciones automáticas según configuración del tenant
 * 
 * @param {number} code - Código HTTP de respuesta
 * @param {any} data - Datos a devolver (objeto, array, string, etc.)
 * @param {Object} req - Request object (necesario para acceso a modelos del tenant)
 * @param {Object} res - Response object de Express
 * @param {boolean} notification - Si debe enviar notificaciones para errores críticos
 * @param {Object} options - Opciones adicionales
 * @returns {Object} Respuesta estructurada
 */
export const responseManager = async (code, data, req = null, res = null, notification = false, options = {}) => {
    try {
      const timestamp = getFormattedTimestamp();
      const isSuccess = code >= 200 && code < 300;
      let response;

      if (isSuccess) {
        response = buildSuccessResponse(code, data, timestamp, options);
      } else {
        response = buildErrorResponse(code, data, timestamp, options);
      }

      // Auto-log de cualquier respuesta de error a la tabla ErrorLog
      if (!isSuccess && req) {
        try {
          const errorLog = await saveErrorLog(response, req, data);
          if (errorLog) response.errorLogId = errorLog.id;
        } catch (logErr) {
          console.error('❌ [RESPONSE_MANAGER] Error guardando ErrorLog:', logErr.message);
        }
      }

      // Enviar notificaciones si es necesario y hay error crítico
      if (notification && req) {
        await sendNotifications(response, req, options);
      }
      
      // Si se proporciona res, enviar respuesta automáticamente
      if (res) {
        return res.status(code).json(response);
      }
      
      return response;
    } catch (error) {
        console.error('❌ [RESPONSE_MANAGER] Error interno:', error);
        
        const fallbackResponse = {
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Error interno del sistema de respuestas',
            timestamp: getFormattedTimestamp(),
            code: 500
        };
        
        if (res) {
            return res.status(500).json(fallbackResponse);
        }
        
        return fallbackResponse;
    }
};

/**
 * Construye respuesta de éxito
 */
const buildSuccessResponse = (code, data, timestamp, options = {}) => {
    const response = {
      success: true,
      code,
      timestamp
    };
    
    // Mensaje personalizado o por defecto según código
    if (options.message) {
      response.message = options.message;
    } else {
      response.message = getDefaultSuccessMessage(code);
    }
    
    // Incluir datos si existen
    if (data !== undefined && data !== null) {
      response.data = data;
    }
    
    // Metadatos adicionales
    if (options.meta) {
      response.meta = options.meta;
    }
    
    return response;
};

/**
 * Construye respuesta de error
 */
const buildErrorResponse = (code, data, timestamp, options = {}) => {
    const response = {
      success: false,
      code,
      timestamp
    };
    
    // Tipo de error según código HTTP
    response.error = getErrorType(code);
    
    // Mensaje de error
    if (typeof data === 'string') {
      response.message = data;
    } else if (options.message) {
      response.message = options.message;
    } else {
      response.message = getDefaultErrorMessage(code);
    }
    
    // Detalles adicionales del error
    if (typeof data === 'object' && data !== null) {
      if (data.message) {
        response.message = data.message;
      }
      if (data.details) {
        response.details = data.details;
      }
      if (data.validation) {
        response.validation = data.validation;
      }
      if (data.error && typeof data.error === 'string') {
        response.error = data.error;
      }
      // Incluir cualquier campo adicional (errors, missingAttributes, etc.)
      Object.keys(data).forEach(key => {
        if (!['message', 'details', 'validation', 'error'].includes(key)) {
          response[key] = data[key];
        }
      });
    }
    
    // Código de error específico (TOKEN_EXPIRED, REFRESH_TOKEN_EXPIRED, etc.)
    if (options.errorCode) {
      response.errorCode = options.errorCode;
    }

    // Información de depuración en desarrollo
    if (process.env.NODE_ENV === 'development' && options.stack) {
      response.stack = options.stack;
    }
    
    return response;
};

/**
 * Obtiene el tipo de error según código HTTP
 */
const getErrorType = (code) => {
    const errorTypes = {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'VALIDATION_ERROR',
        429: 'RATE_LIMITED',
        500: 'INTERNAL_ERROR',
        502: 'BAD_GATEWAY',
        503: 'SERVICE_UNAVAILABLE'
    };
    
    return errorTypes[code] || 'UNKNOWN_ERROR';
};

/**
 * Obtiene mensaje de éxito por defecto según código
 */
const getDefaultSuccessMessage = (code) => {
    const messages = {
        200: 'Operación exitosa',
        201: 'Recurso creado exitosamente',
        202: 'Solicitud aceptada',
        204: 'Operación completada'
    };
    
    return messages[code] || 'Operación exitosa';
};

/**
 * Obtiene mensaje de error por defecto según código
 */
const getDefaultErrorMessage = (code) => {
    const messages = {
        400: 'Solicitud inválida',
        401: 'No autorizado - Token requerido',
        403: 'Acceso denegado - Permisos insuficientes',
        404: 'Recurso no encontrado',
        409: 'Conflicto - Recurso ya existe',
        422: 'Error de validación',
        429: 'Demasiadas solicitudes',
        500: 'Error interno del servidor',
        502: 'Error de puerta de enlace',
        503: 'Servicio no disponible'
    };
    
    return messages[code] || 'Error del servidor';
};

/**
 * Sanitiza los headers para no persistir tokens sensibles en la tabla de errores.
 */
const sanitizeHeaders = (headers = {}) => {
    const clone = { ...headers };
    for (const key of Object.keys(clone)) {
        const lower = key.toLowerCase();
        if (lower === 'authorization' || lower === 'x-access-token' || lower === 'x-refresh-token' || lower === 'cookie') {
            clone[key] = '[REDACTED]';
        }
    }
    return clone;
};

/**
 * Trunca un string a un máximo razonable para evitar sobrecargar la tabla.
 */
const clip = (str, max = 65000) => {
    if (str == null) return null;
    const s = typeof str === 'string' ? str : JSON.stringify(str);
    return s.length > max ? s.slice(0, max) + '…[truncado]' : s;
};

/**
 * Guarda un error en la tabla ErrorLog del tenant.
 * @param {Object} response - Respuesta de error generada por responseManager
 * @param {Object} req - Request object
 * @param {*} originalData - Dato original pasado a responseManager (puede ser un Error con stack)
 * @returns {Object|null} ErrorLog creado o null si no se pudo guardar
 */
const saveErrorLog = async (response, req, originalData = null) => {
    try {
        if (!req.models || !req.models.ErrorLog) {
            // Sin modelo (ej: ruta master sin tenant identificado) — no es error, solo se omite
            return null;
        }

        const clientIP = getIP(req);
        const stack = originalData && originalData instanceof Error ? originalData.stack : null;

        const errorLog = await req.models.ErrorLog.create({
            ip: clientIP,
            method: req.method,
            url: clip(req.originalUrl || req.url, 2000),
            header: clip(JSON.stringify(sanitizeHeaders(req.headers))),
            body: clip(JSON.stringify(req.body || {})),
            userId: req.user ? req.user.id : null,
            code: response.code,
            error: response.error ? String(response.error).slice(0, 100) : null,
            message: clip(response.message),
            stack: clip(stack),
            response: clip(JSON.stringify(response))
        });
        return errorLog;
    } catch (error) {
        console.error('❌ [RESPONSE_MANAGER] Error guardando ErrorLog:', error.message);
        return null;
    }
};

/**
 * Envía notificaciones según configuración del tenant
 */
const sendNotifications = async (response, req, options = {}) => {
    try {
      if (!req.models || !req.models.Config) {
        console.warn('⚠️ [RESPONSE_MANAGER] No hay acceso a modelos para notificaciones');
        return;
      }
      
      // Obtener configuración de notificaciones
      const notificationConfig = await req.models.Config.findOne({
        where: { name: 'NOTIFICATION_OPTIONS' }
      });
      
      if (!notificationConfig) {
        console.warn('⚠️ [RESPONSE_MANAGER] Configuración NOTIFICATION_OPTIONS no encontrada');
        return;
      }
      
      let notificationSettings;
      try {
        notificationSettings = JSON.parse(notificationConfig.value);
      } catch (parseError) {
        console.error('❌ [RESPONSE_MANAGER] Error parseando NOTIFICATION_OPTIONS:', parseError);
        console.error('❌ [RESPONSE_MANAGER] Valor recibido:', notificationConfig.value);
        return;
      }
      
      // Preparar mensaje de notificación
      const notificationMessage = await buildNotificationMessage(response, req, options);
      
      // Enviar Email si está habilitado
      if (notificationSettings.email?.active && notificationSettings.email?.recipient) {
        try {
          await sendEmailNotification(
            notificationSettings.email.recipient, 
            notificationMessage, 
            req,
            response.errorLogId
          );
        } catch (emailError) {
          console.error('❌ [RESPONSE_MANAGER] Error enviando Email:', emailError);
        }
      }
        
    } catch (error) {
      console.error('❌ [RESPONSE_MANAGER] Error enviando notificaciones:', error);
    }
};

/**
 * Construye el mensaje de notificación con información relevante
 */
const buildNotificationMessage = async (response, req, options = {}) => {
    try {
        // Información base del error
        const errorType = response.error || 'ERROR_DESCONOCIDO';
        const errorMessage = response.message || 'Sin mensaje específico';
        const timestamp = response.timestamp;
        const code = response.code;
        const logId = response.errorLogId || 'No disponible';
        
        // Información del usuario con formato "ID - Nombre"
        let userInfo = 'Anónimo';
        if (req.user) {
            const userName = req.user.name || req.user.username || req.user.email || 'Sin nombre';
            userInfo = `${req.user.id} - ${userName}`;
        }
        
        // Información del tenant con formato "ID - Nombre"
        let tenantInfo = 'Desconocido';
        try {
            // Intentar obtener tenant del header o req.tenant
            const tenantHeader = req.headers?.tenant;
            if (tenantHeader && typeof tenantHeader === 'string') {
                tenantInfo = tenantHeader;
            } else if (req.tenant) {
                // Si req.tenant es un objeto, formatear como "ID - Nombre"
                if (typeof req.tenant === 'object') {
                    const tenantId = req.tenant.id || 'Sin ID';
                    const tenantName = req.tenant.name || req.tenant.subdomain || 'Sin nombre';
                    tenantInfo = `${tenantId} - ${tenantName}`;
                } else {
                    tenantInfo = req.tenant.toString();
                }
            }
        } catch (tenantError) {
            console.warn('⚠️ [RESPONSE_MANAGER] Error obteniendo info del tenant:', tenantError);
        }
        
        // Nombre de la app desde el entorno (single-tenant: no hay GlobalConfigs).
        const appName = process.env.APP_NAME || 'Sistema Interno';
        
        return `🚨 ERROR EN ${appName}
        
🏢 Aplicación: ${appName}
🏪 Tenant: ${tenantInfo}
👤 Usuario: ${userInfo}
🆔 Log ID: ${logId}

⚠️ Tipo Error: ${errorType}
📋 Código HTTP: ${code}
💬 Mensaje: ${errorMessage}
🕐 Timestamp: ${timestamp}`;
        
    } catch (error) {
        console.error('❌ [RESPONSE_MANAGER] Error construyendo mensaje de notificación:', error);
        
        // Mensaje de fallback si hay error
        return `🚨 ERROR CRÍTICO DETECTADO
        
⚠️ Tipo: ${response.error || 'ERROR_DESCONOCIDO'}
📋 Código: ${response.code}
💬 Mensaje: ${response.message || 'Sin mensaje específico'}
🕐 Timestamp: ${response.timestamp}
🆔 Log ID: ${response.errorLogId || 'No disponible'}`;
    }
};

/**
 * Envía notificación por Email (placeholder para futura implementación)
 */
const sendEmailNotification = async (recipient, message, req, logId = null) => {
    // TODO: Implementar servicio de email
    console.log('📧 [RESPONSE_MANAGER] Email notification (no implementado):', recipient);
    console.log('Mensaje:', message);
    console.log('Log ID:', logId);
    
    // Por ahora simular éxito para testing
    // Cuando se implemente el servicio real, remover esta línea y agregar la lógica real
    return Promise.resolve();
};



export { saveErrorLog };

export default responseManager;
