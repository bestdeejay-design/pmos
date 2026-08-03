# PMOS — Personal OS (backend monorepo)

> **🌐 Versions:** [English](README.md) · [Русский](README.ru.md) · [Website (GitHub Pages)](https://bestdeejay-design.github.io/pmos/)

PMOS («Personal Management Operating System») — a personal operating system: a unified
store for notes, tasks, calendar, projects, files, profiles and an AI assistant, all
connected through an asynchronous event bus.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%20strict-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22-green)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)](https://www.postgresql.org/)
[![NATS](https://img.shields.io/badge/NATS-2.10_JetStream-27aae1)](https://nats.io/)
[![Tests](https://img.shields.io/badge/tests-90/90-green)](./services)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Status:** all 17 services are implemented and verified (16 CRUD + ops/DLQ panel).
> 5 cross-service sagas from `docs/SAGA.md` work and are covered by
> integration tests against real Postgres + NATS. Checks: typecheck 19/19, contract 17/17,
> unit + integration 90/90 green.

> **Try it:** the docs are also published as a static website — <https://bestdeejay-design.github.io/pmos/>

## Stack

- **Node.js 22**, **pnpm 10+** (workspaces), **TypeScript** (strict).
- **Fastify 5** + **TypeBox** — HTTP, routes mounted at `/api/<svc>/v1`.
- **PostgreSQL 16** — schema-per-service isolation (ADR-004).
- **NATS 2.10 JetStream** — event bus (`@pmos/event-bus`), at-least-once.
- **Drizzle ORM** — schemas + migrations (`drizzle-kit`).
- **Vitest** — unit + contract (OpenAPI-conformance) tests.
- **Docker / OrbStack** — infrastructure and service builds.

## Quick start

```bash
# 1. Install
pnpm install

# 2. Infrastructure (Postgres + NATS)
docker compose -f platform/docker/docker-compose.yml --profile core up -d

# 3. Migrations for all services (needs Postgres)
pnpm --filter "./services/*" run db:migrate

# 4. Run a single service locally
DATABASE_URL=postgres://pmos:***@localhost:5432/pmos \
DATABASE_SCHEMA=notes_ NATS_URL=nats://localhost:4222 \
PORT=3001 SERVICE_NAME=notes pnpm --filter @pmos/notes start

# 5. Health-check
curl http://localhost:3001/api/notes/v1/health-check
```

The full stack (17 services + gateway) starts with the `all` profile:

```bash
docker compose -f platform/docker/docker-compose.yml --profile all up -d
# gateway: http://localhost:8080/api/health
```

## Repository structure

```
pmos/
├── AGENT.md                        Runbook for the autonomous build agent
├── DELIVERY.md                     Delivery Gate: how to run, what's done, tests, limitations
├── ENTRY.md                        Entry point: navigation map + onboarding checklist for devs
├── README.md                       ← you are here (English)
├── README.ru.md                    Russian version of this README
├── package.json                    root scripts: typecheck/test/build/db:migrate
├── pnpm-workspace.yaml             workspaces: services/*, platform/*
│
├── platform/                       shared infrastructure
│   ├── shared-types/               @pmos/shared — EventEnvelope, domain types, DTOs
│   ├── event-bus/                  @pmos/event-bus — NATS JetStream publisher/consumer (durable, DLQ)
│   └── docker/
│       ├── docker-compose.yml      profiles: core (Postgres+NATS) / all (17 services + gateway)
│       └── nginx.conf              api-gateway (reverse proxy to all services)
│
├── services/                       17 microservices (16 CRUD + ops/DLQ panel)
│   ├── notes/              3001  notes_
│   ├── tasks/              3002  tasks_
│   ├── calendar/           3003  calendar_
│   ├── projects/           3004  projects_
│   ├── files/              3005  files_
│   ├── profiles/           3006  profiles_
│   ├── settings/           3007  settings_
│   ├── search-rag/         3008  search_rag_
│   ├── ai-gateway/         3009  ai_gateway_
│   ├── agent/              3010  agent_
│   ├── time-tracking/      3011  time_tracking_
│   ├── email/              3012  email_
│   ├── external-calendars/ 3013  external_calendars_
│   ├── integrations/       3014  integrations_
│   ├── export-import/      3015  export_import_
│   ├── sync/               3016  sync_
│   └── ops/                3017  — (stateless, DLQ panel, no DB)
│
├── contracts/                      machine truth (what actually ships)
│   ├── openapi/                    17 × <svc>.yaml — OpenAPI specs, conformance 17/17
│   ├── asyncapi/
│   │   └── events.yaml             event catalog (2,396 lines)
│   │                               x-implemented-wire-events = what is actually published
│   └── test/                        contract test fixtures
│
├── scripts/                         generators (scaffold reproducibility)
│   ├── scaffold-services.mjs       new service scaffold
│   ├── gen-openapi.mjs             OpenAPI specs from contracts
│   ├── gen-schemas.mjs             Drizzle schemas
│   ├── gen-routes.mjs              CRUD routes + emit() events
│   ├── gen-semantics.mjs           hand-written semantics on top of CRUD (edit this, NOT gen-routes)
│   └── gen-contract-tests.mjs      OpenAPI-conformance tests
│
├── docs/                            architecture & project documentation
│   ├── ARCHITECTURE.md             overall architecture
│   ├── FEATURES.md                 functional requirements (✅ 87 done / 📋 16 planned)
│   ├── SAGA.md                     cross-service scenarios (§1–§5 + §DLQ)
│   ├── REVIEW.md                   status matrix per service
│   ├── TEST_CASES.md               test cases
│   ├── BACKLOG.md                  backlog
│   ├── DEV_GUIDE.md                local development
│   └── ADR/
│       ├── ADR-001.md … ADR-007.md architecture decision records
│
├── template-service/               excluded from build (scaffold artifact)
└── tests/                           reserved for E2E (currently empty; E2E is replaced by
                                     service integration tests — 90/90)
```

### Service template (`services/<name>/`)

All 16 CRUD services share the same structure (`ops` is a stateless exception — no `db/`, no `migrations/`):

```
services/<name>/
├── src/
│   ├── index.ts              entry point: buildApp() + NATS + shutdown
│   ├── app.ts                Fastify app (routes, plugins, health)
│   ├── db/
│   │   ├── connection.ts     postgres.js + drizzle, search_path via startup parameter
│   │   ├── schema.ts         Drizzle table schema
│   │   └── migrate.ts        migrations (drizzle-kit)
│   ├── events/
│   │   ├── publish.ts        event publish wrapper (emit)
│   │   └── subscribe.ts      subscription handlers (sagas, idempotency)
│   ├── lib/                  business logic (llm.ts, imap.ts, zip.ts, …)
│   ├── plugins/              correlationId, health, metrics
│   └── routes/index.ts       Fastify + TypeBox routes (typed.get/post/…)
├── migrations/               *.sql + meta/_journal.json (drizzle-kit)
├── test/
│   ├── health.test.ts        unit: health-check
│   ├── contract.test.ts      unit: OpenAPI-conformance
│   └── integration.*.test.ts integration: real Postgres + NATS (incl. sagas)
├── Dockerfile, drizzle.config.ts, tsconfig.json, vitest.config.ts, package.json
```

## Events (Event-Driven)

Every CRUD service publishes an event to NATS JetStream
(format `pmos.<svc>.<resource>.<action>`, action ∈ `created|updated|deleted`),
stream `TSSRUP` (subject `pmos.>`). Example: `pmos.notes.notes.created`.

The full and current list of **actually published** subjects is in
`contracts/asyncapi/events.yaml` → `x-implemented-wire-events`. Cross-service chains
(sagas) from `docs/SAGA.md` are working: AI note-title generation (§1), agent triggers
on task status change (§2), file text extraction & indexing (§3), external calendar
import (§4), webhook delivery (§5). Public API mirror (`/api/v1/notes|tasks|projects|calendar` по API-ключам)
и авто-экспорт заметок в `.md` (sync auto-export по событиям `notes.*`) тоже работают.

## Checks

```bash
pnpm -r run typecheck        # strict TS, 19 packages
pnpm --filter "./services/*" run test          # unit (vitest), no DB
pnpm --filter "./services/*" run test:contract # OpenAPI-conformance, 17/17
pnpm --filter "./services/*" run build         # tsc → dist
```

CI (`.github/workflows/ci.yml`) runs typecheck + unit + contract on every push.

## Documentation

Full catalog — **~4,200 lines of docs + ~10,600 lines of contracts ≈ 14,800 lines**:

### Project docs (docs/)

| File | Lines | Purpose |
|------|------:|---------|
| `docs/ARCHITECTURE.md` | 183 | Overall architecture: services, bus, data flows |
| `docs/FEATURES.md` | 477 | Functional requirements per service (✅ 87 done / 📋 16 planned) |
| `docs/SAGA.md` | 426 | 5 cross-service scenarios (§1–§5): events, idempotency, verification |
| `docs/REVIEW.md` | 106 | Status matrix: CRUD / filters / soft-delete / events / business logic |
| `docs/TEST_CASES.md` | 1,420 | Gherkin test cases for **all 16 services** + sagas + infra |
| `docs/BACKLOG.md` | 77 | Backlog: ideas, deferred features, UI layer |
| `docs/DEV_GUIDE.md` | 525 | Local development: env, run, debugging, generators |

### ADR — Architecture Decision Records (docs/ADR/)

| File | Lines | Decision |
|------|------:|----------|
| `ADR-001.md` | 144 | Monorepo + pnpm workspaces, schema-per-service |
| `ADR-002.md` | 177 | NATS JetStream as the event bus (at-least-once) |
| `ADR-003.md` | 92 | Fastify + TypeBox (typed routes, OpenAPI) |
| `ADR-004.md` | 67 | Postgres schema isolation (search_path per connection) |
| `ADR-005.md` | 131 | OpenAPI contracts as source of truth + conformance tests |
| `ADR-006.md` | 170 | Drizzle ORM + migrations, reproducibility |
| `ADR-007.md` | 233 | **Canonical conventions** (tsrup→pmos rename, camelCase, EventEnvelope versioning) — overrides other docs on conflict |

### Runbooks & gates

| File | Lines | Purpose |
|------|------:|---------|
| `ENTRY.md` | — | Entry point: navigation map + onboarding checklist (start here) |
| `AGENT.md` | 235 | Main runbook for the autonomous build agent (phases, gates §5) |
| `DELIVERY.md` | 59 | Delivery Gate: how to run, what's done, limitations |
| `README.md` | — | ← this file |

### Contracts (machine truth)

| File | Lines | Purpose |
|------|------:|---------|
| `contracts/openapi/*.yaml` (17 files) | 7,991 | OpenAPI specs per service — conformance 17/17 |
| `contracts/asyncapi/events.yaml` | 2,396 | Event bus catalog + `x-implemented-wire-events` (what actually ships) |

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening issues or pull requests,
and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community guidelines.
Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © bestdeejay-design.
