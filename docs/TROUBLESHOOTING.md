# TROUBLESHOOTING.md — Диагностика ошибок запуска и чек-лист

> **Назначение.** Быстрая диагностика типовых проблем при запуске стека pmOS.
> Все ошибки ниже воспроизведены на практике (см. хронику в `docs/IMPROVEMENTS.md` §1–§2).
> Порядок запуска и обязательные шаги — см. «Чек-лист запуска» в конце файла.

---

## 1. Чек-лист запуска (обязательный порядок)

```bash
# 0. Проверить, что нет плейсхолдеров в конфигах (см. §3)
docker compose -f platform/docker/docker-compose.yml config | grep '\*\*\*' && echo "ПЛЕЙСХОЛДЕРЫ ЕСТЬ" || echo "OK"

# 1. Инфраструктура: PostgreSQL + NATS
docker compose -f platform/docker/docker-compose.yml --profile core up -d

# 2. Миграции БД (ОБЯЗАТЕЛЬНО после core, ДО сервисов)
pnpm --filter "./services/*" run db:migrate

# 3. Остальной стек
docker compose -f platform/docker/docker-compose.yml --profile all up -d

# 4. Проверка
curl http://localhost:8080/api/health          # → {"ok":true}
curl http://localhost:8080/api/notes/v1/health-check   # → 200 {"ok":true,...}
```

> **После пересборки любого сервиса** выполни
> `docker compose up -d --force-recreate api-gateway` — иначе gateway продолжит слать
> запросы на старый IP upstream (см. §5).

---

## 2. E1 — сборка: `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`

**Симптом.** `docker compose --profile all build` падает у всех сервисов:
`ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.

**Причина.** Per-service Dockerfile собирается из собственного каталога сервиса и не видит
корневые `pnpm-workspace.yaml` / `pnpm-lock.yaml` и workspace-пакеты
(`platform/shared-types` = `@pmos/shared`, `platform/event-bus` = `@pmos/event-bus`).

**Решение (варианты).**
- (рекомендуется) Общий `platform/docker/Dockerfile.service` + `build: { context: ../.. }`
  (скелет в `docs/IMPROVEMENTS.md` §2.1);
- либо собрать артефакты `dist/` вне Docker и класть их в образ.

**Проверка.** `docker compose build notes` → сборка проходит;
`docker compose run --rm notes node -e "require('@pmos/shared')"` → модуль резолвится.

---

## 3. E2 — `28P01 password authentication failed` — **исправлено**

**Симптом (исторически).** Сервисы не подключались к БД.

**Причина.** В `platform/docker/docker-compose.yml` у сервисов стоял литеральный плейсхолдер
`postgres://pmos:***@postgres:5432/pmos`, тогда как `postgres` создаётся с
`POSTGRES_PASSWORD: pmos`.

**Решение (применено).** Заглушка `***` заменена на реальный пароль:
`DATABASE_URL: postgres://pmos:pmos@postgres:5432/pmos` во всех блоках `environment` compose.

**Проверка.** `docker compose -f platform/docker/docker-compose.yml config | grep DATABASE_URL`
→ все строки `postgres://pmos:pmos@postgres:5432/pmos`, без `***`; `docker compose up -d`
→ сервисы стартуют, логи без `28P01`.

---

## 4. E3 — Fastify `404 Route GET:/api/<svc>/v1/... not found` через gateway

**Симптом.** Запрос через `http://localhost:8080/api/calendar/v1/meetings` → 404, хотя
напрямую `http://localhost:3003/api/calendar/v1/meetings` работает.

**Причина (историческая, исправлено).** Раньше в `platform/docker/nginx.conf` внутренние
`proxy_pass` были написаны с trailing slash (`proxy_pass http://calendar_up/;`). nginx при
совпадении `location /api/calendar/` вырезает совпавшую часть и подставляет то, что идёт
после upstream (`/`) → сервис получал `/v1/meetings` вместо `/api/calendar/v1/meetings`.
Плюс часть location-префиксов не совпадала с mount-путями (`/api/search/` vs `/api/search-rag/v1`).

**Решение (применено).** В `nginx.conf` все `proxy_pass` без trailing slash (без URI-части) —
nginx передаёт полный исходный URI, и сервис всегда получает `/api/<svc>/v1/...`; location-пути
приведены к каноническим `/api/<svc>/v1/` (ADR-007 §7/R6). Legacy-алиасы (`/api/search/`,
`/api/ai/`, `/api/timesheet/`, `/api/imap/` и т.д.) сохранены как `rewrite … last` на
канонический путь. После правки: `docker compose up -d --force-recreate api-gateway`.

**Проверка.** `curl http://localhost:8080/api/notes/v1/health-check` → 200, а также
`curl http://localhost:8080/api/search-rag/v1/health-check` и legacy
`curl http://localhost:8080/api/search/v1/health-check` (rewrite) → 200.

---

## 5. E4 — после пересборки сервиса gateway отдаёт 404

**Симптом.** После `docker compose up -d --build <svc>` запросы через gateway снова 404,
хотя контейнер жив и отвечает напрямую.

**Причина.** Docker выдаёт пересозданному контейнеру новый IP; nginx резолвит имена
upstream **один раз при старте** и продолжает слать на старый адрес.

**Решение.**
```bash
docker compose up -d --force-recreate api-gateway
```
(долгосрочно — `resolver 127.0.0.11` + имена в `proxy_pass`, см. IMPROVEMENTS §2.4-B).

**Проверка.** Пересобрать любой сервис → gateway продолжает отвечать 200.

---

## 6. E5 — миграции применены не у всех сервисов

**Симптом.** Сервис отвечает ошибками БД (например, profiles требует колонок
`is_active`/`hidden`, которых нет).

**Причина.** Миграции не входят в compose-запуск и выполняются отдельным шагом, который
легко пропустить.

**Решение.** Соблюдать порядок: `--profile core up -d` → `pnpm --filter "./services/*" run db:migrate`
→ `--profile all up -d`. (у `ops` нет БД/миграций — исключение, это ок.)

**Проверка.**
```bash
pnpm --filter "./services/*" run db:migrate
docker compose up -d --force-recreate <svc>   # пересоздать с новыми схемами
curl http://localhost:<port>/api/<svc>/v1/health-check
```

---

## 7. Инфраструктурные проверки

| Что | Команда | Ожидание |
|-----|---------|----------|
| Postgres жив | `docker compose ps postgres` | healthy (`pg_isready`) |
| NATS жив | `docker compose ps nats` | healthy (`/healthz` на 8222) |
| Gateway жив | `docker compose ps api-gateway` | healthy (`/api/health`) |
| Плейсхолдеры | `docker compose config \| grep '\*\*\*'` | пусто |
| Слушать события | `nats sub 'pmos.>'` | события идут |
| Метрики сервиса | `curl localhost:<port>/metrics` | пром-формат |

---

## 8. Связанные документы

| Документ | Что смотреть |
|----------|--------------|
| `docs/IMPROVEMENTS.md` | Полные диагнозы §2.1–2.5 + план доработок |
| `docs/ADR/ADR-007.md` | Канон: R6 (trailing slash), §7 (карта префиксов) |
| `docs/DEV_GUIDE.md` | Quick Start, профили, миграции |
| `platform/docker/docker-compose.yml` | Инфраструктура, env, healthcheck'и |
| `platform/docker/nginx.conf` | Маршрутизация gateway |
