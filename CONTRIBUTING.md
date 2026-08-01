# Contributing to PMOS

Thanks for your interest in contributing! This is a **backend monorepo** built by an
autonomous build agent (`AGENT.md`), so before diving in, please read the project
conventions — they are strict and enforced.

## Ground rules

- **Language:** commit messages and docs are in Russian by convention (historical);
  code identifiers in English. Issues/PRs can be in English or Russian.
- **No `as any`, `@ts-ignore`, `@ts-expect-error`** — TypeScript is strict, type errors
  are fixed properly or not at all.
- **No "memo" comments** — comment only non-trivial invariants (races, idempotency
  guards). A lint hook enforces this.
- **Fix minimally** — do not refactor while fixing a bug.
- **Match existing patterns** — the repo is disciplined; if you see a pattern in
  `notes`/`tasks`/`calendar`, follow it.

## How to set up locally

```bash
pnpm install
docker compose -f platform/docker/docker-compose.yml --profile core up -d   # Postgres + NATS
# migrations per service:
#   DATABASE_URL=postgres://pmos:pmos@localhost:5432/pmos DATABASE_SCHEMA=<svc>_ \
#     pnpm --filter @pmos/<svc> run db:migrate
```

See `docs/DEV_GUIDE.md` for the full local development guide.

## Before you start

1. **Check the docs first.** `docs/ADR/ADR-007.md` is the *canonical* conventions doc
   and wins on conflict. `docs/FEATURES.md` lists what's done (✅) and planned (📋).
   `docs/SAGA.md` describes the cross-service scenarios.
2. **Search existing issues/PRs** to avoid duplication.
3. **Open an issue** describing what you want to change and why, especially for
   architecture changes or new services.

## Making changes

### Service internals

- Each service lives in `services/<name>/` with a uniform template (see `README.md`).
- **CRUD routes and `emit()` events are generated** (`scripts/gen-routes.mjs`) —
  do NOT hand-edit generated route blocks for the 13 non-reference services.
- **Business logic** is added via `scripts/gen-semantics.mjs <svc>` for generated
  services, or hand-written for the reference implementations
  (`notes`, `tasks`, `calendar` — edit `src/routes/index.ts` directly).

### Commits

Follow the repo's commit style (Conventional Commits, Russian descriptions):

```
feat(notes,tasks): полное покрытие 2.1 — поиск/сортировка/AI-заголовок, …
fix(db): search_path через startup-параметр на всех соединениях пула
docs: отразить фактическое состояние — 5 саг, 90/90 integration, матрица статусов
chore: remove stray debug script
```

- Keep commits atomic and focused.
- Do not include secrets or debug scripts.
- Do not force-push shared branches.

### Pull requests

1. Fork the repo (or work on a feature branch).
2. Implement your change **with tests**:
   - unit tests: `test/*.test.ts` (vitest, no DB)
   - contract tests: OpenAPI-conformance (auto-generated)
   - integration tests: `test/integration.*.test.ts` — need real Postgres + NATS
     (see `docs/DEV_GUIDE.md` for env vars)
3. Verify locally before pushing:

```bash
pnpm -r run typecheck          # strict TS
pnpm --filter "./services/*" run test           # unit
pnpm --filter "./services/*" run test:contract  # OpenAPI-conformance
pnpm --filter "./services/*" run build          # tsc → dist
```

   For integration: `DATABASE_URL=… DATABASE_SCHEMA=<svc>_ NATS_URL=… npx vitest run test/integration`
   (run inside `services/<svc>/`).
4. Open a PR against `main` with a clear description: what changed, why, and the
   verification results. CI runs typecheck + unit + contract automatically.
5. If the change touches service surface (routes/events/contracts), **update**:
   - `contracts/openapi/<svc>.yaml`
   - `contracts/asyncapi/events.yaml` (`x-implemented-wire-events`)
   - `docs/FEATURES.md` (✅/📋), `docs/REVIEW.md` status matrix
   - `README.md` (and mirror the changes into `README.ru.md`)

## Review process

- PRs are reviewed by the maintainers; the autonomous build agent may also run
  `docs/REVIEW.md` checks against your change.
- Be ready to respond to review comments; keep the conversation constructive per
  [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Reporting bugs & security

- Bugs: open an issue with steps to reproduce, expected vs actual behavior, and
  environment (Node version, Postgres/NATS versions).
- Security vulnerabilities: **do not open a public issue** — see
  [SECURITY.md](SECURITY.md).

Thank you for contributing!
