# ЦУП (Personal OS) — backend monorepo

ЦУП («Центр Управления Полётами») — персональная операционная система: единое
хранилище заметок, задач, календаря, проектов, файлов, профилей и AI-ассистента,
связанных через асинхронную шину событий.

> **Статус:** все 16 сервисов реализованы и проверены (CRUD + семантика + события через
> NATS JetStream). 5 cross-service саг из `docs/SAGA.md` работают и покрыты интеграционными
> тестами против реального Postgres + NATS. Проверки: typecheck 18/18, contract 16/16,
> unit + integration 90/90 green.

## Стек

- **Node.js 22**, **pnpm 10+** (workspaces), **TypeScript** (strict).
- **Fastify 5** + **TypeBox** — HTTP, роуты монтируются на `/api/<svc>/v1`.
- **PostgreSQL 16** — schema-per-service изоляция (ADR-004).
- **NATS 2.10 JetStream** — шина событий (`@pmos/event-bus`), at-least-once.
- **Drizzle ORM** — схемы + миграции (`drizzle-kit`).
- **Vitest** — unit + contract (OpenAPI-conformance) тесты.
- **Docker / OrbStack** — инфра и сборка сервисов.

## Быстрый старт

```bash
# 1. Установка
pnpm install

# 2. Инфра (Postgres + NATS)
docker compose -f platform/docker/docker-compose.yml --profile core up -d

# 3. Миграции для всех сервисов (нужен Postgres)
pnpm --filter "./services/*" run db:migrate

# 4. Запуск одного сервиса локально
DATABASE_URL=postgres://pmos:***@localhost:5432/pmos \
DATABASE_SCHEMA=notes_ NATS_URL=nats://localhost:4222 \
PORT=3001 SERVICE_NAME=notes pnpm --filter @pmos/notes start

# 5. Health-check
curl http://localhost:3001/api/notes/v1/health-check
```

Полный стек (16 сервисов + gateway) поднимается профилем `all`:

```bash
docker compose -f platform/docker/docker-compose.yml --profile all up -d
# gateway: http://localhost:8080/api/health
```

## Структура репозитория

```
platform/
  shared-types/      @pmos/shared   — EventEnvelope, доменные типы
  event-bus/         @pmos/event-bus — NATS JetStream publisher/consumer
  docker/            docker-compose.yml, nginx.conf (api-gateway)
services/<name>/    16 сервисов (notes, tasks, calendar, …)
contracts/
  openapi/           OpenAPI-спеки (машинная правда, 16/16)
  asyncapi/events.yaml  Каталог событий (x-implemented-wire-events = что реально шлётся)
scripts/             Генераторы: scaffold-services, gen-openapi, gen-schemas,
                     gen-routes, gen-contract-tests (воспроизводимость)
docs/                ADR-001..007, ARCHITECTURE, FEATURES, SAGA, DEV_GUIDE, REVIEW, TEST_CASES
AGENT.md             Runbook для автономного агента-сборщика
```

Сервисы и порты (AGENT.md §4):

| Service | Port | Schema | Phase |
|---------|------|--------|-------|
| notes | 3001 | notes_ | 1 |
| tasks | 3002 | tasks_ | 1 |
| profiles | 3006 | profiles_ | 1 |
| settings | 3007 | settings_ | 1 |
| calendar | 3003 | calendar_ | 2 |
| projects | 3004 | projects_ | 2 |
| files | 3005 | files_ | 2 |
| search-rag | 3008 | search_rag_ | 2 |
| ai-gateway | 3009 | ai_gateway_ | 3 |
| agent | 3010 | agent_ | 3 |
| integrations | 3014 | integrations_ | 3 |
| export-import | 3015 | export_import_ | 3 |
| time-tracking | 3011 | time_tracking_ | 4 |
| email | 3012 | email_ | 4 |
| external-calendars | 3013 | external_calendars_ | 4 |
| sync | 3016 | sync_ | 4 |

## События (Event-Driven)

Каждый CRUD-мутации сервис публикует событие в NATS JetStream
(формат `pmos.<svc>.<resource>.<action>`, action ∈ `created|updated|deleted`),
stream `TSSRUP` (subject `pmos.>`). Пример: `pmos.notes.notes.created`.

Полный и актуальный список **реально публикуемых** subject'ов — в
`contracts/asyncapi/events.yaml` → `x-implemented-wire-events`. Кросс-сервисные цепочки
(саги) из `docs/SAGA.md` работают: генерация AI-заголовков заметок (§1), триггеры агента
по смене статуса задачи (§2), извлечение текста файлов и индексация (§3), импорт внешних
встреч в календарь (§4), доставка webhook'ов (§5).

## Проверки

```bash
pnpm -r run typecheck        # strict TS, 18 пакетов
pnpm --filter "./services/*" run test          # unit (vitest), без БД
pnpm --filter "./services/*" run test:contract  # OpenAPI-conformance, 16/16
pnpm --filter "./services/*" run build         # tsc → dist
```

CI (`.github/workflows/ci.yml`) гонит typecheck + unit + contract на каждый push.

## Документация

- `AGENT.md` — что и как собирает агент (главный runbook).
- `docs/ADR/ADR-007.md` — **канонические** конвенции (переименование tsrup→pmos,
  camelCase, версионирование EventEnvelope). Переименовывает все остальные доки при конфликте.
- `docs/FEATURES.md` — функциональные требования (✅ каркас / 📋 план).
- `docs/SAGA.md` — Cross-service сценарии.
- `docs/DEV_GUIDE.md` — локальная разработка.

## Лицензия

MIT.
