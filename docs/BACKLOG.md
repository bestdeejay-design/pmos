# BACKLOG.md — Идеи, отложенные функции и UI-слой

> **Статус:** backend-ядро ЦУП **сдано** (Delivery Gate, см. `DELIVERY.md`): 16 сервисов,
> 5 саг, CI. Ниже — то, что осознанно отложено за пределы backend-DoD,
> и идеи, не имеющие пока владельца. Приоритеты: P1 (ближайшие), P2 (плановые), P3 (когда-нибудь).

---

## 1. UI-слой: frontend + desktop (P1)

Backend-API полностью готов и покрыт контрактами — UI строится поверх `/api/<svc>/v1`.

| Задача | Сервисы | Описание | Приоритет |
|---|---|---|---|
| React SPA | frontend | Восстановить/переписать SPA на новом API. В legacy-монолите SPA уже была — перенести страницы, разбить `api.ts` по сервисам | ✅ P1 |
| E2E (Playwright) | e2e | 5 critical scenarios: создать заметку, задача с рекурренсом, встреча+reminder, файл→поиск, webhook. Директория `tests/` зарезервирована (сейчас пуста — заменена integration 90/90) | ✅ P1 |
| Desktop (Tauri) | desktop | Обновить `desktop/` на новый стек: только Docker lifecycle + WebView (ADR без Rust-логики) | P3 |
| WS-пуши клиенту | agent, calendar | Push сообщений агента / напоминаний в браузер через WebSocket (механизм описан в ARCHITECTURE.md, не реализован) | P2 |

## 2. Отложенные функции backend (из `FEATURES.md` 📋)

Каталог функций: `docs/FEATURES.md` (✅ 87 сдано / 📋 16 отложено).

### P2 — функциональные расширения

| Функция | Сервис | Описание |
|---|---|---|
| Active profile + цветовая маркировка + скрытие | profiles | Выбор активного профиля, цвета, скрытие из списка |
| Markdown-рендеринг | notes | Серверный рендер body, заголовок как plain text |
| Kanban-доска | tasks | Колонки с drag-and-drop между статусами; динамические колонки из settings (`kanban_columns`); ручная сортировка в колонке |
| Drag-and-drop в календаре | calendar | Перенос встречи и изменение длительности мышью |
| Напоминания (fire_at + WS push) | calendar | fire_at + push клиенту |
| Недавние запросы | search-rag | Хранятся в localStorage (frontend) |

### P3 — AI-расширения

| Функция | Сервис | Описание |
|---|---|---|
| Dictation-диктовка | ai-gateway | Запись голоса → распознавание → AI-форматирование (body+title+tag). ✅ Реализовано: POST /transcribe (multipart → STT → пайплайн /dictate) |
| Облачные модели | ai-gateway | Прокси до cloud API (OpenAI, Anthropic, Google) — сейчас только локальные (Ollama chain) ✅ Реализовано: провайдер-абстракция, fallback cloud → Ollama → эвристика |
| Триггер meeting_ended | agent | После встречи: предложить создать заметку ✅ Реализовано |
| Триггер project_plan | agent | План проекта на основе goal ✅ Реализовано |
| DND-окно + дневной лимит | agent | Не беспокоить в заданные часы; ≤ N сообщений в день ✅ Реализовано |

### P3 — AI и расширения поиска/API (выполнено)

| Функция | Сервис | Описание |
|---|---|---|
| Полнотекстовый поиск по вложениям | search-rag | ✅ Реализовано: tsvector/GIN колонка (миграция 0003), FTS-ветка в /search (websearch_to_tsquery, ts_rank, ts_headline сниппеты + highlights), ILIKE и semantic (pgvector) как fallback |
| Шаблоны встреч/задач | tasks, calendar | ✅ Реализовано: CRUD /templates (зеркало notes), события pmos.{tasks,calendar}.templates.*, контракты обновлены |
| Rate limiting на api-gateway | nginx | ✅ Реализовано: limit_req на все /api/* локации (zone internal 100r/s + public 100r/m), JSON-429 (error_page + @rate_limited), /ws и статика не лимитируются |
| Локализация API-ошибок | все сервисы | ✅ Реализовано: localizeApiError в @pmos/shared, словарь code→ru, выбор по Accept-Language / x-language, fallback на EN при отсутствии header |

## 3. Инфраструктура и качество (P2)

| Задача | Где | Описание |
|---|---|---|
| Pact-брокер (consumer-driven) | contracts | Заменить OpenAPI-conformance на Pact (ADR-002 §3 TODO, ADR-005) |
| Perf: caching, query opt | все | Медленные запросы, N+1 (после появления реальной нагрузки) |
| Healthchecks в docker-compose | platform/docker | Graceful startup/shutdown для профиля `all` |
| mTLS между сервисами | platform | Опционально для production (ARCHITECTURE.md §Безопасность) |

## 4. Идеи (P3, нет владельца)

- Уведомления в браузере (Push API) для напоминаний календаря.

> Перенесено в выполненные выше (см. §2 «P3 — AI и расширения поиска/API»):
> полнотекстовый поиск по вложениям, шаблоны встреч/задач, локализация API-ошибок, rate limiting.
> Статистика и дашборды времени (time-tracking → агрегаты за период) — выполнено: расширенный
> `GET /api/timesheet/stats` (total/perDay/byTask/byProject через кэш task_projects) + страница `/time`.

---

## Сводка

| Приоритет | Задач | Тип |
|---|---|---|
| P1 | 3 | UI-слой: SPA, E2E, desktop |
| P2 | 12 | Функциональные (6) + WS-пуши + инфраструктура (5) |
| P3 | 11 | AI-расширения (5) ✅ + расширения поиска/API (4) ✅ + desktop — 9/11 выполнены |

Все backend-задачи P0–P4 из исходного плана миграции **выполнены** (см. `docs/REVIEW.md`,
`docs/SAGA.md`); исходный «план миграции 10-12 недель» более не актуален — репозиторий уже
работает как новый стек (strangler-фаза не потребовалась, монолит не входил в scope).
