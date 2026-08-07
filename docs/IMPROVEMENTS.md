# IMPROVEMENTS.md — План доработок pmOS

> **Статус:** черновик. Составлен по итогам попытки запуска полного стека и аудита документации.
> Ничего из перечисленного ниже **не реализовано** — это список работ, которые нужно провести.
> Приоритеты: P1 (блокирует запуск/демонстрацию), P2 (качество разработки), P3 (когда-нибудь).

---

## 1. Инфраструктура запуска (P1) — ошибки, найденные при подъёме стека

При попытке `docker compose --profile all up -d --build` и последующем запуске
были обнаружены четыре блокирующие проблемы. Ниже — **что сломано и что нужно сделать**,
сам код **не исправлен** (изменения из рабочего дерева откачены).

### 1.1 Docker-сборка падает: `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`

**Симптом.** Каждый сервис собирается из собственного каталога
(`build.context: ../../services/<svc>`), при этом общие пакеты
`@pmos/shared` (`platform/shared-types/`) и `@pmos/event-bus` (`platform/event-bus/`)
лежат **вне контекста сборки**. `pnpm install` в образе не находит workspace-пакеты
и падает с `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` у всех 17 сервисов.

**Нужно сделать:**
- [ ] Создать **общий Dockerfile** (`platform/docker/Dockerfile.service`) с параметром `SERVICE`:
      стадия build — `corepack` + `pnpm install --frozen-lockfile` из **корня репозитория**
      (`COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./`), затем сборка `platform/*`,
      затем сборка сервиса; стадия runtime — копия workspace, `WORKDIR /app/services/<SERVICE>`.
- [ ] Перевести все `build:` блоки в `platform/docker/docker-compose.yml` на
      `context: ../..` + `dockerfile: platform/docker/Dockerfile.service` + `args: {SERVICE: ...}`.
- [ ] Добавить **корневой `.dockerignore`** (`node_modules`, `dist`, `.git`, `.omo` и т.д.)
      — без него контекст сборки тянет лишние сотни МБ.
- [ ] Проверить, что `@pmos/event-bus` экспортирует только `dist/` → сборку `platform/*`
      выполнять **до** сборки сервиса (в CI это отдельный шаг).
- [ ] Зафиксировать этот паттерн в `DEV_GUIDE.md` (раздел «Добавление нового сервиса»)
      и в `scripts/scaffold-services.mjs` (чтобы новые сервисы сразу собирались правильно).

### 1.2 nginx-gateway отдаёт 404 большинству сервисов: trailing slash в `proxy_pass`

**Симптом.** В `platform/docker/nginx.conf` у локаций вида
`location /api/<svc>/ { proxy_pass http://<svc>_up/; }` trailing slash заставляет nginx
**срезать префикс** `/api/<svc>` при проксировании. Сервис получает `/v1/meetings`
вместо `/api/calendar/v1/meetings` → Fastify 404 `Route GET:/api/<svc>/v1/... not found`.
Работал только тот сервис, у которого slash случайно отсутствовал.

**Нужно сделать:**
- [ ] Убрать trailing slash у **всех** внутренних `proxy_pass http://<svc>_up;`
      (кроме публичной локации `/api/v1/`, если она оставлена осознанно).
- [ ] После правки пересоздать gateway: `docker compose up -d --force-recreate api-gateway`.
- [ ] Проверка: `docker exec api-gateway grep proxy_pass /etc/nginx/nginx.conf`
      — ни одна внутренняя строка не должна оканчиваться на `_up/;`.
- [ ] Внести правило «никаких trailing slash после `proxy_pass` для внутренних локаций»
      в ADR-007 (§8 Mandatory Implementation Rules) как R6.

### 1.3 PostgreSQL: `password authentication failed` (28P01)

**Симптом.** В `platform/docker/docker-compose.yml` у сервисов
`DATABASE_URL: postgresql://pmos:***@postgres:5432/pmos` — литеральный placeholder `***`,
тогда как у контейнера `postgres` пароль задан как `pmos` (`POSTGRES_PASSWORD`).
Все сервисы падают при старте с `28P01`.

**Нужно сделать:**
- [ ] Заменить все `***` в `DATABASE_URL` на реальный пароль, совпадающий с
      `POSTGRES_PASSWORD` сервиса `postgres` (по умолчанию `pmos`), во всех 16 блоках.
- [ ] Не использовать «похожие на секрет» заглушки в compose; при необходимости —
      переменные окружения (`${POSTGRES_PASSWORD}`) с валидацией при старте.
- [ ] Добавить healthcheck на `postgres` и `depends_on: condition: service_healthy`
      для сервисов, чтобы старт не гонялся в цикле перезапусков.

### 1.4 nginx кэширует старые IP upstream после пересборки

**Симптом.** После `docker compose up -d --build <svc>` сервис получает новый IP,
а nginx (резолвит upstream при старте) продолжает слать на старый → 404 через gateway,
хотя напрямую в контейнер всё работает.

**Нужно сделать:**
- [ ] Задокументировать обязательный шаг в runbook/`DEV_GUIDE.md`:
      после любой пересборки или изменения `docker-compose.yml` выполнять
      `docker compose up -d --force-recreate api-gateway`.
- [ ] Рассмотреть `resolver 127.0.0.11` + переменные в `proxy_pass`
      (динамический резолвинг) как более надёжную альтернативу.
- [ ] (P2) Добавить healthcheck для `api-gateway` и в compose, и в `DEV_GUIDE.md`.

---

## 2. Доработки по документации (P1–P2)

### 2.1 Новый файл `docs/TROUBLESHOOTING.md` (P1)

Создать руководство по диагностике и устранению четырёх проблем из §1
(симптом → причина → решение → проверка → профилактика), плюс:
- раздел «Чек-лист перед запуском полного стека» (проверка `DATABASE_URL`,
  контекста сборки, `--force-recreate api-gateway`, `pnpm run db:migrate`);
- раздел «Сервисы работают напрямую, но 404 через gateway».

> Примечание: файл был набросан в рабочем дереве, но **откачен** — писать заново
> по итогам этого плана.

### 2.2 `DEV_GUIDE.md` — раздел «Распространённые проблемы» (P1)

Добавить сразу после «Quick Start» блок со ссылками на `TROUBLESHOOTING.md`
и напоминанием про `--force-recreate api-gateway` после пересборки.

### 2.3 `DEV_GUIDE.md` — шаг 6 «Добавление нового сервиса» (P2)

Обновить пример docker-compose: вместо `context: ../../services/digests`
указывать общий `Dockerfile.service` (см. §1.1), чтобы каркас не генерировал
неподнимающийся сервис.

### 2.4 Согласованность с ADR-007 (P2)

Проверить документацию на противоречия канону ADR-007:
- везде «Fastify 5», не «Express» (конфликт C1);
- пути API с `/v1` (C2);
- события с `version` и camelCase `data` (C3/C4);
- если найдены расхождения — оформить doc-fix (по ADR-007 §1 агент открывает PR).

### 2.5 README / README.ru.md (P2)

- Убедиться, что Quick Start в README отражает реальный запуск
  (включая шаг про миграции и force-recreate gateway).
- Ссылка на `docs/TROUBLESHOOTING.md` в разделе «Навигация».

---

## 3. Замечания к проектированию (design review)

Наблюдения из ошибок запуска, которые стоит учесть в архитектуре:

| # | Наблюдение | Куда записать | Статус |
|---|-----------|---------------|--------|
| D1 | Сборка монорепо в Docker требует общего Dockerfile и корневого контекста; по-сервисный `context` невозможен с pnpm workspaces | ADR-007 §2 (Container) | 📋 |
| D2 | nginx как gateway без service discovery: статические upstream кэшируются при старте — нужен документированный шаг пересоздания или `resolver` | ADR-001 | 📋 |
| D3 | Секреты/заглушки в compose-файле: запретить литеральные `***`; использовать env-переменные + валидацию | ADR-001 или новый ADR | 📋 |
| D4 | Healthchecks (`depends_on: condition: service_healthy`) для postgres/nats/gateway отсутствуют в compose | ADR-002 / BACKLOG §3 | 📋 |
| D5 | UI-слой (React SPA) заметно уступает прежнему визуалу Personal OS — требуется редизайн на базе `personal-os-ui-demo.html` (палитра, профили, календарь) | BACKLOG §1 (React SPA) | 📋 |

---

## 4. Связанные документы

| Документ | Зачем |
|----------|-------|
| `docs/DEV_GUIDE.md` | Обновить: чек-лист запуска, добавление сервиса, troubleshooting |
| `docs/ARCHITECTURE.md` | Обновить описание сборки/запуска, если меняется паттерн Docker |
| `docs/ADR/ADR-001.md` | Gateway: задокументировать кэш upstream + пересоздание |
| `docs/ADR/ADR-007.md` | Добавить R6 (trailing slash) и правила Docker-сборки монорепо |
| `docs/BACKLOG.md` | Отметить P1-работы §1 как запланированные |
| `README.md` / `README.ru.md` | Quick Start и навигация |
