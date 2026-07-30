# FEATURES.md — Полный каталог функций ЦУП (Personal OS)

## Видение

**ЦУП (Центр Управления Проектами)** — event-driven Personal OS, объединяющая заметки, задачи,
календарь, проекты, файлы, AI-ассистента, тайм-трекинг, email и внешние сервисы в единую
систему с контекстными профилями (Work / Home / Family / Friends).

**Для кого**: один человек (self-hosted single-user), который хочет управлять всеми аспектами
жизни из одного места: работа, дом, семья, проекты, финансы, время.

**Платформы**: веб (React SPA) + десктоп (Tauri WebView).

---

## Список сервисов и функций

### 1. profiles — Контекстные профили

Текущее состояние: ✅ есть в MVP

| | |
|---|---|
| **Назначение** | Разделение всех данных по контекстам: Work, Home, Family, Friends |
| **API** | `GET/POST/PATCH/DELETE /api/profiles` |
| **Сущности** | `profiles: { id, name, color, is_default, hidden }` |
| **События** | Публикует: `profiles.created`, `profiles.updated`, `profiles.deleted` |
| **Подписки** | — |
| **Зависимости** | — (Shared Kernel, читается всеми) |
| **Фронтенд** | ProfileChips, AgentSettings (модалка выбора цвета/имени/скрытия) |
| **Статус** | ✅ CRUD | ✅ выбор active profile | ✅ цветовая маркировка | ✅ скрытие профилей |

### 2. settings — Настройки приложения

| | |
|---|---|
| **Назначение** | Хранилище ключ-значение для любых настроек |
| **API** | `GET/POST /api/settings`, `GET /api/settings/ollama-models` |
| **Сущности** | `settings: { key, value }` |
| **События** | `settings.changed` |
| **Зависимости** | — (Shared Kernel, читается всеми) |
| **Фронтенд** | AgentSettings (все вкладки) |
| **Статус** | ✅ KV CRUD | ✅ Ollama models list |

### 3. notes — Заметки

| | |
|---|---|
| **Назначение** | Markdown-заметки с тегами, привязкой к проектам/встречам/задачам, AI-генерация заголовка и тега |
| **API** | `GET/POST/PATCH/DELETE /api/notes`, `PUT /api/notes/order`, `POST /api/notes/generate-title` |
| **Сущности** | `notes`, `templates`, `note_links` |
| **События** | Публикует: `notes.created`, `notes.updated`, `notes.deleted`, `notes.title_generated` |
| **Подписки** | `profiles.*` (для отображения имени профиля) |
| **Зависимости** | profiles (profile_ids), ai-gateway (generate-title) |
| **Фронтенд** | Notes (список + модалка + drag reorder + AI title), Archive |
| **Подфункции** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| CRUD заметок | ✅ | Markdown тело, теги, заголовок |
| Ручная сортировка | ✅ | Drag-and-drop переупорядочивание |
| Поиск по заметкам | ✅ | Через ILIKE body_md |
| AI-генерация заголовка | ✅ | POST /api/notes/generate-title → {title, tag} |
| Шаблоны | ✅ | Предустановленные шаблоны для новых заметок |
| Привязка к проекту | ✅ | linked_project_id |
| Привязка к встрече | ✅ | linked_meeting_id |
| Привязка к задаче | ✅ | linked_task_id |
| Фильтр по профилю | ✅ | profile_ids |
| Архивирование | ✅ | Мягкое удаление |
| Markdown-рендеринг | ✅ | На сервере, заголовок как plain text |
| Dictation-диктовка | ✅ | Запись голоса → распознавание → AI-форматирование |

### 4. tasks — Задачи

| | |
|---|---|
| **Назначение** | Kanban-задачи с рекурренсом, streaks, зависимостями, ранжированием приоритетов |
| **API** | `GET/POST/PATCH/DELETE /api/tasks`, `GET /api/priorities`, `PUT /api/priorities/order` |
| **Сущности** | `tasks`, `task_dependencies` |
| **События** | Публикует: `tasks.created`, `tasks.updated`, `tasks.deleted`, `tasks.status_changed`, `tasks.priorities_reordered` |
| **Подписки** | `profiles.*` |
| **Зависимости** | profiles (profile_ids, assignee), projects (project_id) |
| **Фронтенд** | Kanban (drag column/order), Priorities (ranked list), Timeline, Gantt, Archive |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| CRUD задач | ✅ | Статус, приоритет, вес, описание, assignee, дедлайн |
| Kanban-доска | ✅ | Колонки с drag-and-drop между статусами |
| Динамические колонки | ✅ | Настраиваются через settings (kanban_columns) |
| Ручная сортировка в колонке | ✅ | Drag-and-drop reorder |
| Рекуррентные задачи | ✅ | По расписанию, автозакрытие и создание новой |
| Streaks (серии) | ✅ | current_streak / best_streak |
| Зависимости задач | ✅ | task_dependencies: блокирующие задачи |
| Приоритеты (ранжирование) | ✅ | Вес + ручной ранг, сортированный список |
| Фильтр по профилю | ✅ | profile_ids |
| Фильтр по проекту | ✅ | project_id |
| Архивирование | ✅ | Мягкое удаление |

### 5. calendar — Встречи (локальный календарь)

| | |
|---|---|
| **Назначение** | Планирование встреч с рекурренсом, ICS экспорт/импорт |
| **API** | `GET/POST/PATCH/DELETE /api/calendar`, `GET /api/calendar/:id/ics` |
| **Сущности** | `meetings`, `reminders` |
| **События** | Публикует: `meetings.created`, `meetings.updated`, `meetings.deleted`, `meetings.reminder` |
| **Подписки** | `profiles.*` |
| **Зависимости** | profiles (profile_ids), projects (linked_project_id) |
| **Фронтенд** | Calendar (day/week grid, drag resize/move), Timeline (конфликты) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| CRUD встреч | ✅ | Название, время, all-day, описание, место |
| Рекуррентные встречи | ✅ | Правило recurrence (freq, interval, until) |
| ICS экспорт | ✅ | GET /api/calendar/:id/ics → .ics файл |
| Drag-and-drop в календаре | ✅ | Перенос и изменение длительности |
| Напоминания | ✅ | fire_at + WebSocket push |
| Фильтр по профилю | ✅ | profile_ids |
| Привязка к проекту | ✅ | linked_project_id |

### 6. projects — Проекты

| | |
|---|---|
| **Назначение** | Группировка заметок, задач, встреч и файлов в проекты с Gantt-диаграммой |
| **API** | `GET/POST/PATCH/DELETE /api/projects`, `GET /api/projects/:id/items`, `GET /api/projects/:id/gantt` |
| **Сущности** | `projects` |
| **События** | Публикует: `projects.created`, `projects.updated`, `projects.deleted` |
| **Подписки** | `notes.*`, `tasks.*`, `meetings.*`, `files.*` (для актуализации items) |
| **Зависимости** | profiles (profile_ids) |
| **Фронтенд** | Projects (список + dashboard), Gantt |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| CRUD проектов | ✅ | Название, описание, статус, цель, даты |
| Dashboard проекта | ✅ | GET /api/projects/:id/items → {notes, tasks, meetings, files} |
| Gantt-диаграмма | ✅ | Frappe Gantt, задачи с датами и зависимостями |
| Drag-to-reschedule в Gantt | ✅ | Изменение дат перетаскиванием |
| Привязка профилей | ✅ | profile_ids |

### 7. files — Файлы

| | |
|---|---|
| **Назначение** | Загрузка, хранение, извлечение текста, семантическая индексация файлов |
| **API** | `GET/POST/PATCH/DELETE /api/files`, `GET /api/files/:id/download` |
| **Сущности** | `file_meta` |
| **События** | Публикует: `files.uploaded`, `files.updated`, `files.deleted`, `files.text_extracted` |
| **Подписки** | `profiles.*` |
| **Зависимости** | profiles (profile_ids) |
| **Фронтенд** | Files (список + загрузка), Projects (items dashboard) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| Загрузка файлов | ✅ | Multipart upload, лимит 50MB |
| Скачивание | ✅ | GET /api/files/:id/download |
| Извлечение текста | ✅ | Для .txt, .md — прямой текст |
| Метаданные | ✅ | filename, mime, size, owner_type/id, uploaded_at |
| Привязка к проекту | ✅ | owner_type/owner_id (polymorphic) |
| Привязка профилей | ✅ | profile_ids |

### 8. search-rag — Поиск и RAG

| | |
|---|---|
| **Назначение** | Полнотекстовый (ILIKE) и семантический (embedding) поиск по всем сущностям |
| **API** | `POST /api/search` |
| **Сущности** | `embeddings` (векторное хранилище, pgvector) |
| **События** | — (только читает) |
| **Подписки** | `notes.*`, `tasks.*`, `meetings.*`, `files.*` (строит embedding index из событий) |
| **Зависимости** | notes, tasks, calendar, files (данные для индексации) |
| **Фронтенд** | Search (поле ввода + результаты с фильтрами) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| Текстовый поиск (ILIKE) | ✅ | PostgreSQL ILIKE по body_md, title, description, extracted_text |
| Семантический поиск | ✅ | Ollama embedding (nomic-embed-text) + cosine similarity |
| Фильтры: тип | ✅ | note/task/meeting/file |
| Фильтры: тег | ✅ | tags |
| Фильтры: проект | ✅ | project_id |
| Фильтры: профиль | ✅ | profile_ids |
| Недавние запросы | ✅ | Хранятся в localStorage |
| Graceful degradation | ✅ | Если Ollama недоступен — ILIKE fallback |

### 9. ai-gateway — AI Gateway

| | |
|---|---|
| **Назначение** | Единый прокси к LLM с fallback chain |
| **API** | `POST /api/ai/restore-punctuation`, `POST /api/ai/dictate` |
| **Сущности** | `ai_log` (логирование запросов) |
| **События** | Публикует: `dictation.completed`, `punctuation.restored` |
| **Подписки** | — (синхронный request-reply) |
| **Зависимости** | settings (gen_model, embed_model) |
| **Фронтенд** | Notes (dictation → dictate), DictationTest |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| Dictation (текст → body+title+tag) | ✅ | Ollama: парсинг ТЕЛО: и ЗАГОЛОВОК: из ответа |
| Restore punctuation | ✅ | Восстановление пунктуации в тексте |
| Fallback chain | ✅ | DB setting → env → hardcoded модель |
| Timeout | ✅ | 60s timeout на модель, переключение на следующую |
| Regex-парсинг ответа | ✅ | `/^ТЕЛ[ОА]:\s*(.*)/is` |
| Модели: Ollama | ✅ | Локальные GGUF, MLX |
| Модели: облачные | 📋 | Прокси до cloud API (OpenAI, Anthropic, Google) |

### 10. agent — AI-ассистент

| | |
|---|---|
| **Назначение** | Автоматические триггеры, дайджесты, инбокс с suggested actions |
| **API** | `GET /api/agent/inbox`, `POST /api/agent/respond`, `POST /api/agent/dismiss-all`, `GET /api/today`, `GET /api/week` |
| **Сущности** | `agent_messages`, `agent_runs` |
| **События** | Публикует: `agent.message_created`, `agent.trigger_evaluated` |
| **Подписки** | `notes.*`, `tasks.*`, `meetings.*`, `profiles.*` |
| **Зависимости** | notes, tasks, calendar, ai-gateway (для генерации рекомендаций) |
| **Фронтенд** | AgentInbox (список сообщений + accept/reject), Digests (today/week) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| Daily digest | ✅ | Утром: сводка встреч и задач на сегодня |
| Weekly digest | ✅ | Сводка на неделю |
| Inbox сообщений | ✅ | Список с действиями (accept/reject/reply) |
| Триггер: meeting_ended | ✅ | После встречи: предложение создать заметку |
| Триггер: deadline_soon | ✅ | За N часов до дедлайна: напоминание |
| Триггер: task_no_assignee | ✅ | Неназначенные задачи в проекте |
| Триггер: project_plan | ✅ | План проекта на основе goal |
| DND-окно | ✅ | Не беспокоить в заданные часы |
| Дневной лимит | ✅ | Не более N сообщений в день |
| WebSocket push | ✅ | Новое сообщение → WS → клиент |

### 11. email — IMAP Email

| | |
|---|---|
| **Назначение** | Подключение email-аккаунтов по IMAP, синхронизация писем, конвертация в заметки/задачи |
| **API** | `GET/POST/PATCH/DELETE /api/imap`, `POST /api/imap/:id/sync`, `GET/PATCH /api/imap/emails` |
| **Сущности** | `imap_accounts`, `emails` |
| **События** | Публикует: `email.synced`, `email.converted_to_note`, `email.converted_to_task` |
| **Подписки** | `profiles.*` |
| **Зависимости** | notes, tasks (для конвертации) |
| **Фронтенд** | EmailInbox (список писем, аккаунты, синхронизация) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| IMAP аккаунты CRUD | ✅ | Хост, порт, SSL, username, encrypted password |
| Синхронизация писем | ✅ | По расписанию + вручную |
| Конвертация → note | ✅ | Создание заметки из письма |
| Конвертация → task | ✅ | Создание задачи из письма |
| Фильтр писем | ✅ | По аккаунту, профилю, архиву |

### 12. external-calendars — Внешние календари

| | |
|---|---|
| **Назначение** | Синхронизация с Google Calendar, Yandex Calendar, ICS URLs |
| **API** | CRUD `/api/calendars`, `POST /api/calendars/sync/:id`, `GET /api/calendars/:id/events`, `PATCH /api/calendars/events/:id/link`, Google OAuth, Yandex connect |
| **Сущности** | `external_calendars`, `external_events` |
| **События** | Публикует: `external_calendar.synced`, `external_event.linked` |
| **Подписки** | — |
| **Зависимости** | calendar (linked_meeting_id) |
| **Фронтенд** | Calendar (оверлей внешних событий) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| Google Calendar OAuth | ✅ | Auth flow + token refresh |
| Yandex Calendar (CalDAV) | ✅ | Basic auth + CalDAV sync |
| ICS URL | ✅ | Парсинг .ics по URL |
| CRUD календарей | ✅ | display_name, sync_enabled |
| Синхронизация | ✅ | GET /api/calendars/sync/:id |
| Связывание событий | ✅ | external_event → linked_meeting |

### 13. integrations — Webhooks + API Keys

| | |
|---|---|
| **Назначение** | Публичный API (v1), webhook-уведомления, API-ключи для внешних интеграций |
| **API** | CRUD `/api/webhooks`, `GET /api/webhooks/:id/deliveries`, CRUD `/api/api-keys`, public API `/api/v1/*` |
| **Сущности** | `api_keys`, `webhooks`, `webhook_deliveries` |
| **События** | Публикует: — (вызывает webhook при получении событий) |
| **Подписки** | `notes.*`, `tasks.*`, `meetings.*`, `files.*`, `projects.*`, `agent.message_created` |
| **Зависимости** | Все сервисы (читает события) |
| **Фронтенд** | ApiSettings, WebhookSettings |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| API keys CRUD | ✅ | SHA256 Bearer token |
| Webhook CRUD | ✅ | URL + events + secret |
| Webhook delivery | ✅ | POST на URL, логирование |
| Retry with backoff | ✅ | 1min → 5min → 15min → 1h → 6h, max 5 |
| Dead letter | ✅ | После 5 неудач — остановка |
| Public API mirror | ✅ | /api/v1/notes|tasks|projects|calendar |

### 14. time-tracking — Тайм-трекинг

| | |
|---|---|
| **Назначение** | Учёт времени: timesheet (лог) и pomodoro (сессии) |
| **API** | CRUD `/api/timesheet`, `GET /api/timesheet/stats`, CRUD `/api/pomodoro` |
| **Сущности** | `timesheet`, `pomodoro_sessions` |
| **События** | (лог, без внешних событий) |
| **Подписки** | `tasks.*` (для привязки задачи) |
| **Зависимости** | tasks (task_id) |
| **Фронтенд** | Timesheet (лог + таймер + статистика), PomodoroWidget (3 режима) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| Timesheet CRUD | ✅ | Запись времени по задачам |
| Статистика | ✅ | today_total, week_total, by_task, by_project |
| Pomodoro-сессии | ✅ | 3 режима: Pomodoro / Flowtime / Countdown |
| Привязка к задаче | ✅ | task_id |

### 15. export-import — Экспорт и Импорт

| | |
|---|---|
| **Назначение** | Полный экспорт всех данных (ZIP) и импорт из текста/JSON |
| **API** | `GET /api/export` (ZIP), `POST /api/import` |
| **Сущности** | export_jobs (лог экспорта) |
| **События** | — |
| **Подписки** | Все сервисы (для чтения данных при экспорте) |
| **Зависимости** | Все сервисы |
| **Фронтенд** | Import, Archive |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| ZIP экспорт | ✅ | notes/*.md + tasks.json + projects.json + calendar.ics + files/ |
| Импорт текста | ✅ | Создание заметки из plain text |
| Импорт JSON | ✅ | Пакетный импорт в notes/tasks/calendar |

### 16. sync — Синхронизация папок

| | |
|---|---|
| **Назначение** | Obsidian-style синхронизация с файловой системой |
| **API** | CRUD `/api/sync-folders` |
| **Сущности** | `sync_folders` |
| **События** | (лог синхронизации) |
| **Подписки** | `notes.*`, `files.*` (для автоэкспорта) |
| **Зависимости** | notes, files |
| **Фронтенд** | AgentSettings (Sync Folders подсекция) |
| **Статус** | |

| Функция | Статус | Описание |
|---------|--------|----------|
| CRUD папок | ✅ | path, auto_import, auto_export |
| Сканирование | ✅ | last_scan_at, периодическая проверка |
| Auto-import | ✅ | .md файлы → заметки |
| Auto-export | ✅ | Заметки → .md файлы на диск |

### 17. api-gateway — Единый вход

| | |
|---|---|
| **Назначение** | Маршрутизация, аутентификация, rate limiting, статика |
| **Компоненты** | nginx, статические файлы SPA |
| **События** | — |
| **Подписки** | Все события для WS push |
| **Зависимости** | Все сервисы |
| **Статус** | ✅ (nginx уже работает) |

### 18. event-bus — Шина событий

| | |
|---|---|
| **Назначение** | Межсервисная асинхронная коммуникация |
| **Компоненты** | NATS JetStream, SDK (publish/subscribe wrapper) |
| **События** | Все события из Event Catalog |
| **Зависимости** | — (инфраструктура) |
| **Статус** | 📋 запланировано |

### 19. shared-types — Общие типы

| | |
|---|---|
| **Назначение** | Пакет `@pmos/shared` с интерфейсами, event schemas, DTO, branded types |
| **Статус** | 📋 запланировано |

---

## Матрица событий

| Сервис-издатель | Событие | Подписчики |
|----------------|---------|-----------|
| **profiles** | `profiles.created` | notes, tasks, calendar, projects, files, search-rag, agent, export-import |
| | `profiles.updated` | same |
| | `profiles.deleted` | same |
| **settings** | `settings.changed` | api-gateway, all (при старте) |
| **notes** | `notes.created` | search-rag, agent, export-import, sync, integrations |
| | `notes.updated` | search-rag, agent, export-import, sync |
| | `notes.deleted` | search-rag, files, integrations |
| | `notes.title_generated` | api-gateway (WS to client) |
| **tasks** | `tasks.created` | search-rag, agent, projects, time-tracking, integrations |
| | `tasks.updated` | search-rag, agent, projects, time-tracking |
| | `tasks.deleted` | search-rag, projects, integrations |
| | `tasks.status_changed` | agent, time-tracking, projects |
| **calendar** | `meetings.created` | search-rag, agent, projects, integrations |
| | `meetings.updated` | search-rag, agent, projects |
| | `meetings.deleted` | search-rag, projects |
| | `meetings.reminder` | api-gateway (WS push) |
| **projects** | `projects.created` | agent, integrations |
| | `projects.updated` | agent |
| | `projects.deleted` | agent |
| **files** | `files.uploaded` | search-rag (embeddings) |
| | `files.updated` | search-rag |
| | `files.deleted` | search-rag |
| | `files.text_extracted` | search-rag |
| **ai-gateway** | `dictation.completed` | agent (лог), api-gateway (WS) |
| | `punctuation.restored` | api-gateway (WS) |
| **agent** | `agent.message_created` | api-gateway (WS push), integrations (webhook) |
| | `agent.trigger_evaluated` | — (лог) |

---

## Матрица данных

| Сущность | Сервис-владелец | Кто читает | Как читает |
|----------|----------------|------------|-----------|
| profiles | profiles | Все сервисы | Через событие при старте / кэш |
| notes | notes | search-rag, agent, projects | Событие `notes.*` |
| tasks | tasks | search-rag, agent, projects, time-tracking | Событие `tasks.*` |
| meetings | calendar | search-rag, agent, projects | Событие `meetings.*` |
| projects | projects | agent, calendar, notes | Событие `projects.*` |
| file_meta | files | search-rag, projects | Событие `files.*` |
| embeddings | search-rag | search-rag | Только свой сервис |
| settings | settings | Все (Shared Kernel) | Прямой запрос при старте / кэш |
| agent_messages | agent | — | Только свой сервис |
| api_keys | integrations | — | Только свой сервис |
| webhooks | integrations | — | Только свой сервис |
| imap_accounts | email | — | Только свой сервис |
| timesheet | time-tracking | — | Только свой сервис |

---

## Фронтенд

| View | Сервисы | Описание |
|------|---------|----------|
| Notes | notes, ai-gateway, projects, profiles, templates | CRUD, reorder, AI title, dictation |
| Kanban | tasks, projects, settings, profiles | Доска с drag-and-drop |
| Calendar | calendar, external-calendars, projects, profiles | Сетка день/неделя |
| Projects | projects, notes, tasks, calendar, files | Список + dashboard |
| Files | files, projects, profiles | Список + загрузка |
| Priorities | tasks, profiles | Ранжированный список |
| Timeline | calendar, tasks, notes (через timeline API) | Лента + конфликты |
| Gantt | projects, tasks | Gantt-диаграмма |
| Timesheet | time-tracking, tasks | Лог + статистика |
| Pomodoro | time-tracking | Таймер |
| AgentInbox | agent | Сообщения + действия |
| EmailInbox | email, tasks, notes | Письма |
| Digests | agent, calendar, tasks | Сегодня / неделя |
| Search | search-rag | Поиск с фильтрами |
| Analytics | calendar, tasks, notes, projects | Статистика |
| ApiSettings | integrations | API ключи |
| WebhookSettings | integrations | Webhook подписки |
| Archive | notes, tasks, calendar | Архив / восстановление |
| Import | export-import | Импорт |
| DictationTest | ai-gateway | Dev-тест диктовки |
