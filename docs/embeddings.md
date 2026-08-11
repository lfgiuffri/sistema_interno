# Embeddings y búsqueda semántica — Zero 2.0

> ⚠️ **Keep in sync.** Servicio en `services/embeddings/embeddings.service.js`; modelo `EmbeddingItem`; embeddings de IA en `services/ai/services/ai.service.js#embedText`.

Servicio genérico: cualquier feature indexa texto (con un dueño lógico `ownerType`/`ownerId`) y luego lo busca por similitud semántica. Tenant-scoped y filtrado por `userId` (anti-IDOR).

## Uso (vía el barrel)

```js
import { indexEmbedding, searchEmbeddings, removeEmbeddingsByOwner } from '../../../kernel/index.js';

// Indexar (upsert por (userId, ownerType, ownerId) si hay ownerId)
await indexEmbedding(req.models, { userId, ownerType: 'note', ownerId: noteId, content: texto });

// Buscar top-k
const results = await searchEmbeddings(req.models, userId, 'cómo configuro el plan', 5);
// → [{ item, score }, ...]  (score 0 en modo fallback LIKE)

// Limpiar al borrar la entidad origen
await removeEmbeddingsByOwner(req.models, userId, 'note', noteId);
```

## Cómo funciona

- **Indexar**: calcula el embedding del contenido con `embedText` (IA). Si hay `ownerId` y ya existe un item para esa entidad, lo actualiza; si no, crea uno. El vector se guarda en `EmbeddingItem.vector`.
- **Buscar**: vectoriza la query y rankea por **similitud coseno** (calculada en JS) sobre los items del usuario que tienen vector, devolviendo los top-k con `score`.

## Degradación elegante (sin IA configurada)

El embedding depende de una key de IA. Si `embedText` devuelve `null` (no hay key / falló):
- **Al indexar**: se guarda el item con `vector = null` (queda pendiente; un job futuro puede reembeddear).
- **Al buscar**: cae a un `LIKE` sobre `content` (resultados con `score: 0`).

Así el feature funciona aunque no haya IA configurada.

## Variables de entorno

```
GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY    # proveedores de IA (para embedText)
```
