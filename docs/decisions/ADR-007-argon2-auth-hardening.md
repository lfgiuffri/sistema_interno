# ADR-007 — argon2id + hardening de auth

- **Status**: Aceptado
- **Date**: 2026-06-30

## Context

El proyecto heredó hashing de passwords con bcryptjs. Las prácticas de seguridad recomiendan **argon2id** (resistente a GPU/ASIC y a side-channels) para nuevos hashes. Además, varios flujos de auth necesitaban endurecerse (MFA, passwordless, self-signup, anti-enumeración).

## Decision

**Migrar a argon2id con back-compat bcrypt, y endurecer los flujos de auth.**

- `kernel/auth/password.js`: `hashPassword` usa argon2id (`@node-rs/argon2`). `verifyPassword` detecta el formato del hash (bcrypt legacy `$2a/$2b/$2y` → compara con bcrypt; resto → argon2). `needsRehash(hash)` indica si conviene re-hashear a argon2 en el próximo login exitoso (rehash-on-login), sin romper usuarios existentes.
- **MFA/TOTP** (`kernel/auth/mfa.service.js`): TOTP 6 dígitos / 30s, ventana ±1; 10 backup codes de un solo uso hasheados SHA-256; desactivar MFA exige password (**step-up**).
- **Passwordless**: OTP / magic link con TTL corto; respuesta genérica (no revela si el email existe).
- **Self-signup anti-fantasma**: captcha + confirmación de email; el tenant no se crea hasta confirmar; password de la solicitud cifrada AES-256-GCM.
- **Anti-enumeración**: mensajes de login genéricos ("Credenciales inválidas").

## Alternatives

- **Quedarse en bcrypt**: menor migración, pero peor margen de seguridad a futuro.
- **Migración forzada (re-hash de todos al deploy)**: imposible sin las passwords en claro; por eso se elige rehash-on-login.

## Consequences

- **+** Hashes nuevos en argon2id; los legacy siguen funcionando y se migran solos al loguear.
- **+** Superficie de auth endurecida (MFA con backup codes, passwordless, signup verificado, anti-enumeración).
- **−** Dependencia nativa (`@node-rs/argon2`) — requiere binarios por plataforma (cubierto por el paquete).
- **−** Conviven dos algoritmos durante la transición; `verifyPassword` debe seguir soportando bcrypt mientras queden hashes legacy.
