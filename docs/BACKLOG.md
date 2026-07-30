# BACKLOG.md — План работ по миграции в ЦУП

## Общая оценка: 10-12 недель до полного cutover

---

## Phase 0: Foundation (1-2 недели)

**Цель**: настроить инфраструктуру нового проекта, общие типы, шину событий, CI/CD.

**Сервисы**: shared-types (`@pmos/shared`), event-bus (`@pmos/event-bus`), api-gateway (конфиг).

> ⚠️ `shared-types` и `event-bus` — фундамент (ADR-007 §5.C9), строятся первыми, не «фичи».
> Все конвенции (Fastify, `/api/<svc>/v1`, event `version`, camelCase) зафиксированы в **ADR-007** и обязательны.

### P0.1 Создать монорепозиторий

| | |
|---|---|
| **Service** | — |
| **Task** | Инициализировать npm workspaces в корне `pmos/` |
| **Dependencies** | — |
| **Effort** | S |
| **Acceptance** | `pnpm install` работает, eslint/prettier настроен |
| **Risk** | Низкий |

### P0.2 @pmos/shared — базовые типы

| | |
|---|---|
| **Service** | shared-types |
| **Task** | Создать пакет `platform/shared-types/` с интерфейсами: Event, Profile, Note, Task, Meeting, Project, FileMeta, Settings |
| **Dependencies** | P0.1 |
| **Effort** | M |
| **Acceptance** | Все сервисы могут импортировать `@pmos/shared` |
| **Action** | Перенести типы из `frontend/src/types.ts` и `backend/src/types.ts`, унифицировать |

### P0.3 Event Bus SDK

| | |
|---|---|
| **Service** | event-bus |
| **Task** | NATS клиент: publish(subject, event), subscribe(subject, handler), requestReply |
| **Dependencies** | P0.2 (Event тип) |
| **Effort** | M |
| **Acceptance** | Два процесса могут обмениваться событиями через NATS |
| **Action** | docker-compose: nats:4222 |

### P0.4 CI/CD

| | |
|---|---|
| **Service** | — |
| **Task** | GitHub Actions: lint → typecheck → test → build |
| **Dependencies** | P0.1 |
| **Effort** | S |
| **Acceptance** | PR не мержится без зелёного CI |

### P0.5 api-gateway (nginx)

| | |
|---|---|
| **Service** | api-gateway |
| **Task** | nginx.conf: SPA → /, API → заглушки (502 пока сервисов нет) |
| **Dependencies** | P0.1 |
| **Effort** | S |
| **Acceptance** | docker compose up → localhost:8080 → SPA грузится |

---

## Phase 1: Core Services (2-4 недели)

**Цель**: выделить независимые сервисы ядра: profiles, settings, notes, tasks.

### P1.1 profiles service

| | |
|---|---|
| **Service** | profiles |
| **Task** | Fastify сервис с CRUD profiles. Публикует `profiles.*` события. |
| **Dependencies** | P0.2, P0.3 |
| **Effort** | S |
| **Acceptance** | `GET /api/profiles` возвращает профили | notes/tasks подписываются на события |

### P1.2 settings service

| | |
|---|---|
| **Service** | settings |
| **Task** | Fastify сервис: KV CRUD + `GET /api/settings/ollama-models` |
| **Dependencies** | P0.2, P0.3 |
| **Effort** | S |
| **Acceptance** | `POST /api/settings` → `settings.changed` → подписчики получают |

### P1.3 notes service — CRUD + templates

| | |
|---|---|
| **Service** | notes |
| **Task** | Fastify сервис: CRUD notes + templates + reorder. Публикует `notes.*` события. Подписывается на `profiles.*`. |
| **Dependencies** | P1.1 |
| **Effort** | L |
| **Acceptance** | Все CRUD операции, ручная сортировка, шаблоны, архивирование |
| **Risk** | Большой объём логики (связи с проектами/встречами/задачами) |

### P1.4 tasks service — CRUD + kanban + priorities

| | |
|---|---|
| **Service** | tasks |
| **Task** | Fastify сервис: CRUD tasks, kanban status, priorities ranking, recurrence, streaks, dependencies |
| **Dependencies** | P1.1 |
| **Effort** | L |
| **Acceptance** | Все CRUD, ранжирование, рекурренс создаёт новую задачу, streaks растут |
| **Risk** | Рекурренс + streaks — самая сложная логика, требует хороших unit-тестов |

### P1.5 Frontend: рефакторинг api.ts

| | |
|---|---|
| **Service** | frontend |
| **Task** | Разделить `api.ts` на модули по сервисам: `api/notes.ts`, `api/tasks.ts`, etc. |
| **Dependencies** | P1.1, P1.3, P1.4 |
| **Effort** | M |
| **Acceptance** | Фронтенд работает через новый api-client |

---

## Phase 2: Calendar + Projects + Files (4-6 недель)

**Цель**: выделить сервисы календаря, проектов и файлов, запустить search-rag.

### P2.1 calendar service

| | |
|---|---|
| **Service** | calendar |
| **Task** | Fastify сервис: CRUD meetings, recurrence, reminders, ICS export |
| **Dependencies** | P1.1 |
| **Effort** | M |
| **Acceptance** | Рекуррентные встречи, ICS экспорт, reminders с WS push |

### P2.2 projects service

| | |
|---|---|
| **Service** | projects |
| **Task** | Fastify сервис: CRUD projects, items dashboard, Gantt |
| **Dependencies** | P1.1 |
| **Effort** | M |
| **Acceptance** | GET /api/projects/:id/items возвращает notes+tasks+meetings+files |

### P2.3 files service

| | |
|---|---|
| **Service** | files |
| **Task** | Fastify сервис: upload, download, text extraction, metadata |
| **Dependencies** | P1.1 |
| **Effort** | M |
| **Acceptance** | Файлы загружаются, скачиваются, текст извлекается |

### P2.4 search-rag service

| | |
|---|---|
| **Service** | search-rag |
| **Task** | Fastify сервис: подписка на notes/tasks/meetings/files события, построение embedding index, POST /api/search |
| **Dependencies** | P1.3, P1.4, P2.1, P2.3 |
| **Effort** | L |
| **Acceptance** | Поиск находит новые заметки/задачи/встречи/файлы после их создания |
| **Risk** | pgvector extension требует настройки PostgreSQL |

---

## Phase 3: AI + Integrations (6-8 недель)

**Цель**: выделить AI gateway, agent, export-import, integrations.

### P3.1 ai-gateway service

| | |
|---|---|
| **Service** | ai-gateway |
| **Task** | Fastify сервис: прокси к Ollama с fallback chain, /dictate, /restore-punctuation |
| **Dependencies** | P1.2 (settings для моделей) |
| **Effort** | M |
| **Acceptance** | Dictation возвращает body+title+tag, fallback работает при отказе модели |

### P3.2 agent service

| | |
|---|---|
| **Service** | agent |
| **Task** | Fastify сервис: inbox, triggers (daily digest, deadline_soon, meeting_ended, etc.), digests (today/week) |
| **Dependencies** | P1.1, P1.3, P1.4, P2.1, P2.2, P3.1 |
| **Effort** | L |
| **Acceptance** | Триггеры создают сообщения, WS пушит клиенту, digest показывает данные |

### P3.3 export-import service

| | |
|---|---|
| **Service** | export-import |
| **Task** | Fastify сервис: ZIP export всех данных, text/JSON import |
| **Dependencies** | P1.3, P1.4, P2.1, P2.2, P2.3 |
| **Effort** | M |
| **Acceptance** | ZIP скачивается, import создаёт сущности |

### P3.4 integrations service

| | |
|---|---|
| **Service** | integrations |
| **Task** | Fastify сервис: API keys CRUD, webhooks CRUD + delivery + retry, public API (api/v1) |
| **Dependencies** | P0.3 (подписка на события всех сервисов) |
| **Effort** | M |
| **Acceptance** | Webhook вызывается при notes.created, API keys валидируются |

---

## Phase 4: Advanced Services (8-10 недель)

**Цель**: выделить email, external-calendars, time-tracking, sync.

### P4.1 email service

| | |
|---|---|
| **Service** | email |
| **Task** | Fastify сервис: IMAP accounts CRUD, sync worker, emails list, conversion to note/task |
| **Dependencies** | P1.1, P1.3, P1.4 |
| **Effort** | L |
| **Acceptance** | Email синхронизируется, конвертируется в заметку |

### P4.2 external-calendars service

| | |
|---|---|
| **Service** | external-calendars |
| **Task** | Fastify сервис: Google OAuth, Yandex CalDAV, ICS URL sync |
| **Dependencies** | P2.1 (linked_meeting_id) |
| **Effort** | M |
| **Acceptance** | Google календарь синхронизируется |

### P4.3 time-tracking service

| | |
|---|---|
| **Service** | time-tracking |
| **Task** | Fastify сервис: timesheet CRUD + stats, pomodoro sessions CRUD |
| **Dependencies** | P1.4 (task_id) |
| **Effort** | M |
| **Acceptance** | Timesheet записывается, статистика считается |

### P4.4 sync service

| | |
|---|---|
| **Service** | sync |
| **Task** | Fastify сервис: sync-folders CRUD, watch/scan, auto-import/export |
| **Dependencies** | P1.3 (notes), P2.3 (files) |
| **Effort** | M |
| **Acceptance** | .md файл импортируется как заметка |

---

## Phase 5: Migration & Cutover (10-12 недель)

**Цель**: параллельный запуск старого и нового стеков, поэтапное отключение монолита.

### Стратегия миграции (Strangler Fig)

```
Шаг 1: Новые сервисы + старый монолит работают параллельно
        ┌──────────┐    ┌──────────┐
        │  Новый   │    │  Старый  │
        │  API GW  │    │  Монолит │
        │  :8080   │    │  :8081   │
        └────┬─────┘    └────┬─────┘
             │               │
             ▼               ▼
        Новые сервисы    Старые роуты
        (только Phase 1) (всё остальное)

Шаг 2-4: Каждый Phase добавляет новые сервисы, отключает старые роуты

Шаг 5: Монолит остановлен, все запросы → новые сервисы
```

### P5.1 Event bridge

| | |
|---|---|
| **Task** | Заглушка в старом монолите: на каждое изменение данных дублировать событие в NATS |
| **Effort** | M |
| **Risk** | Double-write может привести к рассинхронизации |

### P5.2 Parallel run — Core Services

| | |
|---|---|
| **Task** | Новые profiles/settings/notes/tasks + старые. Фронтенд переключается на новые роуты. |
| **Dependencies** | P1.x |
| **Effort** | L |
| **Acceptance** | Все заметки/задачи создаются через новые сервисы |

### P5.3 Parallel run — Calendar + Projects + Files + Search

| | |
|---|---|
| **Dependencies** | P2.x |
| **Effort** | L |

### P5.4 Parallel run — AI + Integrations

| | |
|---|---|
| **Dependencies** | P3.x |
| **Effort** | M |

### P5.5 Parallel run — Advanced

| | |
|---|---|
| **Dependencies** | P4.x |
| **Effort** | M |

### P5.6 Decommission

| | |
|---|---|
| **Task** | Остановить старый монолит. Удалить код `backend/src/routes/`. |
| **Dependencies** | P5.2-P5.5 |
| **Effort** | S |
| **Acceptance** | Ни один запрос не идёт к старому бэкенду |

---

## Phase 6: Polish (12+ недель)

**Цель**: E2E, оптимизация, документация, упаковка.

| Task | Effort | Description |
|------|--------|-------------|
| E2E тесты Playwright | L | 5 critical scenarios |
| Performance: caching, query opt | M | Медленные запросы, N+1 проблемы |
| Documentation for devs | M | README каждого сервиса |
| Tauri desktop: new stack | S | Обновить stack/ директорию |
| Docker Compose: healthchecks | S | Graceful startup/shutdown |

---

## Сводная таблица

| Phase | Weeks | Сервисы | Итог |
|-------|-------|---------|------|
| P0 | 1-2 | shared-types, event-bus, api-gateway, CI/CD | Инфраструктура готова |
| P1 | 2-4 | profiles, settings, notes, tasks | Ядро работает |
| P2 | 4-6 | calendar, projects, files, search-rag | Продуктивность |
| P3 | 6-8 | ai-gateway, agent, export-import, integrations | AI + интеграции |
| P4 | 8-10 | email, external-calendars, time-tracking, sync | Продвинутые |
| P5 | 10-12 | Migration bridge + cutover | Монолит выключен |
| P6 | 12+ | E2E, perf, docs, Tauri | Полировка |

**Total**: ~12 сервисов, ~12 недель (при full-time работе одного разработчика + Sisyphus).
