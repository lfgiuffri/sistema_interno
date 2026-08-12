import 'dotenv/config';

const int = (name, fallback) => {
    const v = parseInt(process.env[name], 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Configuración del storage pluggable (facade + providers local/S3).
 * Single-tenant: no hay prefijo por tenant, todas las keys cuelgan de `app/`
 * (se mantiene el prefijo para que un bucket compartido no mezcle apps).
 */
export const STORAGE = {
    driver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
    maxFileSize: int('STORAGE_MAX_FILE_SIZE', 52428800), // 50 MB
    keyPrefix: 'app',
    local: {
        root: process.env.STORAGE_LOCAL_ROOT || 'public/storage',
        // Debe coincidir con el estático que monta app.js (`/public` → carpeta public).
        publicPath: process.env.STORAGE_LOCAL_PUBLIC_PATH || '/public/storage',
    },
    s3: {
        bucket: process.env.STORAGE_S3_BUCKET || '',
        region: process.env.STORAGE_S3_REGION || 'us-east-1',
        endpoint: process.env.STORAGE_S3_ENDPOINT || '',
        accessKey: process.env.STORAGE_S3_ACCESS_KEY || '',
        secretKey: process.env.STORAGE_S3_SECRET_KEY || '',
        forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === 'true',
        presignExpiresIn: int('STORAGE_S3_PRESIGN_EXPIRES', 900), // 15 min
    },
};
