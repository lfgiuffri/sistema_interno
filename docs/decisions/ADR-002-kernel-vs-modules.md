# ADR-002 — Separación física kernel/ vs modules/

- **Status**: Aceptado
- **Date**: 2026-06-30

## Context

Se busca que los **features sean portables**: poder copiar un módulo de una app a otra sin reescribir imports ni reconfigurar. Para eso, la infra (el motor) y los features (dominio) no pueden estar entremezclados ni acoplados por imports profundos.

## Decision

Separación **física** de carpetas:

- **`kernel/`** = infra (master, users, registry, usage, vault, auth, realtime, config-registry, capability, moduleGate, moduleLoader, handlerRegistry). NO se mueve entre apps.
- **`modules/`** = features pluggable, cada uno self-contained con su `module.manifest.js`.
- **`kernel/index.js`** es un **barrel**: única superficie pública de infra. Un módulo importa SOLO desde ahí (`../../../kernel/index.js`), nunca rutas profundas tipo `../../../libs/...`.

Para mover un módulo entre apps: copiar `modules/<nombre>/`. Su único acoplamiento externo es el barrel, que toda app con este kernel expone con la misma API.

## Alternatives

- **Todo en `modules/` (sin kernel separado)**: lo que había antes; mezcla infra y dominio, dificulta saber qué es portable.
- **Paquetes npm internos por módulo**: portabilidad real pero overhead de tooling/versionado desproporcionado para el tamaño del proyecto.

## Consequences

- **+** Copiar una carpeta de `modules/` "just works" en otra app con este kernel.
- **+** Si una pieza de infra se reubica, se actualiza solo el barrel (no cada módulo).
- **+** La frontera es obvia y auditable (¿el módulo importa algo fuera del barrel? = bug).
- **−** Hay que mantener el barrel chico y estable a propósito; agregar exports tiene costo de diseño.
- (Futuro) Con ESM nativo sin babel, el barrel podría exponerse como subpath import `#kernel`. Con babel se evita por riesgo de duplicar singletons (registries) entre `src/` y `build/`.
