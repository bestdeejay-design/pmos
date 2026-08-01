# BACKLOG.md — Идеи, отложенные функции и UI-слой

> **Статус:** backend-ядро ЦУП **сдано** (Delivery Gate, см. `DELIVERY.md`): 16 сервисов,
> 5 саг, 90/90 тестов, CI. Ниже — то, что осознанно отложено за пределы backend-DoD,
> и идеи, не имеющие пока владельца. Приоритеты: P1 (ближайшие), P2 (плановые), P3 (когда-нибудь).

---

## 1. UI-слой: frontend + desktop (P1)

Backend-API полностью готов и покрыт контрактами — UI строится поверх `/api/<svc>/v1`.

| Задача | Сервисы | Описание | Приоритет |
|---|---|---|---|
| React SPA | frontend | Восстановить/переписать SPA на новом API. В legacy-монолите SPA уже была — перенести страницы, разбить `api.ts` по сервисам | P1 |
| E2E (Playwright) | e2e | 5 critical scenarios: создать заметку, задача с рекурренсом, встреча+reminder, файл→поиск, webhook. Директория `tests/` зарезервирована (сейчас пуста — заменена integration 90/90) | P1 |
| Desktop (Tauri) | desktop | Обновить `desktop/` на новый стек: только Docker lifecycle + WebView (ADR без Rust-логики) | P3 |
| WS-пуши клиенту | agent, calendar | Push сообщений агента / напоминаний в браузер через WebSocket (механизм описан в ARCHITECTURE.md, не реализован) | P2 |

## 2. Отложенные функции backend (из `FEATURES.md` 📋)

Каталог функций: `docs/FEATURES.md` (✅ 85 сдано / 📋 18 отложено).

### P2 — функциональные расширения

| Функция | Сервис | Описание |
|---|---|---|
| Active profile + цветовая маркировка + скрытие | profiles | Выбор активного профиля, цвета, скрытие из списка |
| Markdown-рендеринг | notes | Серверный рендер body, заголовок как plain text |
| Kanban-доска | tasks | Колонки с drag-and-drop между статусами; динамические колонки из settings (`kanban_columns`); ручная сортировка в колонке |
| Drag-and-drop в календаре | calendar | Перенос встречи и изменение длительности мышью |
| Напоминания (fire_at + WS push) | calendar | fire_at + push клиенту |
| Недавние запросы | search-rag | Хранятся в localStorage (frontend) |
| Auto-export | sync | Заметки → `.md`-файлы на диск |
| Public API mirror | integrations | `/api/v1/notes\|tasks\|projects\|calendar` поверх webhook/API-key |

### P3 — AI-расширения

| Функция | Сервис | Описание |
|---|---|---|
| Dictation-диктовка | ai-gateway | Запись голоса → распознавание → AI-форматирование (body+title+tag) |
| Облачные модели | ai-gateway | Прокси до cloud API (OpenAI, Anthropic, Google) — сейчас только локальные (Ollama chain) |
| Триггер meeting_ended | agent | После встречи: предложить создать заметку |
| Триггер project_plan | agent | План проекта на основе goal |
| DND-окно + дневной лимит | agent | Не беспокоить в заданные часы; ≤ N сообщений в день |

## 3. Инфраструктура и качество (P2)

| Задача | Где | Описание |
|---|---|---|
| Pact-брокер (consumer-driven) | contracts | Заменить OpenAPI-conformance на Pact (ADR-002 §3 TODO, ADR-005) |
| DLQ-админ-панель | event-bus | Просмотр и replay сообщений dead letter queue (SAGA.md §TODO) |
| Perf: caching, query opt | все | Медленные запросы, N+1 (после появления реальной нагрузки) |
| Healthchecks в docker-compose | platform/docker | Graceful startup/shutdown для профиля `all` |
| mTLS между сервисами | platform | Опционально для production (ARCHITECTURE.md §Безопасность) |

## 4. Идеи (P3, нет владельца)

- Полнотекстовый поиск по вложениям (сейчас — только извлечённый текст файлов в pgvector).
- Шаблоны встреч/задач (аналог шаблонов заметок).
- Статистика и дашборды времени (time-tracking → агрегаты за период на UI).
- Локализация API-сообщений об ошибках.
- Rate limiting на api-gateway (nginx) для публичного API.

---

## Сводка

| Приоритет | Задач | Тип |
|---|---|---|
| P1 | 3 | UI-слой: SPA, E2E, desktop |
| P2 | 13 | Функциональные расширения + инфраструктура |
| P3 | 8 | AI-фичи и идеи |

Все backend-задачи P0–P4 из исходного плана миграции **выполнены** (см. `docs/REVIEW.md`,
`docs/SAGA.md`); исходный «план миграции 10-12 недель» более не актуален — репозиторий уже
работает как новый стек (strangler-фаза не потребовалась, монолит не входил в scope).
