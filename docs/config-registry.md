# Config registry — Zero 2.0

> ⚠️ **Keep in sync.** Schema y resolución en `kernel/config-registry/registry.js`.

Un único lugar que declara **todo lo configurable** de Zero, por secciones (app, auth, storage, realtime, billing, webhooks, vault, ai), con tipo, default, variable de entorno y si es secreto. Inspirado en el `config.toml` de Supabase. Resuelve el valor efectivo (env → default) con coerción de tipo y **enmascara secretos** al exponerlos.

## Uso (vía el barrel)

```js
import { getConfig, getSection, getEffectiveConfig, CONFIG_SCHEMA } from '../../kernel/index.js';

getConfig('storage', 'driver');     // 'local' (valor crudo, coercionado al tipo)
getSection('billing');              // { defaultProvider: 'stripe', stripeSecretKey: '***', ... } (secretos enmascarados)
getEffectiveConfig();               // toda la config efectiva por sección (secretos enmascarados)
```

- `getConfig(section, key)` devuelve el **valor crudo** (sin enmascarar) — para uso interno.
- `getSection` / `getEffectiveConfig` **enmascaran** los secretos (`'***'`) — para exponer al admin/diagnóstico.

## El schema (`CONFIG_SCHEMA`)

Cada clave declara `{ type, default, env, secret?, desc }`. Es la **fuente de verdad** de qué config existe y cómo se llama cada variable de entorno. Agregar config = declararla acá. Secciones actuales:

| Sección | Claves (ejemplos) |
|---------|-------------------|
| `app` | `name` (APP_NAME), `publicApiUrl`, `frontendUrl` |
| `auth` | `accessTokenExpiry`, `refreshTokenExpiry`, `auth0Domain`, `mfaTokenTtl`, `passwordlessTtlMin` |
| `storage` | `driver`, `s3Bucket`, `s3SecretKey` (secret), `maxFileSize` |
| `realtime` | `corsOrigin` |
| `billing` | `defaultProvider`, `stripeSecretKey` (secret), `mpAccessToken` (secret) |
| `webhooks` | `maxAttempts` |
| `vault` | `key` (secret) |
| `ai` | `groqKey` (secret), `geminiKey` (secret) |

## Hoy y mañana

Hoy resuelve **de entorno** (es la base "muy configurable" del proyecto). A futuro (admin / M10) el panel puede leer/mostrar esta config y overridear por tenant; mantener `CONFIG_SCHEMA` como fuente de verdad de qué existe.
