/**
 * Utilidad para obtener la IP real del cliente
 * Maneja proxies, balanceadores de carga y diferentes configuraciones de red
 */

/**
 * Obtiene la IP real del cliente considerando proxies y balanceadores de carga
 * @param {Object} req - Request object de Express
 * @returns {string} IP del cliente o 'unknown' si no se puede determinar
 */
export const getIP = (req) => {
    // Intentar obtener IP de headers de proxy/balanceador de carga
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        // x-forwarded-for puede contener múltiples IPs separadas por coma
        const ips = forwarded.split(',').map(ip => ip.trim());
        // Tomar la primera IP (cliente original)
        return ips[0];
    }
    
    // Otros headers comunes para IP real
    const realIP = req.headers['x-real-ip'] || 
                   req.headers['x-client-ip'] || 
                   req.headers['cf-connecting-ip'] || // Cloudflare
                   req.headers['x-forwarded'] ||
                   req.headers['forwarded-for'] ||
                   req.headers['forwarded'];
    
    if (realIP) {
        return realIP;
    }
    
    // Fallback a la IP de conexión
    const connectionIP = req.connection?.remoteAddress || 
                        req.socket?.remoteAddress || 
                        req.info?.remoteAddress ||
                        req.ip;
    
    // Limpiar formato IPv6 mapped IPv4 (::ffff:192.168.1.1 -> 192.168.1.1)
    if (connectionIP && connectionIP.startsWith('::ffff:')) {
        return connectionIP.substring(7);
    }
    
    // Si es ::1 (localhost IPv6), convertir a IPv4
    if (connectionIP === '::1') {
        return '127.0.0.1';
    }
    
    return connectionIP || 'unknown';
};

export default getIP;
