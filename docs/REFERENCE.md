# REFERENCE.md — Единый справочник документации pmOS (Personal OS / ЦУП)

> **Назначение.** Это постоянная карта всей документации репозитория: структура каждого
> документа, ключевые факты, конвенции и связи между ними. Агент и разработчик обязаны
> **обращаться к этому файлу первым** при любой работе с документацией — это экономит контекст
> и не даёт данным «утекать» за рамки рабочей памяти.
>
> **Правило работы.** Перед чтением/правкой любого `.md` — сверься с его блоком в §3.
> Перед созданием нового документа — проверь, не покрывает ли тему существующий файл (§3)
> и добавь его карточку сюда.

---

## 1. Карта репозитория

```
pmos/
├── README.md            # EN-обзор, структура, статус (есть внутренние расхождения, см. §5)
├── README.ru.md         # RU-зеркало README (краткое; см. §5)
├── ENTRY.md             # Точка входа для агента: маршрутизация по документам
├── AGENT.md             # Runbook для автономного агента: правила, цикл, запуск, сдача
├── DELIVERY.md          # Что входит в поставку, как собирать/проверять, что НЕ входит
├── CONTRIBUTING.md      # Правила контрибуции (EN)
├── CODE_OF_CONDUCT.md   # Кодекс поведения (EN)
├── SECURITY.md          # Политика безопасности (EN)
│
├── docs/
│   ├── REFERENCE.md     # ★ ЭТОТ ФАЙЛ — карта документации
│   ├── ARCHITECTURE.md  # Общая схема, стек, событийная модель, саги, безопасность
│   ├── DEV_GUIDE.md     # Локальная разработка: установка, запуск, env, миграции, тесты
│   ├── FEATURES.md      # Каталог функций 19 сервисов + матрицы событий/данных
│   ├── BACKLOG.md       # Идеи, отложенные функции (UI P1, backend P2/P3, идеи P3)
│   ├── REVIEW.md        # Аудит документации: найденные проблемы, резолюции, чек-лист
│   ├── SAGA.md          # Хореографические сценарии с компенсацией (5 саг)
│   ├── TEST_CASES.md    # Gherkin-сценарии по сервисам + E2E + матрица покрытия
│   ├── IMPROVEMENTS.md  # Каталог проблем/расхождений по факту запуска + план доработок
│   └── ADR/
│       ├── ADR-001.md   # Монорепозиторий pnpm workspace
│       ├── ADR-002.md   # Стек: TypeScript, Fastify, Postgres, NATS (исторический)
│       ├── ADR-003.md   # Fastify (см. ADR-007)
│       ├── ADR-004.md   # Postgres schema isolation
│       ├── ADR-005.md   # OpenAPI-контракты (см. ADR-007)
│       ├── ADR-006.md   # События/шина (см. ADR-007)
│       └── ADR-007.md   # ★ КАНОН: единые конвенции (supersedes 002–006)
│
├── contracts/           # Источник истины по API (single source of truth)
│   ├── openapi/         # 17 YAML: agent, ai-gateway, calendar, email, export-import,
│   │                    #   external-calendars, files, integrations, notes, ops,
│   │                    #   profiles, projects, search-rag, settings, sync, tasks, time-tracking
│   ├── asyncapi/
│   │   └── events.yaml  # События шины (один файл)
│   └── test/
│       └── helper.ts    # Хелперы контракт-тестов
│
├── platform/
│   ├── docker/
│   │   ├── docker-compose.yml  # Инфраструктура + все сервисы (профили core/all/phase1–4/monitoring)
│   │   └── nginx.conf           # Единый вход /api-gateway: маршрутизация по префиксам
│   ├── event-bus/               # @pmos/event-bus (NATS JetStream)
│   └── shared-types/            # @pmos/shared (общие типы/валидация)
│
├── services/            # 17 backend-сервисов + frontend (см. таблицу §4)
├── scripts/             # Генераторы: gen-openapi, gen-routes, gen-schemas,
│                        #   gen-contract-tests, gen-semantics, scaffold-services
└── template-service/    # Шаблон для нового сервиса (легаси/эталон — см. §5)
```

---

## 2. Иерархия источников истины (канон ADR-007)

При любом конфликте утверждений действует приоритет сверху вниз:

1. **`docs/ADR/ADR-007.md`** — единые конвенции (supersedes ADR-002..006).
2. **`AGENT.md`** — операционные правила сборки/запуска.
3. **`contracts/`** (openapi + asyncapi) — точные API-контракты.
4. **Нарративные доки** (ARCHITECTURE, DEV_GUIDE, FEATURES, SAGA, TEST_CASES) — описания.
5. **`@pmos/shared`** — код общих типов (факт реализации).

> Расхождения между README/DELIVERY/FEATURES и фактом запуска — задокументированы в §5
> и подробно в `docs/IMPROVEMENTS.md`.

### Ключевые конвенции (выжимка ADR-007)

- **Стек**: TypeScript 5 strict, Fastify 5, Postgres 16 + Drizzle, NATS JetStream, pnpm.
- **Пути HTTP**: `/api/<service>/v1/...` (напр. `/api/profiles/v1/health-check`).
- **Ответы**: JSON; ошибки единым форматом `{ code, message, details? }`.
- **События**: envelope `{ id, type, version, source, time, data }`, `data` — camelCase,
  тип `pmos.<service>.<event>` (напр. `pmos.notes.created`).
- **Идемпотентность/саги**: хореография через шину; компенсации, DLQ, retry (SAGA.md).
- **Тестирование**: contract-first — контракты генерируются из `contracts/openapi`,
  тесты соответствия обязательны (commit gate).

---

## 3. Пофайловая карта документации

Формат карточки: **назначение → структура → ключевые факты → связи**.

### 3.1 Корневые документы

#### `README.md` (EN, ~500 строк)
- **Назначение**: обзор проекта, статус, структура, быстрый старт.
- **Структура**: заголовок → описание → фичи → структура репо → сервисы → скрипты → статус тестов → quick start → Docker → ссылки.
- **Ключевые факты**: 17 сервисов, контракты `contracts/openapi` (17), события `events.yaml` (~2400 строк), тесты (см. §5 — цифры противоречивы).
- **Связи**: EN-обзор; RU-зеркало `README.ru.md`; структура репо дублирует факт, но местами расходится (§5.1).

#### `README.ru.md` (RU, ~200 строк)
- **Назначение**: краткое RU-зеркало README.
- **Ключевые факты**: та же структура, но компактнее; фазы phase1–4; ссылки на доки.
- **Связи**: зеркало README.md; упоминает docs/, contracts/, services/.

#### `ENTRY.md`
- **Назначение**: точка входа для агента — маршрутизация «куда смотреть по теме».
- **Структура**: таблица тем → файл назначения (архитектура, события, тесты, контракты, runbook).
- **Связи**: ссылается на все корневые и docs/ документы.

#### `AGENT.md` (runbook, ~150+ строк)
- **Назначение**: правила автономного агента: иерархия источников, цикл сборки, запуск, тесты, сдача, ограничения.
- **Структура**: контекст → правила → фазы (phase1–5) → команды → чек-лист сдачи → «не делать».
- **Ключевые факты**: обязательные команды (`pnpm dev`, миграции, контракт-тесты); фазы phase1..phase5 (заметно: README.ru говорит phase4 — см. §5.4).
- **Связи**: подчинён ADR-007; ссылается на DELIVERY, TEST_CASES.

#### `DELIVERY.md`
- **Назначение**: что входит в поставку, как собирать/проверять, что НЕ входит.
- **Ключевые факты**: интеграционные тесты 90/90; **E2E (Playwright) НЕ входит в поставку** (противоречит README/AGENT — §5.3); упоминает пароль `pmos:pmos` (противоречит `***` в compose — §5.6).
- **Связи**: с AGENT.md, IMPROVEMENTS.md.

#### `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (EN)
- **Назначение**: стандартные GitHub-документы (контрибуция, кодекс, политика безопасности: supported versions, reporting, security-relevant areas).
- **Связи**: ссылки в README.

### 3.2 docs/ — внутренние документы

#### `docs/ARCHITECTURE.md`
- **Назначение**: общая схема, принципы коммуникации, стек, событийная модель, саги, безопасность.
- **Структура**: Общая схема → Принципы коммуникации (sync/async/запрещено) → Технологический стек → Событийная модель (EventEnvelope, гарантии доставки) → Cross-service саги → Безопасность → Навигация по репозиторию → Правила для разработчиков.
- **Ключевые факты**: стек Fastify/Postgres/NATS; EventEnvelope-структура; запрещён прямой вызов БД другого сервиса.
- **Связи**: источник для FEATURES/SAGA; уточнён ADR-007.

#### `docs/DEV_GUIDE.md`
- **Назначение**: настройка локального окружения.
- **Структура**: Prerequisites → Quick Start → Структура проекта/сервиса → Запуск отдельных сервисов → Переменные окружения → Добавление нового сервиса (10 шагов) → Управление БД/миграции → Отладка (логи, NATS, метрики) → Docker Compose Profiles → Тестирование (Pact/E2E — расхождение, §5.8).
- **Ключевые факты**: Node 22, pnpm, Docker/OrbStack; `pnpm dev`; порт по умолчанию `:3000` на сервис (в compose маппинг 3001–3017); профили core/phase1–4/monitoring.
- **Связи**: с compose, scripts/, TEST_CASES.

#### `docs/FEATURES.md`
- **Назначение**: полный каталог функций 19 разделов (17 сервисов + event-bus + shared-types).
- **Структура**: Видение → Список сервисов и функций (### 1..19) → Матрица событий → Матрица данных → Фронтенд.
- **Ключевые факты**: счётчики статусов в шапке: 103/5 (заявлено) vs 105 ✅ / 5 📋 (по факту строк-галочек; точный статус — REVIEW §4). Событие `settings.changed` в тексте — фактически в коде `pmos.settings.settings.{created,updated,deleted}` (§5.7).
- **Связи**: BACKLOG.md (отложенные 📋), TEST_CASES.md.

#### `docs/BACKLOG.md`
- **Назначение**: идеи и отложенные функции.
- **Структура**: 1. UI-слой frontend+desktop (P1) → 2. Отложенные функции backend (P2/P3, AI) → 3. Инфраструктура и качество (P2) → 4. Идеи (P3) → Сводка.
- **Ключевые факты**: UI — главный отложенный блок; P2/P3 — расширения.
- **Связи**: ссылается на FEATURES (📋).

#### `docs/REVIEW.md`
- **Назначение**: аудит документации (консистентность/системность/достаточность).
- **Структура**: 1. Найденные проблемы (12+) → 2. Что сделано (резолюции) → 3. Остаточные риски → 4. Чек-лист готовности → 5. Матрица статусов реализации по сервисам.
- **Ключевые факты**: статус **RESOLVED**; применены ADR-007 + генерация каркаса; остаточные риски не блокируют старт.
- **Связи**: IMPROVEMENTS.md (проблемы), ADR-007 (резолюции).

#### `docs/SAGA.md`
- **Назначение**: 5 хореографических саг с компенсацией.
- **Структура**: Общие соглашения → Сага 1 (Note Creation + AI Title) → 2 (Task Status → Agent) → 3 (File Upload → Embedding) → 4 (Calendar Sync External) → 5 (Webhook Delivery + Retry) → Матрица компенсаций → DLQ → Идемпотентность → Связанные ADR.
- **Ключевые факты**: событийный контракт для каждой саги; timeout'ы и retry в таблицах; DLQ-обработка.
- **Связи**: «Связанные ADR» ссылается на ADR-003/004/005 — **неверно** (реальные темы: 003=Fastify, 004=Postgres schema, 005=OpenAPI; событийная модель = 006/007) — §5.5.

#### `docs/TEST_CASES.md`
- **Назначение**: Gherkin-сценарии по сервисам (19 разделов) + E2E + матрица покрытия.
- **Структура**: §0 Anti-patterns (обязательные проверки) → §1–16 по сервисам → §17 Cross-service → §18 API Gateway/инфраструктура → §19 E2E (Playwright) → Приложение: Матрица покрытия → Связанные ADR.
- **Ключевые факты**: `{id}` vs `:id` Fastify path-param trap; `.toISOString()`; contract-first; E2E — 2 сценария (противоречит «10 tests» в README — §5.3).
- **Связи**: с contracts/openapi, scripts/gen-contract-tests.

#### `docs/IMPROVEMENTS.md`
- **Назначение**: каталог проблем/расхождений по факту запуска + приоритетный план доработок.
- **Структура**: 1. Хроника запуска → 2. Инфраструктура запуска (P1: pnpm workspace, nginx trailing slash, пароль `***`, nginx cache, миграции) → 3. Расхождения «документация vs факт» (структура, профили, env, nginx-префиксы) → 4. UI/Frontend (P1) → 5. Качество и тесты (E2E, contract, monorepo hygiene) → 6. Приоритетный план → 7. Связанные документы.
- **Ключевые факты**: основной источник расхождений §5 этого файла.
- **Связи**: REVIEW.md, README, DEV_GUIDE, compose.

### 3.3 ADR

| ADR | Тема | Статус |
|-----|------|--------|
| ADR-001 | Монорепозиторий pnpm workspace | действует |
| ADR-002 | Стек (TS/Fastify/Postgres/NATS) | **superseded by ADR-007** |
| ADR-003 | Fastify-сервисы | **superseded by ADR-007** |
| ADR-004 | Postgres schema isolation | **superseded by ADR-007** |
| ADR-005 | OpenAPI-контракты | **superseded by ADR-007** |
| ADR-006 | События/шина | **superseded by ADR-007** |
| ADR-007 | Единые конвенции (канон) | **активен, высший приоритет** |

---

## 4. Сервисы, порты и профили (по `platform/docker/docker-compose.yml`)

| # | Сервис | Порт (host) | Профиль | Контракт openapi |
|---|--------|:-----------:|---------|------------------|
| — | api-gateway (nginx) | 80 | all, phase1–4 | — (nginx.conf) |
| 1 | notes | 3001 | phase1, all | notes.yaml |
| 2 | tasks | 3002 | phase1, all | tasks.yaml |
| 3 | profiles | 3006 | phase1, all | profiles.yaml |
| 4 | settings | 3007 | phase1, all | settings.yaml |
| 5 | calendar | 3003 | phase2, all | calendar.yaml |
| 6 | projects | 3004 | phase2, all | projects.yaml |
| 7 | files | 3005 | phase2, all | files.yaml |
| 8 | search-rag | 3008 | phase2, all | search-rag.yaml |
| 9 | ai-gateway | 3009 | phase3, all | ai-gateway.yaml |
| 10 | agent | 3010 | phase3, all | agent.yaml |
| 11 | integrations | 3014 | phase3, all | integrations.yaml |
| 12 | export-import | 3015 | phase3, all | export-import.yaml |
| 13 | time-tracking | 3011 | phase4, all | time-tracking.yaml |
| 14 | email | 3012 | phase4, all | email.yaml |
| 15 | external-calendars | 3013 | phase4, all | external-calendars.yaml |
| 16 | sync | 3016 | phase4, all | sync.yaml |
| 17 | ops | 3017 | all | ops.yaml |
| — | frontend (SPA) | 5173 (dev) | — | — |

- **Профили compose**: `core` (postgres+nats), `all`, `phase1`…`phase4`, `monitoring` (prometheus+grafana).
- **Инфра**: postgres (5432), nats (4222), api-gateway (80).
- **Хранилища**: volume `pgdata`, `natsdata`.
- **Замечание**: маппинг портов НЕ соответствует порядку сервисов (calendar=3003, projects=3004, files=3005, profiles=3006, settings=3007 — «разброс» по фазам); номера закреплены в compose и env `PMSRV_PORT`.

---

## 5. Известные расхождения (документация vs факт) — контрольный список

> Полные детали и планы фиксов — в `docs/IMPROVEMENTS.md`; статусы аудита — в `docs/REVIEW.md`.

| # | Где | Расхождение | Кто прав (источник) |
|---|-----|-------------|----------------------|
| 5.1 | README (структура репо) | Счётчики функций/файлов (напр. «87/16», «103/5») не совпадают с фактическим `grep` (105 ✅/5 📋) и с самим собой в разных секциях | факт `docs/FEATURES.md` |
| 5.2 | README/DELIVERY | «600+ tests» vs «integration 90/90» — разные цифры тестов | DELIVERY.md (90/90), факт — см. §5.3 |
| 5.3 | E2E Playwright | README: «10 E2E tests»; AGENT: «≥3»; DELIVERY: «E2E не входит в поставку»; TEST_CASES §19: 2 сценария; на диске 6 спек-файлов | факт диска + DELIVERY |
| 5.4 | Фазы | AGENT.md: phase1–phase5; README.ru: phase1–phase4 (ops=phase5 отсутствует) | compose: phase1–4 (+all), ops=all |
| 5.5 | SAGA.md «Связанные ADR» | Ссылки на ADR-003/004/005 не соответствуют их темам | ADR-007 (канон) |
| 5.6 | Пароль БД | DELIVERY: `pmos:pmos`; compose/README: `pmos:***` | compose (факт запуска) |
| 5.7 | settings-события | FEATURES: `settings.changed`; фактически `pmos.settings.settings.{created,updated,deleted}` | `contracts/asyncapi/events.yaml`, commit 45d83f6 |
| 5.8 | Contract tests | DEV_GUIDE/TEST_CASES упоминают Pact; фактически OpenAPI-conformance через `gen-contract-tests.mjs` | scripts/ + REVIEW RESOLVED |
| 5.9 | nginx-префиксы | README/AGENT пишут `/api/<svc>`; nginx.conf использует спец-префиксы (напр. `/api/search/`, `/api/ai/`, `/api/timesheet+promodoro`) | `platform/docker/nginx.conf` |
| 5.10 | ops в доках | ops отсутствует в ARCHITECTURE/FEATURES/DEV_GUIDE/BACKLOG (grep: 0 вхождений) | факт: services/ops + ops.yaml |
| 5.11 | frontend-путь | DEV_GUIDE/ADR-007: `services/frontend`; README: `frontend/` в корне | факт: `services/frontend` |
| 5.12 | Healthcheck-путь | DEV_GUIDE: `:3000/health`; канон ADR-007: `/api/<svc>/v1/health-check` | ADR-007 |

---

## 6. Команды (эталон из AGENT.md / DEV_GUIDE.md)

```bash
# Зависимости (весь воркспейс)
pnpm install

# Инфраструктура (Postgres + NATS + api-gateway)
docker compose -f platform/docker/docker-compose.yml --profile core up -d

# Миграции (все сервисы)
pnpm -r --filter './services/**' exec drizzle-kit push

# Dev-режим (все сервисы)
pnpm dev

# Тесты
pnpm test                       # юнит-тесты всех сервисов
pnpm -r --filter notes test     # один сервис
pnpm test:contract              # контракт-тесты (из contracts/openapi)

# Генераторы (scripts/)
node scripts/gen-openapi.mjs    # контракты из схем
node scripts/scaffold-services.mjs
```

> Точные команды могут отличаться — сверяйся с `AGENT.md` и `docs/DEV_GUIDE.md` (раздел «Тестирование»/«Quick Start»).

---

## 7. Связи и маршрутизация «куда смотреть»

| Вопрос | Смотреть в первую очередь |
|--------|---------------------------|
| Архитектура/события/стек | `docs/ARCHITECTURE.md`, затем `ADR-007` |
| Конвенции (канон) | `docs/ADR/ADR-007.md` |
| API конкретного сервиса | `contracts/openapi/<svc>.yaml` |
| События/шина | `contracts/asyncapi/events.yaml`, `docs/SAGA.md` |
| Функции/фичи сервиса | `docs/FEATURES.md` |
| Тест-сценарии | `docs/TEST_CASES.md` |
| Локальный запуск/env/миграции | `docs/DEV_GUIDE.md` |
| Проблемы запуска/план доработок | `docs/IMPROVEMENTS.md` |
| Идеи/бэклог | `docs/BACKLOG.md` |
| Статус аудита доков | `docs/REVIEW.md` |
| Правила агента (runbook) | `AGENT.md` |
| Состав поставки | `DELIVERY.md` |
| Порты/профили/инфра | `platform/docker/docker-compose.yml`, `nginx.conf` |

---

## 8. Как поддерживать этот файл

- **При изменении любого документа** — обновляй его карточку в §3 (структура/факты/связи).
- **При новом расхождении** — добавляй строку в §5 (таблица) и, если проблема по факту запуска, в `docs/IMPROVEMENTS.md`.
- **При новом ADR** — добавляй в таблицу §3.3 с пометкой статуса.
- **При новом сервисе** — добавляй в таблицу §4 (порт/профиль/контракт) и в `docs/FEATURES.md`.
- **Держи разделы компактными**: карточки — выжимки, не дубликаты исходников.
