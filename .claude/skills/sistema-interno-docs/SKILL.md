---
name: sistema-interno-docs
description: Maintain the Sistema Interno documentation (docs/, README.md, CLAUDE.md, ADRs, OpenAPI). Use when writing or updating any documentation, adding an ADR, or when a code change requires doc updates. Enforces the doc structure, the accuracy-to-code rule, the ADR format and the sync rule.
---

# Sistema Interno — Documentation

Docs live in `docs/` and MUST reflect the actual code (no aspirational or stale docs).

## Structure
- `docs/README.md` — index linking everything.
- `docs/architecture/README.md` — single-tenant, kernel vs modules, request flow, auto-discovery, response envelope.
- `docs/modules/README.md` — how to create a module (from the `areas` template) + one page per business module (`abonos.md`, `tareas.md`, `documentacion.md`, `mantenimiento.md`, …).
- `docs/api/README.md` — base URL, headers, envelope, pagination, OpenAPI/Scalar.
- Area guides: `auth.md`, `modularity.md`, `storage.md`, `realtime.md`, `webhooks.md`, `embeddings.md`, `vault.md`, `config-registry.md`, `migrations.md`, `migracion-legado.md`, `deploy-vps-oracle.md`.
- `docs/sql/` — standalone SQL scripts to update a database already in production by hand.
- `docs/decisions/ADR-NNN-*.md` — architecture decisions. **ADRs 001/005/006/011/013 are historical**: they describe the Zero 2.0 starter this app was forked from (tenants, plans, billing) and carry a banner saying so. The decision in force is ADR-015 (single-tenant).
- `docs/best-practices-guidelines.md` — the North Star.
- The API reference is generated: OpenAPI 3 at `/api/openapi.json`, rendered by Scalar at `/api/docs` (from `services/openapi/openapi.service.js`).

## Rules
- **Accuracy first**: read the code before writing; cite real paths and endpoints. Verify the port (3010), env var names (`backend/.env.example`) and status codes.
- **Explain the why, not just the what.** A doc that only restates the code adds nothing; what saves the next person is the reason a decision was made and the trap it avoids.
- **Concise and skimmable** (tables, short examples). Spanish (es-AR).
- **ADR format**: `Status | Date | Context | Decision | Alternatives | Consequences`. A new significant decision → a new ADR; don't rewrite settled ones, supersede them (and mark the old one).
- The app is called **Sistema Interno**. "Zero 2.0" only appears where it genuinely means the starter it was forked from.

## When to write an ADR
A significant, hard-to-reverse architectural choice (a new subsystem, a cross-cutting pattern, swapping a core mechanism). Not for routine features.

## ⚠️ SYNC RULE (the core of this skill)
Documentation is part of "done". On ANY change to an endpoint, model, middleware, capability, manifest, socket event, service or config:
1. Update the affected `docs/` page(s) in the same change.
2. Update the OpenAPI spec if the endpoints changed.
3. Update the e2e tests.
4. Add an ADR if it's a significant decision.
5. Update the `sistema-interno-*` skills if a convention changed.
Treat a stale doc as a bug.
