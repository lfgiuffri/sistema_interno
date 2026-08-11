/**
 * Zero 2.0 — Servicio genérico de embeddings + búsqueda semántica.
 *
 * Generaliza la "semantic memory": cualquier feature puede indexar texto (con un dueño
 * lógico ownerType/ownerId) y luego buscarlo por similitud semántica. Toda la lógica y el
 * acceso a datos viven acá (patrón controller-helper); no conoce `req`/`res`, recibe los
 * modelos del tenant + parámetros planos → reutilizable desde controllers, scheduler,
 * sockets o jobs, y testeable en aislamiento. Toda query se filtra por `userId`
 * (aislamiento intra-tenant / anti-IDOR).
 *
 * Degradación elegante: el embedding depende de una key de IA. Si `embedText` devuelve null
 * (no hay key, o falló), NO rompemos: al indexar guardamos vector=null (se reintenta a futuro)
 * y al buscar caemos a un LIKE sobre `content`. Así el feature funciona sin IA configurada.
 */

import { Op } from 'sequelize';
// Embeddings de IA. Path relativo desde src/services/embeddings/ → src/services/ai/services/.
import { embedText } from '../ai/services/ai.service.js';

/**
 * Calcula la similitud coseno entre dos vectores de igual dimensión.
 * Función pura → fácil de testear en aislamiento. Devuelve 0 si algún vector es inválido,
 * tiene distinta longitud, o su norma es 0 (evita división por cero y NaN).
 * @param {number[]} a - Primer vector.
 * @param {number[]} b - Segundo vector.
 * @returns {number} Similitud coseno en el rango [-1, 1] (0 si no es comparable).
 */
export const cosineSimilarity = (a, b) => {
    // Validación defensiva: ambos deben ser arrays de la misma longitud y no vacíos.
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
        return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    // Un solo recorrido acumula producto punto y ambas normas (más barato que tres loops).
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        dot += x * y;
        normA += x * x;
        normB += y * y;
    }
    // Si alguna norma es 0, el vector es nulo → no hay dirección que comparar.
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * Indexa (crea o actualiza) un fragmento de texto para búsqueda semántica.
 *
 * Calcula el embedding del contenido (puede ser null si no hay key de IA → se guarda igual con
 * vector=null para reintentar luego). El "upsert lógico" se hace por la tripleta
 * (userId, ownerType, ownerId): si ownerId viene definido y ya existe un item para esa entidad,
 * se actualiza en lugar de duplicar. Si ownerId es null (texto suelto), siempre se crea uno nuevo.
 *
 * @param {object} models - Modelos del tenant (req.models).
 * @param {object} params - Datos a indexar.
 * @param {number} params.userId - Dueño del embedding (aislamiento intra-tenant).
 * @param {string} params.ownerType - Tipo de la entidad dueña (ej. "note").
 * @param {string|null} [params.ownerId] - Id de la entidad dueña (null para texto suelto).
 * @param {string} params.content - Texto a indexar.
 * @returns {Promise<object>} El EmbeddingItem creado o actualizado.
 */
export const indexEmbedding = async (models, { userId, ownerType, ownerId = null, content }) => {
    const { EmbeddingItem } = models;

    // Calculamos el vector. Si no hay key/falla, embedText devuelve null y guardamos vector=null
    // (queda pendiente de embeddear; un job futuro puede reintentar los de vector=null).
    const vector = await embedText(content);

    // Upsert lógico solo cuando hay ownerId: una entidad concreta tiene a lo sumo un embedding.
    if (ownerId !== null && ownerId !== undefined) {
        const existing = await EmbeddingItem.findOne({ where: { userId, ownerType, ownerId } });
        if (existing) {
            // Actualizamos contenido y vector (el contenido pudo cambiar en la entidad origen).
            existing.content = content;
            existing.vector = vector;
            await existing.save();
            return existing;
        }
    }

    // Sin ownerId (texto suelto) o no existía previo → creamos un nuevo item.
    return EmbeddingItem.create({ userId, ownerType, ownerId: ownerId ?? null, content, vector });
};

/**
 * Busca los textos del usuario más relevantes para una consulta.
 *
 * Estrategia:
 * 1. Intenta embeddear la query. Si `embedText` devuelve null (sin key/falla), degrada a una
 *    búsqueda por LIKE sobre `content` (sin score semántico) → el feature sigue usable.
 * 2. Si hay vector de query, trae los EmbeddingItem del usuario que ya tienen vector (vector != null)
 *    y los rankea por similitud coseno calculada en JS, devolviendo los top `k` con su score.
 *
 * @param {object} models - Modelos del tenant (req.models).
 * @param {number} userId - Dueño de los embeddings (aislamiento intra-tenant).
 * @param {string} query - Texto de búsqueda.
 * @param {number} [k=5] - Cantidad máxima de resultados a devolver.
 * @returns {Promise<Array<{item: object, score: number}>>} Top k resultados con su score (0 en modo LIKE).
 */
export const searchEmbeddings = async (models, userId, query, k = 5) => {
    const { EmbeddingItem } = models;

    // Clamp defensivo de k (evita pedir cantidades absurdas o negativas).
    const limit = Math.min(Math.max(parseInt(k, 10) || 5, 1), 100);

    // 1) Intentamos vectorizar la consulta.
    const queryVector = await embedText(query);

    // 2) Fallback sin IA: búsqueda textual por LIKE. score=0 porque no hay similitud semántica.
    if (!queryVector) {
        const rows = await EmbeddingItem.findAll({
            where: {
                userId,
                content: { [Op.like]: `%${query}%` }
            },
            order: [['createdAt', 'DESC']],
            limit
        });
        return rows.map((item) => ({ item, score: 0 }));
    }

    // 3) Modo semántico: traemos solo los que tienen vector (los de vector=null no son comparables).
    const candidates = await EmbeddingItem.findAll({
        where: {
            userId,
            vector: { [Op.ne]: null }
        }
    });

    // Calculamos score por coseno, ordenamos desc y recortamos al top k.
    return candidates
        .map((item) => ({ item, score: cosineSimilarity(queryVector, item.vector) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
};

/**
 * Elimina (soft-delete, por paranoid) los embeddings de una entidad dueña concreta del usuario.
 * Útil cuando la entidad origen se borra o cambia de identidad y hay que limpiar su índice.
 *
 * @param {object} models - Modelos del tenant (req.models).
 * @param {number} userId - Dueño de los embeddings (aislamiento intra-tenant).
 * @param {string} ownerType - Tipo de la entidad dueña (ej. "note").
 * @param {string} ownerId - Id de la entidad dueña cuyos embeddings se eliminan.
 * @returns {Promise<number>} Cantidad de filas eliminadas.
 */
export const removeEmbeddingsByOwner = async (models, userId, ownerType, ownerId) => {
    const { EmbeddingItem } = models;
    // destroy soft-deletea (paranoid:true) → nunca borrado físico (convención Zero).
    return EmbeddingItem.destroy({ where: { userId, ownerType, ownerId } });
};
