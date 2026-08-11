# Vault de secretos — Zero 2.0

> ⚠️ **Keep in sync.** Servicio en `kernel/vault/vault.service.js`; modelo `TenantSecret`.

Guarda secretos sensibles por tenant (API keys de terceros, tokens, credenciales) **cifrados at-rest** con **AES-256-GCM**, en la tabla `tenant_secrets`. GCM da confidencialidad + integridad: si el ciphertext o el IV se alteran, el descifrado falla en vez de devolver basura.

## Uso (vía el barrel)

```js
import { vaultSet, vaultGet, vaultList, vaultDelete } from '../../../kernel/index.js';

await vaultSet(req.models, 'stripe_api_key', 'sk_live_...');   // upsert por name; devuelve solo { name }
const key = await vaultGet(req.models, 'stripe_api_key');      // descifra; null si no existe
const names = await vaultList(req.models);                     // solo NOMBRES, nunca valores
await vaultDelete(req.models, 'stripe_api_key');               // soft-delete (paranoid)
```

Contrato: `vaultSet`/`vaultList` **nunca** devuelven el valor ni el ciphertext. `vaultGet` es la única que descifra.

## Derivación de clave

La clave AES-256 se **deriva** (no se usa cruda) con `scrypt` a partir de `VAULT_KEY` (preferida) o, como fallback, `JWT_SECRET`. La salt es fija a propósito (`zero-vault`): el objetivo es estirar el material a 32 bytes de forma **determinística** (el mismo `VAULT_KEY` produce siempre la misma clave, condición necesaria para descifrar después), no resistir rainbow tables sobre un secreto de entorno.

Degradación: si no hay ni `VAULT_KEY` ni `JWT_SECRET`, el proceso **arranca igual** (no se valida al importar); recién al **usar** el vault se tira un error claro.

## Detalles de cifrado

- IV aleatorio de 12 bytes por cada cifrado (dos secretos iguales → ciphertexts distintos).
- Se guarda `valueEncrypted` + `iv` + `authTag` (base64). El `authTag` se valida al descifrar.
- El `defaultScope` de `TenantSecret` oculta las columnas crypto; el servicio usa `unscoped()` solo donde necesita el ciphertext.

## Variables de entorno

```
VAULT_KEY=          # clave maestra del vault; si vacía, cae a JWT_SECRET
```
