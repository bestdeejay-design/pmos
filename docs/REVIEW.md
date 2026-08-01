# REVIEW.md — Аудит документации ЦУП (консистентность / системность / достаточность)

> Статус: **RESOLVED** (после применения ADR-007 + генерации каркаса).
> Этот файл — сводка аудита, проведённого перед передачей проекта строящему AI-агенту.

## 1. Что было найдено (исходные проблемы)

| # | Категория | Проблема | Влияние на агента |
|---|-----------|----------|-------------------|
| 1 | Неполнота | Нет корня монорепозитория (`package.json`, `pnpm-workspace.yaml`) | `pnpm install`/`pnpm dev` падали сразу |
| 2 | Неполнота | `services/` — 16 пустых каталогов, кода нет | Агент не с чего начать |
| 3 | Неполнота | `platform/` пуста (нет event-bus, shared-types, docker) | DEV_GUIDE ссылался на несуществующее |
| 4 | Неполнота | `tests/` пуст, контрактов Pact нет | ADR-002 невыполним |
| 5 | Противоречие | «Express» (ARCH, BACKLOG) vs «Fastify» (template, DEV_GUIDE) | Агент выбрал бы неверный фреймворк |
| 6 | Противоречие | API `/api/notes` vs `/api/notes/v1` (OpenAPI) | Роуты не совпали бы с gateway |
| 7 | Противоречие | Event envelope без `version` (ARCH) vs с `version` (ADR-003) | Контракт-тест провалился бы |
| 8 | Противоречие | `data.body_md` (AsyncAPI) vs `data.bodyMd` (OpenAPI) | Смешанный стиль в одном каталоге |
| 9 | Противоречие | Profile: `{id,name,color,is_default,hidden}` (FEATURES) vs required `{id,name,color}` (OpenAPI) | Бизнес-правило удаления default не реализуемо |
| 10 | Противоречие | Rate limit `100r/m` (проза ADR-001) vs `100r/s` (листинг) | Конфликт значений |
| 11 | Противоречие | Контракты в `tests/contract/` (доки) vs реально `contracts/` | Агент пошёл бы по сломанной ссылке |
| 12 | Противоречие | «npm workspaces» (BACKLOG) vs «pnpm» (DEV_GUIDE) | Команда установки не работала бы |
| 13 | Противоречие | FEATURES: event-bus/shared-types «📋 planned» vs нужны как фундамент | Фазы перепутаны |

## 2. Что сделано (резолюция)

1. **ADR-007** — канонические конвенции + иерархия источников + таблица resolved conflicts (C1–C9).
   Любое противоречие теперь однозначно разрешается ADR-007 §2/§3/§4/§5.
2. **AGENT.md** (корень) — runbook: фазы (0–6), gates, Definition of Done, правила конфликтов.
3. **Инфраструктура создана:**
   - `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json` + `.npmrc` + `.gitignore`
   - `platform/shared-types` (`@pmos/shared`) — единые типы EventEnvelope, сущностей, ApiError
   - `platform/event-bus` (`@pmos/event-bus`) — NATS JetStream SDK (publish/subscribe/requestReply)
   - `platform/docker/docker-compose.yml` + `nginx.conf` с профилями core/phase1-4/all/monitoring
4. **16 сервисов сгенерированы** (`scripts/scaffold-services.mjs`) — каждый с рабочим Fastify-каркасом:
   `src/{index,app,routes,lib/errors,plugins/*,db/*,events/*}`, `test/health.test.ts`,
   `Dockerfile`, `.env.example`, `tsconfig.json`, `vitest.config.ts`, `migrations/0001_init.sql`.
5. **Доки исправлены:** ARCHITECTURE (Fastify, пути /v1, envelope+version, навигация), ADR-001
   (rate limit r/s→r/m), BACKLOG (pnpm, Fastify, фундамент), DEV_GUIDE/FEATURES (ссылки на contracts/).
6. **CI** добавлен (`.github/workflows/ci.yml` по ADR-002).

## 3. Остаточные риски (для строящего агента, не блокируют старт)

- `TEST_CASES.md` покрывает 6 из 16 сервисов — остальные дописываются по ходу.
- Frontend (React SPA) и desktop (Tauri) — вне backend-DoD; агент фокусируется на бэкенде.
- Роуты (`src/routes/index.ts`) пока stub (только `/health-check`) — агент реализует их по
  OpenAPI-контрактам; схемы БД и типы уже готовы как образец.

> **Устранено (commit `e44442b` + последующий):** OpenAPI-контракты теперь для **всех 16** сервисов
> (генератор `scripts/gen-openapi.mjs`), Drizzle-схемы — полные для **всех 16** сервисов
> (`scripts/gen-schemas.mjs`, таблицы по ADR-004/FEATURES, включая pgvector для search-rag).
> Также: роуты реализованы для всех 16 (`scripts/gen-routes.mjs`); legacy `template-service`
> удалён (заменён генераторами в `scripts/`); `event-bus`/`shared-types` — готовы и собираются в CI.
> **Contract-тесты внедрены** (`scripts/gen-contract-tests.mjs` + `contracts/test/helper.ts`):
> OpenAPI-conformance для всех 16 сервисов, шагают в CI (`test:contract`). В процессе выявлен
> и исправлен дефект — 11/16 OpenAPI имели дублирующиеся ключи в `properties` (починено в
> `gen-openapi.mjs`). Pact-брокер (consumer-driven) — отдельная инфра-задача (ADR-002 §3 TODO).

## 4. Чек-лист готовности к автономной сборке

- [x] Единые конвенции зафиксированы (ADR-007) и не противоречат контрактам
- [x] Корень монорепо существует и поддерживает `pnpm install` / `pnpm -r`
- [x] `@pmos/shared` + `@pmos/event-bus` собираются
- [x] 16 сервисов имеют тип-checking каркас + health/test
- [x] **OpenAPI-контракты для всех 16 сервисов** (16/16 валидны, parse-checked)
- [x] **Drizzle-схемы для всех 16 сервисов** (typecheck 18/18 Done, тесты 16×2 green)
- [x] **Роуты (CRUD + сервисные эндпоинты) для всех 16 сервисов**
- [x] **Contract-тесты (OpenAPI-conformance) для всех 16 сервисов** (CI `test:contract`, 16/16 green)
- [x] **Миграции БД для всех 16 сервисов** (`migrations/0001_init.sql`, сгенерированы из Drizzle-схем через `drizzle-kit generate`; search-rag содержит `CREATE EXTENSION vector`)
- [x] **Шина событий подключена к роутам** (`@pmos/event-bus`): CRUD мутации публикуют `pmos.<svc>.<resource>.(created|updated|deleted)`; `app.ts` делает best-effort `connect()`+`ensureStream()` при старте
- [x] docker-compose поднимает инфру + gateway
- [x] Runbook (AGENT.md) описывает путь до сдачи без участия человека

## 5. Матрица статусов реализации по сервисам (для строящего агента)

> Легенда: ✅ = реализовано и проверено (integration/contract); 🟡 = базовый CRUD-паттерн
> (генератор `gen-semantics.mjs`), бизнес-логика 📋; 📋 = не реализовано.
> Источник правды по эндпоинтам — `contracts/openapi/<svc>.yaml` + `FEATURES.md`.

| Сервис | CRUD | Фильтры | Soft-delete | События | Бизнес-логика (📋 из FEATURES) | Reference impl |
|---------|------|---------|-------------|---------|--------------------------------|----------------|
| **profiles** | ✅ | — | — | ✅ | ✅ is_default/hidden, защита удаления default, уникальность имени | сгенерирован + семантика |
| **settings** | ✅ | — | — | ✅ | ✅ KV CRUD + `/ollama-models` | сгенерирован + семантика |
| **notes** | ✅ | ✅ profileId/tag/isArchived/**q ILIKE** | ✅ | ✅ | ✅ CRUD+шаблоны+архив+**ручная сортировка(PUT /notes/order)**+**generate-title**+**Сага §1: notes.created → ai-gateway → title_generated → notes** | **ручной эталон** |
| **tasks** | ✅ | ✅ projectId/status/profileId | ✅ | ✅ | ✅ streaks+приоритеты+фильтры+**валидация Kanban-статуса**+**блокировка зависимостей(409)**+**рекурренс-порождение**+**/tasks/:id/dependencies**; 📋 dashboard-сводка внешних сущностей | **ручной эталон** |
| **calendar** | ✅ | ✅ profileId/from/to | ✅ | ✅ | ✅ CRUD+диапазон+ICS экспорт (RFC5545)+**Сага §4: external_events.created → встреча (recurrence, link)**; 📋 напоминания WS, конфликты | **ручной эталон** |
| **projects** | ✅ | ✅ profileId | — | ✅ | ✅ dashboard (items), gantt, drag-reschedule | сгенерирован + семантика |
| **files** | ✅ | ✅ profileId/owner | — | ✅ | ✅ извлечение текста (txt/md/PDF/docx)+**Сага §3: uploaded → text_extracted → search-rag** | сгенерирован + семантика |
| **search-rag** | — (нет CRUD) | — | — | ✅ подписки | ✅ `/search` + ILIKE + Ollama embedding + pgvector + **Сага §3: подписка на text_extracted/notes.created** | сгенерирован (stub) + семантика |
| **ai-gateway** | — (stateless) | — | — | ✅ | ✅ fallback chain, dictation-парсинг, restore-punctuation, timeout+**Сага §1: подписка на notes.created, генерация заголовка** | сгенерирован (stub) + семантика |
| **agent** | ✅ | ✅ | — | ✅ | ✅ триггеры (deadline_soon, task_no_assignee)+**Сага §2: tasks.status_changed → trigger → suggestion**+inbox+today/week; 📋 дайджесты, DND, лимиты, WS | сгенерирован + семантика |
| **email** | ✅ | ✅ | — | ✅ | ✅ IMAP-аккаунты (шифр), синхронизация, конвертация→note/task | сгенерирован + семантика |
| **external-calendars** | ✅ | — | — | ✅ | ✅ CalDAV Yandex, ICS-подписки, sync, link+**Сага §4: external_events.created публикация**; 📋 OAuth Google | сгенерирован + семантика |
| **integrations** | ✅ | — | — | ✅ | ✅ webhook delivery+retry/DLQ, api-keys+**Сага §5: webhook-доставка событий**; 📋 public API v1 | сгенерирован + семантика |
| **time-tracking** | ✅ | ✅ | — | — | ✅ timesheet stats, pomodoro (3 режима) | сгенерирован + семантика |
| **export-import** | — | — | — | — | ✅ ZIP-экспорт, импорт текста/JSON | сгенерирован (stub) + семантика |
| **sync** | ✅ | — | — | — | ✅ CRUD папок, scan, auto-import/export .md | сгенерирован + семантика |

**Что уже доказано (не надо переделывать):** каркас (DB+NATS+роуты) жив; 3 ручных эталона
(notes/tasks/calendar) проходят integration против реального Postgres; 13 сервисов
с реализованной семантикой проходят integration против реального Postgres+NATS
(90/90 интеграционных тестов, включая 5 cross-service саг из `SAGA.md` §1–§5).
Риск наследования бага `{id}` исключён через `hasRoute()`-гард в contract-тестах.

**Где агент НЕ должен трогать генераторы:** `notes`/`tasks`/`calendar` — только ручное
редактирование `src/routes/index.ts`. Остальные 13 — править через `gen-semantics.mjs <svc>`
(НЕ `gen-routes.mjs`, см. ADR-007 §8 R2).
