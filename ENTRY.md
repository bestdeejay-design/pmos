# ENTRY.md — Точка входа в PMOS (Personal OS, backend monorepo)

> **Начни здесь.** Этот файл — маршрутная карта и быстрый онбординг. Все остальные документы
> детализируют конкретную область; здесь — обзор, навигация, control-flow репозитория и чек-листы.
>
> Версии: [English](README.md) · [Русский](README.ru.md)
> ⚠️ **Язык кода и коммитов — русский** (сообщения conventional, например `feat(notes): …`, `fix(contracts): …`).
> Интерфейсные/утилитные доки — EN/RU зеркала.

---

## 1. Что это

PMOS («Personal Management Operating System») — личная операционка: единое хранилище заметок,
задач, календаря, проектов, файлов, профилей и AI-ассистента, связанных асинхронной шиной событий.

**Статус:** все 16 сервисов реализованы и проверены (CRUD + бизнес-логика + события поверх
NATS JetStream). 5 сквозных саг из `docs/SAGA.md` работают и покрыты интеграционными тестами
против реального Postgres + NATS. Проверки: typecheck 18/18, contract 16/16, unit + integration 90/90.

Технологии: **Node 22 + pnpm 10** (workspaces) · **TypeScript 5.5 strict** · **Fastify 5 + TypeBox** ·
**PostgreSQL 16** (schema-per-service, ADR-004) · **NATS 2.10 JetStream** · **Drizzle ORM** · **Vitest**.

---

## 2. Навигация (что за что отвечает)

| Каталог/файл | Это правда | Что здесь |
|--------------|-----------|-----------|
| `contracts/openapi/*.yaml` | **машинная истина по HTTP** | OpenAPI-спеки, conformance-тесты 16/16 |
| `contracts/asyncapi/events.yaml` | **машинная истина по событиям** | каталог событий; `x-implemented-wire-events` = фактически публикуемые |
| `services/<name>/` | реализация | 16 микросервисов по единому шаблону (см. `README.md`, раздел Service template) |
| `platform/shared-types` | `@pmos/shared` | EventEnvelope, DTO, типизированные ошибки |
| `platform/event-bus` | `@pmos/event-bus` | NATS JetStream publisher/subscriber, DLQ, идемпотентность |
| `scripts/` | генераторы | scaffold, gen-openapi, gen-schemas, gen-routes, gen-semantics, gen-contract-tests |
| `docs/` | проектная документация | ARCHITECTURE, FEATURES, SAGA, REVIEW, TEST_CASES, BACKLOG, DEV_GUIDE, ADR-001..007 |
| `AGENT.md` | runbook для автономной сборки | фазы, правила, определения готовности, `§4.1` — закрытие фичи end-to-end |
| `DELIVERY.md` | delivery-gate | как запустить, что сделано, ограничения |

**Иерархия источников правды при конфликтах** (ADR-007 §6):
`contracts` > `@pmos/shared` > ADR-001..006 > FEATURES/SAGA > проза. Подробная таблица разрешённых
противоречий — в ADR-007 §5.

---

## 3. Быстрый старт (локально)

```bash
# 1. Зависимости всех воркспейсов
pnpm install

# 2. Инфраструктура (Postgres + NATS)
docker compose -f platform/docker/docker-compose.yml --profile core up -d

# 3. Миграции всех схем (нужен Postgres)
pnpm --filter "./services/*" run db:migrate

# 4. Один сервис (пример notes)
DATABASE_URL=postgres://pmos:***@localhost:5432/pmos \
DATABASE_SCHEMA=notes_ NATS_URL=nats://localhost:4222 \
PORT=3001 SERVICE_NAME=notes pnpm --filter @pmos/notes start

# 5. Проверка health
curl http://localhost:3001/api/notes/v1/health-check
# → {"ok":true,"db":true,"nats":true,"uptime":42}
```

Полный стек: `docker compose -f platform/docker/docker-compose.yml --profile all up -d`
(gateway `http://localhost:8080`, health `http://localhost:8080/api/health`).
Расширенный гайд и полная таблица env — в `docs/DEV_GUIDE.md`.

---

## 4. Как устроен сервис (единый шаблон)

Каждый из 16 сервисов:

```
services/<name>/
├── src/
│   ├── index.ts          entry point: buildApp() + NATS + shutdown
│   ├── app.ts            Fastify (роуты монтируются в /api/<name>/v1)
│   ├── db/               connection (search_path), schema (Drizzle), migrate
│   ├── events/           publish.ts (emit) + subscribe.ts (саги, идемпотентность)
│   ├── lib/              бизнес-логика (llm, imap, zip, …)
│   ├── plugins/          correlationId, health, metrics
│   └── routes/index.ts   Fastify + TypeBox (typed.get/post/patch/delete)
├── migrations/           *.sql + meta/_journal.json (drizzle-kit)
└── test/                 health / contract / integration.{spec}.test.ts
```

**Критично для Fastify (частая ошибка):** параметры пути в коде — только `:id` (с двоеточием),
контракт использует `{id}` (конвенция OpenAPI). `typed.get("/x/{id}")` ломает роут в рантайме.
Гард `hasRoute()` в contract-тесте ловит этот класс багов. См. `AGENT.md §4` (note) и `ADR-007 §8`.

---

## 5. Процесс работы (основные правила)

- **Contract-first (ADR-007 §8 R4):** каждый эндпоинт обязан существовать в
  `contracts/openapi/<svc>.yaml`. Не придумывать роуты вне контракта.
- **Контракты — машинная правда:** перед изменением поведения — сперва контракт, потом код.
- **События (ADR-007 §3, events.yaml):** формат `pmos.<svc>.<resource>.<action>`
  (`created|updated|deleted`), stream `TSSRUP`, subject `pmos.>`. Payload camelCase, обязательный `version`.
  `x-implemented-wire-events` = **только фактически публикуемое** (см. `docs/REVIEW.md §3` — каталог не место для wishlist'а).
- **Закрытие фичи end-to-end (📋 → ✅):** полный чек-лист — `AGENT.md §4.1`
  (контракт → каталог → схема → миграция → роуты → события → тесты → счётчики доков → commit-gate).
- **БД-ценности (ADR-004):** каждая схема изолирована (`<svc>_`), читать чужие схемы запрещено.
- **Типизация (ADR-007 §7):** никаких `any`, `@ts-ignore`, `as unknown as X`; timestamps —
  `new Date().toISOString()`, не `new Date()`.

---

## 6. Определение готовности (Definition of Done)

Сервис/фича «сделано», когда зелёное всё из `AGENT.md §5` (Delivery Gate): typecheck 18/18,
build 16/16, contract 16/16, unit+integration 90/90, саги §1–§5, компоуз up без падений,
Custom Repo Hygiene, REVIEW §5 актуальна. Commit-gate (быстрый) — `AGENT.md §7.1`.

---

## 7. Чек-лист для нового разработчика (первый рабочий день)

- [ ] Прочитать: [ENTRY.md](ENTRY.md) → [ARCHITECTURE.md](docs/ARCHITECTURE.md) → [DEV_GUIDE.md](docs/DEV_GUIDE.md)
- [ ] Пробежать: [ADR-007](docs/ADR/ADR-007.md) (канонические конвенции) + [AGENT.md](AGENT.md) §§4–7
- [ ] Поднять стек: `pnpm install` + `docker compose --profile core up -d` + миграции
- [ ] Запустить 1 сервис (например notes) и проверить health
- [ ] Прочитать один контракт (`contracts/openapi/notes.yaml`) и один сервис (`services/notes/src/routes/index.ts`)
- [ ] Прогнать полный набор проверок на чистом клоне — `pnpm -r run typecheck && pnpm --filter "./services/*" test` + `test:contract`
- [ ] Найти первую сверционную задачу: `docs/BACKLOG.md` (приоритет P1/P2)

---

## 8. Куда дальше читать

| Тема | Документ |
|------|----------|
| Архитектура (сервисы, потоки данных) | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Каталог функций (✅87 / 📋16) | [FEATURES.md](docs/FEATURES.md) |
| Саги/сценарии между сервисами | [SAGA.md](docs/SAGA.md) |
| Статусы по сервисам (RESOLVED) | [REVIEW.md](docs/REVIEW.md) |
| Тест-кейсы (Gherkin, 16 сервисов) | [TEST_CASES.md](docs/TEST_CASES.md) |
| План работ / бэклог | [BACKLOG.md](docs/BACKLOG.md) |
| Локальный запуск, переменные, отладка | [DEV_GUIDE.md](docs/DEV_GUIDE.md) |
| Архитектурные решения (ADR-001..007) | [ADR](docs/ADR/) |
| Правила контрибьютинга / сообщества | [CONTRIBUTING.md](CONTRIBUTING.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) · [SECURITY.md](SECURITY.md) |
| Лицензия | [LICENSE](LICENSE) |