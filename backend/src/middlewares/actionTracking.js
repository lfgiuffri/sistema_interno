import { getIP } from '../libs/getIp.js';
import { redactarHeaders, redactarBody } from '../libs/redaccion.js';

/**
 * Bitácora de requests. Corre ANTES de cualquier autenticación, así que ve el request crudo:
 * todo lo que guarde tiene que pasar por la redacción de `libs/redaccion.js` primero.
 * @param {import('express').Request} req - Request.
 * @param {import('express').Response} res - Response.
 * @param {import('express').NextFunction} next - Siguiente middleware.
 * @returns {Promise<void>}
 */
export const actionTrackingMidd = async (req, res, next) => {
    try {

        // Antes se filtraba solo la clave exacta `password`, así que el token del header y
        // campos como `newPassword` quedaban en texto plano en la tabla.
        const bodyActionTracking = redactarBody(req.body);

        const { ActionTracking } = req.models;
        
        const startTime = Date.now();
        
        // Interceptar el final de la respuesta para calcular el tiempo
        const originalSend = res.send;
        res.send = function(data) {
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            // Crear el log después de la respuesta
            setImmediate(async () => {
                try {
                    const logData = {
                        userId: req.user ? req.user.id : null,
                        ip: getIP(req),
                        method: req.method,
                        url: req.url,
                        header: JSON.stringify(redactarHeaders(req.headers)),
                        body: JSON.stringify(bodyActionTracking),
                        responseStatus: res.statusCode,
                        responseTime: Math.min(Math.floor(responseTime), 2147483647) // Usar responseTime, no endTime
                    };

                    await ActionTracking.create(logData);
                } catch (error) {
                    console.error('Error en action tracking:', error);
                }
            });
            
            return originalSend.call(this, data);
        };

        next();

    } catch (error) {
        // No fallar el request por error en logging
        console.error('Error en action tracking:', error);
        next();
    }
};