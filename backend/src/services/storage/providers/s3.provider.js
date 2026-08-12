import { STORAGE } from '../config/storage.config.js';

/** @type {object|null} Cliente S3 memoizado (se crea recién en el primer uso). */
let client = null;

/**
 * Crea (una sola vez) el cliente S3. El SDK se importa de forma dinámica para que
 * una instalación con `STORAGE_DRIVER=local` no pague el costo de cargarlo al boot.
 *
 * @returns {Promise<{ s3: object, sdk: object }>} Cliente + comandos del SDK.
 */
const getClient = async () => {
    const sdk = await import('@aws-sdk/client-s3');
    if (!client) {
        if (!STORAGE.s3.bucket) throw new Error('storage: STORAGE_S3_BUCKET no configurado');
        client = new sdk.S3Client({
            region: STORAGE.s3.region,
            // Endpoint custom = R2 / MinIO. Vacío = AWS S3.
            ...(STORAGE.s3.endpoint ? { endpoint: STORAGE.s3.endpoint } : {}),
            forcePathStyle: STORAGE.s3.forcePathStyle,
            ...(STORAGE.s3.accessKey
                ? { credentials: { accessKeyId: STORAGE.s3.accessKey, secretAccessKey: STORAGE.s3.secretKey } }
                : {}), // sin claves explícitas → cadena de credenciales del entorno (IAM role, etc.)
        });
    }
    return { s3: client, sdk };
};

/**
 * Junta un stream del SDK en un Buffer.
 *
 * @param {AsyncIterable<Buffer>} body Body de la respuesta de S3.
 * @returns {Promise<Buffer>}
 */
const toBuffer = async (body) => {
    const chunks = [];
    for await (const chunk of body) chunks.push(chunk);
    return Buffer.concat(chunks);
};

/**
 * Driver `s3`: cualquier backend S3-compatible (AWS S3, Cloudflare R2, MinIO).
 *
 * @type {{ name: string, put: Function, get: Function, del: Function, exists: Function, getUrl: Function }}
 */
export const s3Provider = {
    name: 's3',

    /**
     * @param {string} key Key completa.
     * @param {Buffer} buffer Contenido.
     * @param {{ contentType?: string }} [opts] Metadatos del objeto.
     * @returns {Promise<{ key: string, size: number, contentType: string|null }>}
     */
    async put(key, buffer, opts = {}) {
        const { s3, sdk } = await getClient();
        await s3.send(new sdk.PutObjectCommand({
            Bucket: STORAGE.s3.bucket,
            Key: key,
            Body: buffer,
            ...(opts.contentType ? { ContentType: opts.contentType } : {}),
        }));
        return { key, size: buffer.length, contentType: opts.contentType || null };
    },

    /**
     * @param {string} key Key completa.
     * @returns {Promise<Buffer>}
     */
    async get(key) {
        const { s3, sdk } = await getClient();
        const res = await s3.send(new sdk.GetObjectCommand({ Bucket: STORAGE.s3.bucket, Key: key }));
        return toBuffer(res.Body);
    },

    /**
     * @param {string} key Key completa.
     * @returns {Promise<void>}
     */
    async del(key) {
        const { s3, sdk } = await getClient();
        await s3.send(new sdk.DeleteObjectCommand({ Bucket: STORAGE.s3.bucket, Key: key }));
    },

    /**
     * @param {string} key Key completa.
     * @returns {Promise<boolean>}
     */
    async exists(key) {
        const { s3, sdk } = await getClient();
        try {
            await s3.send(new sdk.HeadObjectCommand({ Bucket: STORAGE.s3.bucket, Key: key }));
            return true;
        } catch (err) {
            // 404/NotFound = no existe; cualquier otro error (permisos, red) sí se propaga.
            if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
            throw err;
        }
    },

    /**
     * URL presignada (el bucket se asume privado).
     *
     * @param {string} key Key completa.
     * @param {{ expiresIn?: number }} [opts] Vigencia en segundos.
     * @returns {Promise<string>}
     */
    async getUrl(key, opts = {}) {
        const { s3, sdk } = await getClient();
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        return getSignedUrl(
            s3,
            new sdk.GetObjectCommand({ Bucket: STORAGE.s3.bucket, Key: key }),
            { expiresIn: opts.expiresIn || STORAGE.s3.presignExpiresIn },
        );
    },
};
