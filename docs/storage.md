# Storage — Sistema Interno

> ⚠️ **Keep in sync.** Facade en `services/storage/storage.service.js`; drivers en `services/storage/providers/`; config en `services/storage/config/storage.config.js`.

Storage **pluggable**: los módulos guardan/leen archivos sin saber si el backend es disco local o S3. Single-tenant: no hay prefijo por tenant, toda key se prefija con `app/` (así un bucket compartido no mezcla apps).

> Este facade sirve archivos **públicos**. Los adjuntos privados (tareas, empleados) NO pasan por acá: van a `storage/<modulo>/` fuera de `public`, servidos con auth por `archivo.service.js` / `archivoEmpleado.service.js`.

## Drivers

- **`local`** (default): filesystem bajo `STORAGE_LOCAL_ROOT` (`public/storage`), servido como estático bajo `/public/storage`. Ideal para apps simples / dev.
- **`s3`**: cualquier backend S3-compatible (AWS S3, Cloudflare R2, MinIO). Para R2/MinIO usar `STORAGE_S3_ENDPOINT` + `STORAGE_S3_FORCE_PATH_STYLE=true`. Sin `STORAGE_S3_ACCESS_KEY` usa la cadena de credenciales del entorno (IAM role).

El driver se elige por `STORAGE_DRIVER`.

## Uso (vía el barrel del kernel)

```js
import { putFile, getFile, getFileUrl, deleteFile, fileExists, activeStorageDriver } from '../../../kernel/index.js';

await putFile('avatars/u1.png', buffer, { contentType: 'image/png' });
const url = await getFileUrl('avatars/u1.png');   // URL pública (local) o presignada (S3)
const buf = await getFile('avatars/u1.png');
await deleteFile('avatars/u1.png');               // idempotente
```

Todas las funciones reciben la key lógica; el facade aplica el prefijo `app/` y rechaza keys vacías o con path traversal (`../`). `putFile` exige un `Buffer` y valida `STORAGE_MAX_FILE_SIZE` (tira si se excede). `getFileUrl` acepta `{ expiresIn }` para presignar en S3.

## Contrato del driver (`StorageProvider`)

Cada provider implementa: `name`, `put(key, buffer, opts)`, `get(key)`, `del(key)`, `exists(key)`, `getUrl(key, opts)` — siempre sobre la key **completa** (el prefijo ya lo aplicó el facade). Agregar un driver = crear el archivo cumpliendo el contrato y sumarlo a `providers/index.js`.

## Variables de entorno

```
STORAGE_DRIVER=local                 # local | s3
STORAGE_MAX_FILE_SIZE=52428800       # bytes (default 50MB)
# local
STORAGE_LOCAL_ROOT=public/storage
STORAGE_LOCAL_PUBLIC_PATH=/public/storage
# s3 / r2 / minio
STORAGE_S3_BUCKET, STORAGE_S3_REGION, STORAGE_S3_ENDPOINT
STORAGE_S3_ACCESS_KEY, STORAGE_S3_SECRET_KEY, STORAGE_S3_FORCE_PATH_STYLE
STORAGE_S3_PRESIGN_EXPIRES=900       # segundos de vigencia de las URLs presignadas
```
