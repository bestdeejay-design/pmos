# IMPROVEMENTS.md — Полный каталог проблем, расхождений и план доработок pmOS

> **Статус:** рабочий документ. Составлен по итогам **практической попытки запуска полного
> стека** (`docker compose --profile all up -d --build`) и **аудита соответствия документации
> фактическому состоянию репозитория**.
>
> Это **не список «сделано»**, а **план того, что нужно исправить и доработать**, чтобы
> проект можно было показать как «готовый» и развивать дальше.
>
> Формат каждой проблемы: **симптом → причина → варианты решений → проверка → что править**.
> Приоритеты: **P1** — блокирует запуск/демонстрацию, **P2** — качество и надёжность,
> **P3** — отложено.

---

## 1. Что реально происходит при запуске (хроника)

> Все ошибки воспроизведены в логах сессии. Код и конфиги **не правлены** — временные
> исправления откачены; ниже зафиксирован только сам факт и диагноз.

| # | Этап | Ошибка | Последствие |
|---|------|--------|-------------|
| E1 | `docker compose --profile all build` | `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` у всех 17 сервисов | Сборка падает — образы не создаются |
| E2 | старт сервисов с placeholder'ом в URL | `28P01 password authentication failed` | Сервисы не подключаются к БД |
| E3 | запрос через gateway | Fastify `404 Route GET:/api/<svc>/v1/... not found` | Проксированный путь теряет префикс `/api/<svc>` |
| E4 | после пересборки сервисов | `404` через gateway, хотя напрямую всё работает | nginx шлёт запросы на старый IP upstream |
| E5 | `pnpm run db:migrate` | миграции применены не у всех сервисов (напр. profiles ждёт `is_active`/`hidden`) | БД не согласована со схемами |

---

## 2. Инфраструктура запуска (P1)

### 2.1 Сборка: `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`

**Симптом.** `docker compose --profile all build` падает на всех сервисах.

**Причина (корень).** Per-service Dockerfile (`services/notes/Dockerfile`, `services/ops/Dockerfile`
идентичны) собирается из **собственного каталога** сервиса (`build: { context: ../../services/<svc> }`
в `platform/docker/docker-compose.yml`). Он копирует только `package.json` сервиса и запускает
`pnpm install`, но не имеет доступа к:

- `pnpm-workspace.yaml` и `pnpm-lock.yaml` (корень),
- пакетам `platform/shared-types` (`@pmos/shared`) и `platform/event-bus` (`@pmos/event-bus`),
  объявленным как `"workspace:*"` в зависимостях каждого сервиса.

`pnpm install` не находит workspace-пакеты → ошибка. Вдобавок финальная стадия копирует
`node_modules` целиком (в pnpm это **symlink'и** на workspace-пакеты) — даже после успешной
сборки в образе остались бы битые ссылки на несуществующие каталоги.

**Варианты решения:**
- [ ] **(рекомендуется)** Общий `platform/docker/Dockerfile.service` с аргументом `SERVICE`
      (см. скелет ниже) + в compose: `build: { context: ../.., dockerfile: platform/docker/Dockerfile.service, args: { SERVICE: <svc> } }`.
- [ ] В финальную стадию класть не весь `node_modules`, а **собранные артефакты**:
      `dist/` сервиса + собранные `platform/*` + продакшн-зависимости (`pnpm deploy` — но см.
      ограничение ниже) либо `pnpm install --prod` в контексте всего workspace.
- [ ] Добавить **корневой `.dockerignore`** (`node_modules`, `dist`, `.git`, `.omo`, `*.log`, `coverage`, `playwright-report`), чтобы контекст `../..` не тащил мусор.
- [ ] Обновить `scripts/scaffold-services.mjs` и `DEV_GUIDE.md` (раздел «Добавление нового сервиса»), чтобы новые сервисы генерировались уже с правильным build.

**Скелет общего Dockerfile (эскиз):**
```dockerfile
ARG SERVICE
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY platform/shared-types platform/shared-types
COPY platform/event-bus     platform/event-bus
COPY services/${SERVICE}    services/${SERVICE}
RUN pnpm install --frozen-lockfile=false \
 && pnpm --filter @pmos/shared --filter @pmos/event-bus build \
 && pnpm --filter @pmos/${SERVICE} build
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/platform /app/platform
COPY --from=build /app/services/${SERVICE}/dist ./services/${SERVICE}/dist
COPY --from=build /app/services/${SERVICE}/package.json ./services/${SERVICE}/package.json
COPY --from=build /app/node_modules ./node_modules
WORKDIR /app/services/${SERVICE}
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

**Проверка.** `docker compose build notes ops` → сборка проходит; `docker compose run --rm notes node -e "require('@pmos/shared')"` → модуль резолвится.

**Что править:** `platform/docker/docker-compose.yml`, `services/*/Dockerfile` (или удалить в пользу общего), `DEV_GUIDE.md`, `scaffold-services.mjs`.

---

### 2.2 nginx-gateway: trailing slash в `proxy_pass`

**Симптом.** Запрос через gateway `http://localhost:8080/api/calendar/v1/meetings` возвращает
Fastify `404 Route GET:/api/calendar/v1/meetings not found` — хотя напрямую
`http://localhost:3003/api/calendar/v1/meetings` работает.

**Причина.** В `platform/docker/nginx.conf` **все** внутренние локации написаны с trailing
slash: `proxy_pass http://calendar_up/;` (и все остальные `*_up/`). nginx при совпадении
`location /api/calendar/` **вырезает совпавшую часть** из пересылаемого URI и подставляет то,
что идёт после `upstream` (здесь — `/`). В итоге сервис получает `/v1/meetings` вместо
`/api/calendar/v1/meetings` → 404.

**Варианты решения:**
- [A] Убрать trailing slash во всех внутренних `proxy_pass http://<svc>_up;`.
      **Отдельно проверить** `/api/v1/` (публичное зеркало → `integrations_up/`) — какой URI
      ожидает integrations на входе.
- [B] (P2) Зафиксировать правило в `ADR-007.md` § «Mandatory Implementation Rules»:
      «внутренний `proxy_pass` — без trailing slash, иначе путь теряет префикс».

**Проверка.** `curl http://localhost:8080/api/notes/v1/health-check` → 200; после пересборки
gateway — снова 200 (см. 2.4).

**Что править:** `platform/docker/nginx.conf`, `ADR-007.md`.

---

### 2.3 Пароль-заглушка `***` в `DATABASE_URL`

**Симптом.** Все сервисы падают с `28P01 password authentication failed for user "pmos"`.

**Причина.** В `platform/docker/docker-compose.yml` у **всех 16 CRUD-сервисов**:
`DATABASE_URL: postgres://pmos:***@postgres:5432/pmos` — литеральный плейсхолдер `***`,
тогда как контейнер `postgres` создаётся с `POSTGRES_PASSWORD: pmos`. (Неправленный пример
с тем же `***` — в Quick Start `README.md`.)

**Варианты решения:**
- [A] Заменить `***` на `pmos` во всех блоках `environment` compose.
- [B] (надёжнее) `DATABASE_URL: postgres://pmos:${POSTGRES_PASSWORD}@postgres:5432/pmos`
      + `POSTGRES_PASSWORD=pmos` в `.env` (и в compose у `postgres`).
- [C] Добавить валидацию при старте compose-стека: `docker compose config | grep -q '\*\*\*'`
      → не стартовать.

> **Примечание:** healthcheck'и **уже присутствуют**: `postgres` — `pg_isready`,
> `nats` — `wget /healthz`, `api-gateway` — `wget /api/health`; у всех сервисов уже стоит
> `depends_on: { postgres: { condition: service_healthy }, nats: { condition: service_healthy } }`.
> Дополнительно добавлять healthcheck не требуется — требуется только **документировать**
> этот механизм (см. §3.3).

**Проверка.** `docker compose config | grep DATABASE_URL` → нет `***`; сервисы поднимаются.

**Что править:** `platform/docker/docker-compose.yml`, `README.md`/`README.ru.md` (Quick Start), `DEV_GUIDE.md`.

---

### 2.4 nginx кэширует IP upstream после пересборки

**Симптом.** После `docker compose up -d --build <svc>` запросы через gateway снова дают 404,
хотя контейнер сервиса жив и отвечает напрямую.

**Причина.** Docker Compose при пересоздании контейнера выдаёт сервису **новый IP**;
nginx резолвит имена upstream один раз при старте и продолжает слать на старый адрес.

**Варианты решения:**
- [A] Задокументировать обязательный шаг: после любой пересборки
      `docker compose up -d --force-recreate api-gateway`.
- [B] (долгосрочно) `resolver 127.0.0.11` + имена в `proxy_pass` для динамического резолвинга.
- [C] Учесть в чек-листе запуска (см. `docs/TROUBLESHOOTING.md`, §8 плана).

**Проверка.** Пересобрать любой сервис → gateway продолжает отвечать 200.

**Что править:** `DEV_GUIDE.md` (чек-лист запуска), `platform/docker/nginx.conf` (вариант B).

---

### 2.5 Миграции БД (P1)

**Симптом.** После подъёма БД схемы не согласованы: например `profiles` требует колонок
`is_active`, `hidden` (по контракту), но миграция не применена → сервис отвечает ошибками БД.

**Причина.** Миграции не входят в compose-запуск; они выполняются отдельно
(`pnpm --filter "./services/*" run db:migrate`), и этот шаг легко пропустить.

**Нужно:** в `DEV_GUIDE.md` и `README.md` явно указать обязательный порядок: поднять
`--profile core` → `pnpm --filter "./services/*" run db:migrate` → поднять остальное.
(`ops` — stateless, без `db/` и `migrations/` — исключение, для него скрипта нет, это ок.)

---

## 3. Расхождения «документация vs факт»

Проверено против фактической структуры репозитория и кода.

### 3.1 Структура репозитория

| Утверждается в док-ках | Факт | Вердикт |
|------------------------|------|---------|
| `frontend/` — каталог в **корне** (`DEV_GUIDE.md:114`, `ADR-007.md:138`) | SPA живёт в **`services/frontend/`** (README корректен) | **Расхождение** — DEV_GUIDE/ADR-007 устарели |
| `tests/` «directory is **removed**» (`ADR-007.md:145`) | Каталог `tests/` **существует**, внутри `tests/contract/` пусто | **Расхождение** — либо удалить, либо наполнить; README описывает `tests/` как «reserved for E2E (empty)» |
| `desktop/` (Tauri v2) | **Отсутствует** | Отражено в `BACKLOG.md` как будущая работа (кода нет) |
| Сервис `ops` (DLQ-панель, порт 3017) | Реально в `docker-compose.yml` и nginx (`/api/ops/`), есть `services/ops/` | **Отсутствует во всех доках**: ARCHITECTURE, FEATURES, DEV_GUIDE, ADR-007, BACKLOG (grep — 0 упоминаний) |
| 16 CRUD + ops = 17 сервисов | 17 каталогов-сервисов в `services/` (16 CRUD + ops) + `frontend` | README говорит «17», ARCHITECTURE местами «16» — согласовать терминологию |
| API base path `/api/<svc>/v1`, контейнерный порт 3000, host-порты 3001–3017 | Совпадает с compose и роутами | ✅ |
| `pgvector/pgvector:pg16` как `postgres` | В compose: `image: pgvector/pgvector:pg16` (нужен search-rag) | ✅ (комментарий в compose верный) |

**Что делать:**
- [ ] Обновить `DEV_GUIDE.md` и `ADR-007.md`: `frontend/` → `services/frontend/`.
- [ ] Определиться с `tests/`: удалить (по ADR-007) или оставить как E2E-площадку (по README) — и привести оба документа к одному решению.
- [ ] Добавить `ops` в ARCHITECTURE, FEATURES, ADR-007 §7 (таблица доступа), BACKLOG (назначение, публикуемые/читаемые события).

### 3.2 Docker Compose профили: DEV_GUIDE vs compose

`DEV_GUIDE.md` (§ профили) и `docker-compose.yml` **полностью расходятся**:

| Профиль | DEV_GUIDE | docker-compose.yml (факт) |
|---------|-----------|---------------------------|
| `phase1` | profiles, settings, api-gateway | notes, tasks, profiles, settings (+ postgres, nats, api-gateway) |
| `phase2` | notes, tasks, calendar, projects, files | calendar, projects, files, search-rag |
| `phase3` | search-rag, ai-gateway, agent | ai-gateway, agent, integrations, export-import |
| `phase4` | email, external-calendars, integrations, sync, time-tracking, export-import | email, external-calendars, time-tracking, sync |

**Что делать:** выбрать источник истины — **compose** — и переписать таблицу профилей в `DEV_GUIDE.md`.

### 3.3 Переменные окружения и README

- [ ] `README.md` Quick Start: `DATABASE_URL=postgres://pmos:***@localhost:5432/pmos` — тот же
      placeholder `***`; заменить на `pmos` (или `${POSTGRES_PASSWORD}`).
- [ ] README-статусы («all 17 services implemented and verified», «frontend 166/166»,
      «600+ tests») — **проверить повторным прогоном** `pnpm -r run typecheck / test /
      test:contract` после устранения §2; зафиксировать актуальные цифры.
- [ ] `services/frontend/vite.config.ts` проксирует `/api` и `/ws` на `localhost:8080` — ок
      для dev; **production-сборка SPA не описана** (нет Dockerfile у `services/frontend`,
      nginx-локации `location = /index.html` и `~* \.(js|css|...)$` закомментированы как
      «mount at runtime if frontend built»). Описать шаг сборки SPA и монтирования статики.

### 3.4 nginx-префиксы vs пути сервисов

nginx использует **кастомные** префиксы, не совпадающие с `/api/<svc>/`:

| location | upstream | Сервис |
|----------|----------|--------|
| `/api/search/` | `search_up` | search-rag |
| `/api/ai/` | `ai_up` | ai-gateway |
| `/api/timesheet/`, `/api/pomodoro/` | `time_up` | time-tracking |
| `/api/imap/` | `email_up` | email |
| `/api/calendars/` | `extcal_up` | external-calendars |
| `/api/webhooks/`, `/api/api-keys/` | `integrations_up` | integrations |
| `/api/export/`, `/api/import/` | `export_up` | export-import |
| `/api/sync-folders/` | `sync_up` | sync |

**Что делать:** сверить каждый префикс с фактически монтируемыми роутами сервиса
(`src/routes/index.ts`); задокументировать карту в `DEV_GUIDE.md` / `ADR-007.md`.

---

## 4. UI / Frontend (P1)

### 4.1 Текущее состояние SPA

`localhost:5173` (Vite dev) отображает базовый каркас; визуально «далеко от задуманного
Personal OS». Frontend-сервис существует (`services/frontend/`, React 19 + Vite 6 + Tailwind v4,
dnd-kit, react-router 7, react-markdown), но стилизация минимальна.

### 4.2 Эталон дизайна не интегрирован

Рядом с репозиторием есть продуманный дизайн-прототип `personal-os-ui-demo.html`
(тёмная/светлая темы, профили Work/Home/Family/Friends, палитра с акцентами `#eeccc3`,
календарь, заметки, горячие клавиши `⌘1–4`) — **не перенесён** в SPA.

**Нужно:**
- [ ] Оценить `services/frontend/src/` против `personal-os-ui-demo.html`.
- [ ] Перенести токены стилей (палитра, типографика, темы), базовые компоненты и layout.
- [ ] Подключить профильные чипы, календарь (месяц + агенда), dual-pane заметки.
- [ ] Пройтись визуальным QA по ключевым страницам.

### 4.3 Ключевые экраны для проверки

Dashboard/профили → Календарь → Notes (dual-pane) → Kanban → Priorities → Files →
Search → Timesheet → Agent inbox → Import. Сверять с `docs/FEATURES.md` (таблица фронтенда);
отмечать, что реализовано, а что «каркас».

---

## 5. Качество и тесты

### 5.1 E2E (Playwright)

- `tests/` пуст; **реальные E2E** — в `services/frontend` (`playwright.config.ts`, скрипт
  `test:e2e`). README обещает «5 critical scenarios» (BACKLOG) и «10 tests» (README) —
  **уточнить фактическое число** и запустить.
- Учесть в CI: сейчас `.github/workflows/ci.yml` гоняет typecheck + unit + contract, но
  **не E2E** и **не docker-сборку** — добавить job на сборку образов (иначе §2.1 не ловится).

### 5.2 Contract tests

- `contracts/test/helper.ts` — есть; `contracts/openapi/*.yaml` (17 шт.) + conformance 17/17.
- Продолжать прогонять `pnpm --filter "./services/*" run test:contract` после правок.

### 5.3 Monorepo hygiene

- [ ] Добавить корневой `.dockerignore` (см. 2.1).
- [ ] Проверить, что `services/frontend` и `services/ops` включены в workspace
      (`pnpm-workspace.yaml: services/*` — да) и что `dist`/`node_modules` не закоммичены
      (проверить `.gitignore`).
- [ ] `.npmrc` — есть (нужен для `auto-install-peers`, `strict-peer-deps`); подтвердить
      настройки.

---

## 6. Приоритетный план действий

| # | Задача | Приоритет | Раздел |
|---|--------|:---------:|:------:|
| 1 | Общий `platform/docker/Dockerfile.service` + `context: ../..` + `.dockerignore` | P1 | 2.1 |
| 2 | Убрать trailing slash в nginx.conf + правило в ADR-007 | P1 | 2.2 |
| 3 | Заменить `***` в `DATABASE_URL` (compose + README) | P1 | 2.3 |
| 4 | Задокументировать `--force-recreate api-gateway` после пересборки | P1 | 2.4 |
| 5 | Порядок миграций в README/DEV_GUIDE; проверить применение | P1 | 2.5 |
| 6 | `docs/TROUBLESHOOTING.md` + чек-лист запуска по §2 | P1 | 2.x |
| 7 | Синхронизировать структуру: `frontend/`, `tests/`, `ops` в доках | P2 | 3.1 |
| 8 | Переписать таблицу профилей в DEV_GUIDE по compose | P2 | 3.2 |
| 9 | Проверить карту nginx-префиксов ↔ роуты сервисов | P2 | 3.4 |
| 10 | Интегрировать дизайн `personal-os-ui-demo.html` в SPA | P1 | 4 |
| 11 | Прогнать typecheck/unit/contract/E2E после фиксов; переснять статусы README | P2 | 5 |
| 12 | Добавить CI-job на docker-сборку | P2 | 5.1 |
| 13 | `github-repo-hygiene` (README, topics, ссылки) после мажорных правок | P3 | — |

---

## 7. Связанные документы

| Документ | Что править |
|----------|-------------|
| `platform/docker/docker-compose.yml` | build.context, DATABASE_URL, .env |
| `platform/docker/nginx.conf` | trailing slash (2.2), dynamic resolver (2.4) |
| `platform/docker/Dockerfile.service` | **новый** — общий Dockerfile (2.1) |
| `.dockerignore` (корень) | **новый** (2.1) |
| `docs/DEV_GUIDE.md` | §добавление сервиса, профили (3.2), чек-лист запуска, troubleshooting, frontend-путь |
| `docs/ARCHITECTURE.md` | frontend-структура, ops, терминология «17» |
| `docs/ADR/ADR-007.md` | frontend-путь, trailing-slash-правило, ops, карта префиксов |
| `docs/BACKLOG.md` | метки P1/P2 по §6, ops |
| `README.md` / `README.ru.md` | Quick Start (`***`), статусы, профили, ops |
| `services/frontend/` | редизайн (раздел 4) |
| `.github/workflows/ci.yml` | job на docker-сборку (5.1) |

---

*Входная точка для планирования доработок. При любом несовпадении с `ADR-007.md` —
ADR-007 является каноном; расхождения с ним выносить на обсуждение и фиксировать в этом файле.*
