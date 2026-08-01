# ЦУП (Personal OS) — backend monorepo

> **🌐 Версии:** [English](README.md) · [Русский](README.ru.md) · [Сайт (GitHub Pages)](https://bestdeejay-design.github.io/pmos/)

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
pmos/
├── AGENT.md                        Runbook для автономного агента-сборщика
├── DELIVERY.md                     Delivery Gate: запуск, что реализовано, тесты, ограничения
├── README.md                       ← вы здесь
├── package.json                    root scripts: typecheck/test/build/db:migrate
├── pnpm-workspace.yaml             workspaces: services/*, platform/*
│
├── platform/                       общая инфраструктура
│   ├── shared-types/               @pmos/shared — EventEnvelope, доменные типы, DTO
│   ├── event-bus/                  @pmos/event-bus — NATS JetStream publisher/consumer (durable, DLQ)
│   └── docker/
│       ├── docker-compose.yml      профили: core (Postgres+NATS) / all (16 сервисов + gateway)
│       └── nginx.conf              api-gateway (reverse-proxy на все сервисы)
│
├── services/                       16 микросервисов, единый шаблон (см. ниже)
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
│   └── sync/               3016  sync_
│
├── contracts/                      машинная правда (что реально в коде)
│   ├── openapi/                    16 × <svc>.yaml — OpenAPI-спеки, conformance 16/16
│   ├── asyncapi/
│   │   └── events.yaml              каталог событий (2 391 строка)
│   │                               x-implemented-wire-events = что реально публикуется
│   └── test/                        вспомогательные фикстуры контрактов
│
├── scripts/                         генераторы (воспроизводимость каркаса)
│   ├── scaffold-services.mjs        каркас нового сервиса
│   ├── gen-openapi.mjs              OpenAPI-спеки из контрактов
│   ├── gen-schemas.mjs              Drizzle-схемы
│   ├── gen-routes.mjs               CRUD-роуты + emit() событий
│   ├── gen-semantics.mjs            ручная семантика поверх CRUD (править так, НЕ gen-routes)
│   └── gen-contract-tests.mjs       OpenAPI-conformance тесты
│
├── docs/                            архитектурная и проектная документация
│   ├── ARCHITECTURE.md              общая архитектура
│   ├── FEATURES.md                  функциональные требования (✅ 85 / 📋 18)
│   ├── SAGA.md                      cross-service сценарии (§1–§5)
│   ├── REVIEW.md                    статус-матрица по сервисам
│   ├── TEST_CASES.md                тест-кейсы
│   ├── BACKLOG.md                   бэклог
│   ├── DEV_GUIDE.md                 локальная разработка
│   └── ADR/
│       ├── ADR-001.md … ADR-007.md  архитектурные решения
│
├── template-service/               выключен из сборки (артефакт скраффолда)
└── tests/                           зарезервировано под E2E (сейчас пусто; E2E заменён
                                    integration-тестами сервисов — 90/90)
```

### Шаблон сервиса (`services/<name>/`)

Все 16 сервисов идентичны по структуре:

```
services/<name>/
├── src/
│   ├── index.ts              точка входа: buildApp() + NATS + shutdown
│   ├── app.ts                Fastify-приложение (роуты, плагины, health)
│   ├── db/
│   │   ├── connection.ts     postgres.js + drizzle, search_path через startup-параметр
│   │   ├── schema.ts         Drizzle-схема таблиц
│   │   └── migrate.ts        применение миграций (drizzle-kit)
│   ├── events/
│   │   ├── publish.ts        обёртка публикации событий (emit)
│   │   └── subscribe.ts      обработчики подписок (саги, idempotency)
│   ├── lib/                  семантика: бизнес-логика (llm.ts, imap.ts, zip.ts, …)
│   ├── plugins/              correlationId, health, metrics
│   └── routes/index.ts       Fastify + TypeBox-роуты (typed.get/post/…)
├── migrations/               *.sql + meta/_journal.json (drizzle-kit)
├── test/
│   ├── health.test.ts        unit: health-check
│   ├── contract.test.ts      unit: OpenAPI-conformance
│   └── integration.*.test.ts integration: реальные Postgres + NATS (с сагами)
├── Dockerfile, drizzle.config.ts, tsconfig.json, vitest.config.ts, package.json
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

Полный каталог — общий объём **~4 700 строк доков + ~9 900 строк контрактов ≈ 14 600 строк**:

### Проектная документация (docs/)

| Файл | Строк | Назначение |
|------|------:|------------|
| `docs/ARCHITECTURE.md` | 183 | Общая архитектура: сервисы, шина, потоки данных |
| `docs/FEATURES.md` | 477 | Функциональные требования по каждому сервису (✅ 85 реализовано / 📋 18 план) |
| `docs/SAGA.md` | 426 | 5 cross-service сценариев (§1–§5): события, idempotency, проверка |
| `docs/REVIEW.md` | 106 | Статус-матрица: CRUD / фильтры / soft-delete / события / бизнес-логика |
| `docs/TEST_CASES.md` | 1,420 | Gherkin-тест-кейсы для **всех 16 сервисов** + саги + инфраструктура |
| `docs/BACKLOG.md` | 77 | Бэклог: идеи, отложенные фичи, UI-слой |
| `docs/DEV_GUIDE.md` | 525 | Локальная разработка: env, запуск, отладка, генераторы |

### ADR — архитектурные решения (docs/ADR/)

| Файл | Строк | Решение |
|------|------:|---------|
| `ADR-001.md` | 144 | Монорепо + pnpm workspaces, schema-per-service |
| `ADR-002.md` | 177 | NATS JetStream как шина событий (at-least-once) |
| `ADR-003.md` | 92 | Fastify + TypeBox (типизированные роуты, OpenAPI) |
| `ADR-004.md` | 67 | Изоляция схем в Postgres (search_path на соединении) |
| `ADR-005.md` | 131 | Контракты OpenAPI как источник правды + conformance-тесты |
| `ADR-006.md` | 170 | Drizzle ORM + миграции, воспроизводимость |
| `ADR-007.md` | 233 | **Канонические конвенции** (переименование tsrup→pmos, camelCase, версии EventEnvelope) — при конфликте с другими доками переименовывает их |

### Runbook и гейты

| Файл | Строк | Назначение |
|------|------:|------------|
| `AGENT.md` | 235 | Главный runbook автономного агента-сборщика (фазы, гейты §5) |
| `DELIVERY.md` | 59 | Delivery Gate: как запустить, что реализовано, ограничения |
| `README.md` | 232 | ← этот файл |

### Контракты (машинная правда)

| Файл | Строк | Назначение |
|------|------:|------------|
| `contracts/openapi/*.yaml` (16 шт.) | 7 519 | OpenAPI-спеки сервисов — conformance 16/16 |
| `contracts/asyncapi/events.yaml` | 2 391 | Каталог событий шины + `x-implemented-wire-events` (реально шлётся) |

## Лицензия

MIT.
