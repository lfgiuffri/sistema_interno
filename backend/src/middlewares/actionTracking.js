import { getIP } from '../libs/getIp.js';

export const actionTrackingMidd = async (req, res, next) => {
    try {
        
        let bodyActionTracking = {};
        for (let key in req.body){
            if(key != 'password') bodyActionTracking[key] = req.body[key];
        }

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
                        header: JSON.stringify(req.headers),
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