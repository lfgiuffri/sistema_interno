---
name: zero-docs
description: Maintain Zero 2.0 documentation (docs/, README.md, CLAUDE.md, ADRs, OpenAPI). Use when writing or updating any documentation, adding an ADR, or when code changes require doc updates. Enforces the doc structure, accuracy-to-code rule, ADR format, and the sync rule.
---

# Zero 2.0 — Documentation

Docs live in `docs/` and MUST reflect the actual code (no aspirational/stale docs).

## Structure
- `docs/README.md` — index linking everything.
- `docs/architecture/README.md` — multi-tenant, kernel vs modules, request flow, auto-discovery, response envelope.
- `docs/modules/README.md` — how to create a module (from the `items` template).
- `docs/api/README.md` — base URL, headers, envelope, pagination, OpenAPI/Scalar.
- Area guides: `auth.md`, `plans-billing.md`, `modularity.md`, `storage.md`, `realtime.md`, `webhooks.md`, `embeddings.md`, `vault.md`, `config-registry.md`.
- `docs/decisions/ADR-NNN-*.md` — architecture decisions.
- `docs/best-practices-guidelines.md` — the North Star (decisions + practices that govern the build).
- API reference is auto-generated: OpenAPI 3 at `/api/openapi.json`, rendered by Scalar at `/api/docs` (from `services/openapi/openapi.service.js`). Keep that spec in sync when endpoints change.

## Rules
- **Accuracy first**: read the code before writing; cite real file paths + endpoints. Verify port (3010), env var names (`backend/.env.example`), error codes (`upgrade_required`, `limit_reached`, `TOKEN_EXPIRED`).
- **Concise + skimmable** (tables, short examples). Spanish (es-AR), matching `best-practices-guidelines.md`.
- **ADR format**: `Status | Date | Context | Decision | Alternatives | Consequences`. New significant decision → new ADR (don't edit settled ones; supersede).
- Banner on architecture docs: "keep in sync with code".

## When to write an ADR
A new significant, hard-to-reverse architectural choice (new subsystem, new cross-cutting pattern, a swap of a core mechanism). Not for routine features.

## ⚠️ SYNC RULE (the core of this skill)
Documentation is part of "done". On ANY code change to an endpoint/model/middleware/capability/plan/manifest/event/config:
1. Update the affected `docs/` page(s) in the same change.
2. Update the OpenAPI spec if endpoints changed.
3. Add an ADR if it's a significant decision.
4. Update the `zero-*` skills if a convention changed.
Treat stale docs as a bug.
