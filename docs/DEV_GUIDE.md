# DEV_GUIDE.md — Настройка локального окружения ЦУП

> **ЦУП (Центр Управления Проектами)** — event-driven Personal OS.
> Монорепозиторий на **pnpm workspaces** (не npm — см. ADR-007 §2/§5.C8). Каждый микросервис в `services/` — свой Fastify инстанс (Express упоминается в старых частях доков ошибочно; канон — Fastify 5, ADR-007 §2/§5.C1).
> Инфраструктура (NATS, PostgreSQL) запускается в Docker. Режим разработки — tsx watch (горячая перезагрузка).

---

## Содержание

- [Prerequisites](#prerequisites)
- [Quick Start (полный стек за 5 минут)](#quick-start-полный-стек-за-5-минут)
- [Проект и его структура](#проект-и-его-структура)
- [Запуск отдельных сервисов](#запуск-отдельных-сервисов)
- [Переменные окружения](#переменные-окружения)
- [Добавление нового сервиса](#добавление-нового-сервиса)
- [Управление базой данных](#управление-базой-данных)
- [Отладка](#отладка)
- [Docker Compose Profiles](#docker-compose-profiles)
- [Тестирование](#тестирование)
- [Ссылки](#ссылки)

---

## Prerequisites

| Инструмент | Версия | Зачем |
|-----------|--------|-------|
| **Node.js** | ^22 (LTS) | Runtime для всех сервисов |
| **pnpm** | latest | Монорепозиторий (workspaces) |
| **Docker Desktop** (или **OrbStack** на macOS) | latest | PostgreSQL, NATS, опционально Prometheus/Grafana |
| **Bun** (опционально) | latest | Альтернатива pnpm (быстрее `install`) |
| **nats CLI** (опционально) | latest | Отладка шины событий из командной строки |
| **psql** (опционально) | 16+ | Прямое подключение к PostgreSQL |

### Установка

```bash
# Node.js 22 — через fnm, nvm, or brew
fnm use 22
node --version  # v22.x.x

# pnpm (глобально)
npm install -g pnpm
pnpm --version  # 10.x.x

# Docker Desktop или OrbStack
# macOS: https://orbstack.dev  (рекомендуется — быстрее и легче)

# nats CLI (опционально)
brew install nats-io/nats-tools/nats
```

---

## Quick Start (полный стек за 5 минут)

```bash
# 1. Клонировать репозиторий
git clone <repo-url>
cd pmos

# 2. Установить зависимости (всех воркспейсов)
pnpm install

# 3. Запустить инфраструктуру (PostgreSQL + NATS + все сервисы)
docker compose --profile all up -d

# 4. Выполнить миграции БД (создание схем, таблиц, индексов)
pnpm run db:migrate

# 5. Запустить все сервисы в dev-режиме (tsx watch — hot reload)
pnpm run dev
```

После этого:

| Что | Где |
|-----|-----|
| SPA (фронтенд) | http://localhost:8080 |
| Healthcheck | http://localhost:8080/api/health |
| Метрики сервиса | http://localhost:3xxx/metrics |
| NATS монитор | nats://localhost:4222 |
| PostgreSQL | postgresql://pmos:pmos@localhost:5432/pmos |

---

## Проект и его структура

```
pmos/
├── services/                # Микросервисы (один каталог на сервис)
│   ├── profiles/            #   :3006 — контекстные профили
│   ├── settings/            #   :3007 — настройки (KV)
│   ├── notes/               #   :3001 — заметки
│   ├── tasks/               #   :3002 — задачи (Kanban, рекурренс)
│   ├── calendar/            #   :3003 — встречи
│   ├── projects/            #   :3004 — проекты + Gantt
│   ├── files/               #   :3005 — файлы
│   ├── search-rag/          #   :3008 — полнотекстовый + семантический поиск
│   ├── ai-gateway/          #   :3009 — прокси к LLM (Ollama / cloud)
│   ├── agent/               #   :3010 — AI-ассистент (триггеры, дайджесты)
│   ├── email/               #   :3012 — IMAP-почта
│   ├── external-calendars/  #   :3013 — Google / Yandex / ICS календари
│   ├── integrations/        #   :3014 — webhooks, API-ключи, Public API v1
│   ├── time-tracking/       #   :3011 — timesheet + pomodoro
│   ├── export-import/       #   :3015 — экспорт ZIP / импорт
│   ├── sync/                #   :3016 — Obsidian-style sync с файловой системой
│   └── api-gateway/         #   nginx — единый вход (:8080)
├── platform/                # Общая инфраструктура
│   ├── event-bus/           #   NATS клиент, SDK (publish/subscribe wrapper)
│   ├── shared-types/        #   @pmos/shared — типы, интерфейсы, event schemas
│   └── docker/              #   Dockerfile'ы, docker-compose, nginx.conf
├── frontend/                # React SPA (Vite + React 18 + TypeScript)
├── desktop/                 # Tauri v2 desktop app (только Docker lifecycle)
├── scripts/                 # Генераторы сервисов (scaffold-services, gen-openapi, gen-schemas, gen-routes)
├── tests/                   # Интеграционные и E2E тесты
│   └── contract/            #   Контрактные тесты (Pact)
└── docs/                    # Документация
    ├── ADR/                 #   Architecture Decision Records
    ├── ARCHITECTURE.md      #   Общая архитектура
    ├── FEATURES.md          #   Полный каталог функций
    ├── BACKLOG.md           #   План работ
    └── DEV_GUIDE.md         #   Этот файл
```

### Структура типичного сервиса

```
services/profiles/
├── src/
│   ├── index.ts             # Точка входа — создание HTTP-сервера, подключение к NATS и БД
│   ├── app.ts               # Fastify роутер (роуты монтируются в src/routes/index.ts)
│   ├── db/
│   │   └── schema.ts        # Drizzle ORM схема (таблицы сервиса)
│   ├── events/
│   │   ├── publish.ts       # Функции публикации событий
│   │   └── subscribe.ts     # Обработчики входящих событий
│   └── middleware/
│       ├── logging.ts       # Pino-логгер с correlationId
│       └── metrics.ts       # Prometheus метрики
├── migrations/              # SQL-миграции (YYYYMMDDHHMMSS_desc.sql)
├── test/                    # Unit + интеграционные тесты
├── .env.example             # Шаблон переменных окружения
├── package.json             # pnpm workspace, скрипты, зависимости
└── tsconfig.json            # strict mode
```

См. [`scripts/scaffold-services.mjs`](../scripts/scaffold-services.mjs) — генератор всех 16 сервисов.
Для нового сервиса добавьте запись в массив `SERVICES` в скрипте и запустите `node scripts/scaffold-services.mjs`.

---

## Запуск отдельных сервисов

Каждый сервис можно запустить изолированно для разработки:

```bash
# Пример: запуск profiles

# 1. Перейти в каталог сервиса
cd services/profiles

# 2. Скопировать шаблон окружения
cp .env.example .env
# Отредактировать .env при необходимости (см. таблицу переменных ниже)

# 3. Запустить только инфраструктуру (PostgreSQL + NATS)
#    Флаг --profile core поднимает только необходимое
docker compose --profile core up -d

# 4. Выполнить миграции для этого сервиса
pnpm run db:migrate

# 5. Запустить сервис в dev-режиме
pnpm run dev
# Сервис доступен на порту, указанном в .env (по умолчанию :3000 для каждого)

# 6. Проверить health
curl http://localhost:3000/health
# → {"ok":true,"db":true,"nats":true,"uptime":42}
```

### Сценарии запуска

| Цель | Команда |
|------|---------|
| Только инфраструктура (БД + NATS) | `docker compose --profile core up -d` |
| Инфраструктура + конкретный сервис | `docker compose --profile core --profile <service> up -d` |
| Один сервис локально (вне Docker) | `cd services/<name> && pnpm run dev` (предварительно поднять `--profile core`) |
| Все сервисы локально | `pnpm run dev` (в корне монорепозитория) |

**Важно**: если сервис подписан на события другого сервиса (например, search-rag читает `notes.created`),
то второй сервис тоже должен быть запущен, иначе read model'и не будут строиться.

---

## Переменные окружения

### Полная таблица

| Переменная | Значение по умолчанию | Обязательная | Описание |
|-----------|----------------------|:-----------:|----------|
| `SERVICE_NAME` | — | **да** | Идентификатор сервиса (например `profiles`, `notes`). Используется в метриках и логах. |
| `PORT` | `3000` | нет | HTTP-порт, на котором сервис слушает запросы. |
| `DATABASE_URL` | — | **да** | Строка подключения к PostgreSQL. `postgresql://user:pass@host:5432/db` |
| `DATABASE_SCHEMA` | `public` | нет | PostgreSQL схема сервиса. В production — имя сервиса с `_` (см. [ADR-004](ADR/ADR-004.md)). |
| `NATS_URL` | `nats://localhost:4222` | нет | URL NATS сервера. |
| `NATS_USER` | — | нет | Имя пользователя NATS (если требуется аутентификация). |
| `NATS_PASS` | — | нет | Пароль NATS. |
| `LOG_LEVEL` | `info` | нет | Уровень логирования pino: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. |
| `OTEL_ENABLED` | `false` | нет | Включить сбор метрик Prometheus (`true` / `false`). |
| `API_GATEWAY_URL` | `http://api-gateway:8080` | нет | URL API-гейта для проброса корреляционных заголовков. |

### Где задавать

1. **Разработка (локально)** — в файле `.env` внутри каталога сервиса. Файл не коммитится.
2. **Шаблон** — `.env.example` рядом с `.env` содержит значения по умолчанию и подсказки.
3. **Docker Compose** — переменные можно переопределить в `docker-compose.yml` через `environment:` или `env_file:`.

```bash
# Пример services/profiles/.env
SERVICE_NAME=profiles
PORT=3006
DATABASE_URL=postgresql://pmos:pmos@localhost:5432/pmos
DATABASE_SCHEMA=profiles_
NATS_URL=nats://localhost:4222
LOG_LEVEL=debug
```

> **Важно**: `DATABASE_URL` для всех сервисов указывает на **один и тот же** PostgreSQL.
> Изоляция достигается через разные **схемы** (`DATABASE_SCHEMA`), а не через разные БД.
> См. [ADR-004: Database per Service](ADR/ADR-004.md).

---

## Добавление нового сервиса

Проще всего — добавить запись в массив `SERVICES` в `scripts/scaffold-services.mjs` и
перегенерировать (это создаст `services/<name>/` со всем каркасом: Fastify, Drizzle-схема,
NATS publish/subscribe, тесты, Dockerfile, `.env.example`). Скрипт идемпотентен.

```bash
# 1. добавить в scripts/scaffold-services.mjs:
#   { name: "digests", schema: "digests_", port: 3017, phase: "phase2" }
node scripts/scaffold-services.mjs
# 2. (опционально) сгенерировать контракт, схему и роуты
node scripts/gen-openapi.mjs
node scripts/gen-schemas.mjs
node scripts/gen-routes.mjs
pnpm install
```

Ручной вариант (если не использовать скрипт):

### Шаг 1. Создать каталог и package.json
Создайте `services/<name>/` с `package.json` (имя `@pmos/<name>`, скрипты `dev/build/typecheck/test/db:generate/db:migrate`,
deps `fastify`, `@fastify/type-provider-typebox`, `drizzle-orm`, `postgres`, devDeps `typescript`, `vitest`,
`@pmos/shared`, `@pmos/event-bus`).

### Шаг 2. Определить таблицы
Отредактируйте `src/db/schema.ts` (схема изолируется по `DATABASE_SCHEMA`, ADR-004):

```typescript
// Пример: таблица для сервиса "digests"
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const digests = pgTable("digests", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  body: text("body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

### Шаг 3. Настроить сервис
В `src/index.ts` задайте `SERVICE_NAME` через env (`process.env.SERVICE_NAME ?? "digests"`).
`PORT` и `DATABASE_SCHEMA` берутся из `.env` (см. `.env.example`).

### Шаг 4. Добавить HTTP-роуты
В `src/routes/index.ts` определите эндпоинты. Каждый эндпоинт **сначала** описывается в OpenAPI
(`contracts/openapi/<name>.yaml`), потом реализуется (см. `scripts/gen-routes.mjs` как образец).
Роуты монтируются в `src/app.ts` с префиксом `/api/<name>/v1` (ADR-007 §2).

### Шаг 5. Добавить события (если нужно)
В `src/events/publish.ts` — функции публикации; в `src/events/subscribe.ts` — обработчики.
Все события следуют `EventEnvelope` из `@pmos/shared` (ADR-003 + ADR-007 §5):
`{ id, type, source, timestamp, data (camelCase), correlationId, version }`.

### Шаг 6. Зарегистрировать в docker-compose
В `platform/docker/docker-compose.yml` добавить сервис (порт из диапазона `3001..3020`,
см. таблицу портов в `AGENT.md §4` или `scripts/scaffold-services.mjs`):

```yaml
services:
  digests:
    build:
      context: ../../services/digests
    ports:
      - "3017:3017"
    environment:
      SERVICE_NAME: digests
      DATABASE_SCHEMA: digests_
    profiles:
      - phase2   # или phase3, или all
```

### Шаг 7. Добавить в pnpm-workspace.yaml
`services/*` уже включает новый сервис автоматически.

### Шаг 8. Установить зависимости
```bash
pnpm install
```

### Шаг 9. Создать миграцию и применить
```bash
cd services/digests
pnpm run db:generate   # генерация SQL-миграции из schema.ts
pnpm run db:migrate    # применение (нужен Postgres)
```

### Шаг 10. Запустить и проверить
```bash
pnpm run dev
curl http://localhost:3017/health
```

---

## Управление базой данных

### Миграции

```bash
# Применить все миграции (всех сервисов)
pnpm run db:migrate

# Применить миграции одного сервиса
pnpm --filter <service> run db:migrate

# Сгенерировать миграцию из Drizzle schema
pnpm --filter <service> run db:generate

# Откатить последнюю миграцию
pnpm run db:rollback
```

Миграции лежат в `services/<name>/migrations/` и именуются как `YYYYMMDDHHMMSS_desc.sql`.

### Подключение к схеме сервиса

```bash
# Через psql напрямую
psql $(grep DATABASE_URL services/profiles/.env | cut -d= -f2)

# Внутри psql:
SET search_path TO profiles_;
SELECT * FROM profiles;
```

### Изоляция схем

Каждый сервис работает в своей PostgreSQL схеме. Это означает:

- **Нет FK между схемами** — связи только по UUID, целостность в коде (см. [ADR-004](ADR/ADR-004.md)).
- **Read model'и** строятся из событий, а не прямыми запросами к чужим схемам.
- **Shared kernel** — таблицы `profiles_/profiles` и `settings_/settings` читаются всеми сервисами (кэш через события).

---

## Отладка

### Логи

```bash
# Все сервисы
docker compose logs -f

# Конкретный сервис
docker compose logs -f <service-name>

# Фильтр по correlationId (трассировка цепочки событий)
docker compose logs | grep <correlationId>

# Только ошибки
docker compose logs | grep '"level":"error"'
```

Логи в формате JSON (pino). Для удобного чтения в dev-режиме используется `pino-pretty`.

### NATS

```bash
# Подключиться к NATS CLI
nats context save pmos --server nats://localhost:4222
nats context select pmos

# Слушать все события
nats sub ">"

# Слушать конкретный тип событий
nats sub "notes.created"

# Посмотреть статистику JetStream
nats stream ls
nats stream info <stream-name>
```

### Метрики

```bash
# Метрики конкретного сервиса
curl http://localhost:<port>/metrics

# Healthcheck
curl http://localhost:<port>/health
```

Список экспонируемых метрик (см. [ADR-005](ADR/ADR-005.md)):

| Метрика | Тип | Описание |
|---------|-----|----------|
| `http_requests_total` | counter | Запросы по методу, пути, статусу |
| `http_request_duration_ms` | histogram | Длительность запросов |
| `events_published_total` | counter | Опубликованные события по типу |
| `events_processed_total` | counter | Обработанные события по типу (success/failure) |
| `db_query_duration_ms` | histogram | Запросы к БД |
| `service_info` | gauge | 1 = сервис запущен |

### Prometheus + Grafana (опционально)

```bash
docker compose --profile monitoring up -d
```

| Сервис | URL |
|--------|-----|
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 (admin/admin) |

---

## Docker Compose Profiles

Файл: `platform/docker/docker-compose.yml`

| Профиль | Включает | Использование |
|---------|----------|---------------|
| `core` | PostgreSQL, NATS | Всегда нужен для работы любого сервиса |
| `phase1` | profiles, settings, api-gateway | Базовая функциональность |
| `phase2` | notes, tasks, calendar, projects, files | Основные фичи |
| `phase3` | search-rag, ai-gateway, agent | AI-возможности |
| `phase4` | email, external-calendars, integrations sync, time-tracking, export-import | Интеграции и продуктивность |
| `all` | Всё перечисленное | Полный стек |
| `monitoring` | Prometheus, Grafana | Метрики (опционально) |

### Примеры

```bash
# Разработка profiles — только core
docker compose --profile core up -d

# Разработка notes + search-rag (нужны notes)
docker compose --profile core --profile phase2 up -d

# Полный стек + мониторинг
docker compose --profile all --profile monitoring up -d

# Только БД для локальной разработки
docker compose --profile core up -d
cd services/profiles && pnpm run dev
```

---

## Тестирование

Стратегия тестирования описана в [ADR-002](ADR/ADR-002.md).

### Команды

```bash
# Все тесты (всех сервисов)
pnpm test

# Один сервис
pnpm --filter <service> test

# Watch-режим (разработка)
pnpm --filter <service> test:watch

# С отчётом покрытия
pnpm --filter <service> test -- --coverage
```

### Контрактные тесты (Pact)

```bash
# Проверить контракты потребителей
pnpm --filter <service> test:contract
```

### E2E тесты (Playwright)

```bash
pnpm --filter tests run test:e2e
```
Требуют запущенного полного стека (`docker compose --profile all up -d`).

---

## Ссылки

| Документ | О чем |
|----------|-------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Общая архитектура, принципы, навигация по репозиторию |
| [FEATURES.md](FEATURES.md) | Полный каталог всех функций по сервисам |
| [ADR-001](ADR/ADR-001.md) | API Gateway и аутентификация (nginx, маппинг портов) |
| [ADR-002](ADR/ADR-002.md) | Стратегия тестирования (Test Pyramid, Pact, Playwright) |
| [ADR-003](ADR/ADR-003.md) | Event-Driven Communication (NATS JetStream, формат событий, Event Catalog) |
| [ADR-004](ADR/ADR-004.md) | Database per Service (изоляция схем, shared kernel, read model'и) |
| [ADR-005](ADR/ADR-005.md) | Observability (pino, prom-client, correlationId, healthcheck) |
| [ADR-006](ADR/ADR-006.md) | Стратегия миграции данных из монолита |
| [BACKLOG.md](BACKLOG.md) | План работ и статус реализации |
