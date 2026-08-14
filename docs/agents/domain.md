# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context.** El Sistema Interno es un solo producto (backend + frontend + e2e + docs). Hay un único glosario de dominio en `CONTEXT.md` (raíz) y las decisiones de arquitectura viven en `docs/decisions/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (glosario de dominio). Si no existe todavía, se crea de forma lazy cuando `/domain-modeling` resuelve un término.
- **`docs/decisions/`** — los ADRs del proyecto (formato `ADR-NNN-tema.md`). Leé los que tocan el área en la que vas a trabajar. **Nota:** en este repo los ADRs viven en `docs/decisions/`, NO en `docs/adr/` — usá esa ruta.
- **`docs/README.md`** — índice de las guías por área (auth, plans-billing, modularity, storage, realtime, webhooks, embeddings, vault, config-registry, migrations, deployment).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. `/domain-modeling` (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates `CONTEXT.md` lazily when terms or decisions actually get resolved.

## File structure (single-context)

```
/
├── CONTEXT.md                 ← glosario de dominio (lazy)
├── docs/
│   ├── decisions/             ← ADRs (ADR-001 … ADR-007 …)
│   │   ├── ADR-001-multi-tenant.md
│   │   └── ADR-002-kernel-vs-modules.md
│   └── README.md
├── backend/
├── frontend/
└── e2e/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradice ADR-002 (kernel vs modules) — pero vale reabrirlo porque…_
