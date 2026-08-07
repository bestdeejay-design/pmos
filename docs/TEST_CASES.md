# Test Cases — Gherkin-сценарии для сервисов ЦУП

> Документ содержит конкретные Given-When-Then сценарии для unit, integration и contract тестов.
> Формат: **Gherkin** (`Given ... When ... Then ...`).
> Инструмент: **Vitest** (unit + integration), **OpenAPI-conformance** (contract, из `contracts/`), **Playwright** (E2E).
> Покрытие: **все CRUD-сервисы** (§1–§16) + ops (§18.2 health) + cross-service саги (§17) + инфраструктура (§18–§19).

---

## 0. Anti-patterns — что ОБЯЗАН ловить тест (иначе сервис сломан)

Эти сценарии НЕ в Gherkin-формате ниже, но покрываются автоматически через
`contracts/test/helper.ts` (`assertRoutesMatch` + `hasRoute()` guard) и `pnpm -r typecheck`.
Агент обязан держать их зелёными перед каждым пушем (см. AGENT.md §7.1).

### 0.1 Fastify path-param trap (`{id}` vs `:id`)

Если в `routes/index.ts` написано `app.get("/notes/{id}")`, Fastify трактует `{id}` как
**буквальный сегмент**, и любой реальный запрос `/notes/<uuid>` возвращает **404 на runtime**,
хотя contract-тест по `printRoutes`-парсингу проходит (там `{id}`→`:id` конвертируется).
Это тихий баг, стоивший полного цикла отладки на calendar.

**Гард:** `assertRoutesMatch` вызывает `app.hasRoute({ method, url: fastifyPath })` для каждого
strict-CRUD роута. Если `:id`-вариант не матчится → тест ПАДАЕТ. Значит, баг `{id}` больше
не проскакивает незамеченным.

```gherkin
Scenario: Строгий CRUD-роут матчится на runtime (hasRoute guard)
  Given routes/index.ts сервиса X содержит эндпоинт "GET /x/:id"
  When запущен contract-тест для сервиса X
  Then app.hasRoute({ method: "GET", url: "/api/X/v1/x/:id" }) возвращает true
    And тест НЕ падает с "route not registered / not matched"
```

### 0.2 Timestamp тип (`new Date()` vs `.toISOString()`)

Все `timestamp`-колонки Drizzle имеют `mode: "string"`. Установка `updatedAt: new Date()`
даёт `Date`-объект → TS-ошибка на typecheck И неверный wire-тип. Только `.toISOString()`.

### 0.3 Contract-first для новых эндпоинтов

Любой эндпоинт вне `contracts/openapi/<svc>.yaml` → нельзя реализовывать (ADR-007 §8 R4).
Новые фичи (напр. `POST /notes/generate-title`, `PUT /notes/order`, `GET /notes?q=`) сначала
добавляются в контракт, затем в роуты, затем покрываются contract-тестом.

### 0.4 Обязательный набор проверок (commit gate)

```bash
pnpm -r run typecheck                 # strict — ловит :id / Date / регрессии типов
pnpm --filter './services/*' run build       # 16 CRUD сервисов
pnpm --filter './services/*' run test:contract # 17/17 — hasRoute()-гард активен
pnpm --filter './services/*' run test         # unit (health)
```

---

## 1. profiles — Контекстные профили

### 1.1 Happy path: создание, чтение, обновление, удаление профиля

```gherkin
Scenario: Создать новый профиль и прочитать его
  Given сервис profiles запущен
  When клиент отправляет POST /api/profiles с телом
    | name       | "Work"      |
    | color      | "#4A90D9"   |
    | is_default | false       |
    | hidden     | false       |
  Then сервис возвращает 201 Created
    And тело ответа содержит profile.id (UUID)
    And profile.name равен "Work"
    And profile.color равен "#4A90D9"
    And profile.is_default равен false
    And опубликовано событие profiles.created
    And событие содержит profileId созданного профиля
```

```gherkin
Scenario: Обновить имя существующего профиля
  Given существует профиль с id = "p1" и name = "Work"
  When клиент отправляет PATCH /api/profiles/p1 с телом { "name": "Office" }
  Then сервис возвращает 200 OK
    And profile.name равен "Office"
    And profile.color не изменился
    And опубликовано событие profiles.updated
```

```gherkin
Scenario: Удалить профиль
  Given существует профиль с id = "p1"
  When клиент отправляет DELETE /api/profiles/p1
  Then сервис возвращает 204 No Content
    And GET /api/profiles/p1 возвращает 404 Not Found
    And опубликовано событие profiles.deleted
```

### 1.2 Validation error: отсутствует обязательное поле

```gherkin
Scenario: Создать профиль без name
  When клиент отправляет POST /api/profiles с телом { "color": "#4A90D9" }
  Then сервис возвращает 422 Unprocessable Entity
    And тело ошибки содержит "name" в списке обязательных полей
    And профиль НЕ создан
    And событие profiles.created НЕ опубликовано
```

### 1.3 Not found: несуществующий профиль

```gherkin
Scenario: Запросить несуществующий профиль
  When клиент отправляет GET /api/profiles/00000000-0000-0000-0000-000000000000
  Then сервис возвращает 404 Not Found
    And тело ошибки содержит message "Profile not found"
```

```gherkin
Scenario: Обновить несуществующий профиль
  When клиент отправляет PATCH /api/profiles/00000000-0000-0000-0000-000000000000 с телом { "name": "Ghost" }
  Then сервис возвращает 404 Not Found
```

### 1.4 Business rule: нельзя удалить единственный или дефолтный профиль

```gherkin
Scenario: Удалить профиль, который помечен is_default = true
  Given существует профиль с id = "p1" и is_default = true
  When клиент отправляет DELETE /api/profiles/p1
  Then сервис возвращает 409 Conflict
    And тело ошибки содержит "Cannot delete default profile"
    And профиль остаётся в БД
```

### 1.5 Edge case: цвет в разных форматах

```gherkin
Scenario: Создать профиль с некорректным hex-цветом
  When клиент отправляет POST /api/profiles с телом
    | name  | "Invalid" |
    | color | "not-a-color" |
  Then сервис возвращает 422 Unprocessable Entity
    And тело ошибки содержит "color" с описанием валидного формата (#RRGGBB)
```

```gherkin
Scenario: Имя профиля с максимальной длиной
  Given максимальная длина name = 100 символов
  When клиент отправляет POST /api/profiles с name = "A" × 100
  Then сервис возвращает 201 Created
  When клиент отправляет POST /api/profiles с name = "A" × 101
  Then сервис возвращает 422 Unprocessable Entity
```

---

## 2. notes — Заметки

### 2.1 Happy path: CRUD заметки

```gherkin
Scenario: Создать заметку с телом и тегами
  Given существует профиль с id = "p1"
  When клиент отправляет POST /api/notes с телом
    | body_md    | "# Привет\nЭто моя заметка" |
    | tags       | ["life", "journal"]          |
    | profile_ids| ["p1"]                       |
  Then сервис возвращает 201 Created
    And note.id — UUID
    And note.body_md равен "# Привет\nЭто моя заметка"
    And note.tags содержит ["life", "journal"]
    And note.title пуст (будет заполнен AI)
    And опубликовано событие notes.created
```

```gherkin
Scenario: Прочитать заметку по ID
  Given существует заметка с id = "n1" и title = "Мой день"
  When клиент отправляет GET /api/notes/n1
  Then сервис возвращает 200 OK
    And note.title равен "Мой день"
    And note.body_md не пуст
```

```gherkin
Scenario: Обновить тело и теги заметки
  Given существует заметка с id = "n1"
  When клиент отправляет PATCH /api/notes/n1 с телом
    | body_md | "Новый текст" |
    | tags    | ["updated"]   |
  Then сервис возвращает 200 OK
    And note.body_md равен "Новый текст"
    And note.tags равен ["updated"]
    And note.updated_at изменился
    And опубликовано событие notes.updated
```

```gherkin
Scenario: Удалить заметку
  Given существует заметка с id = "n1"
  When клиент отправляет DELETE /api/notes/n1
  Then сервис возвращает 204 No Content
    And GET /api/notes/n1 возвращает 404 Not Found
    And опубликовано событие notes.deleted
```

### 2.2 Validation error

```gherkin
Scenario: Создать заметку без body_md
  When клиент отправляет POST /api/notes с телом { "tags": ["test"] }
  Then сервис возвращает 422
    And тело ошибки содержит "body_md"
```

### 2.3 Not found

```gherkin
Scenario: Обновить несуществующую заметку
  When клиент отправляет PATCH /api/notes/00000000-0000-0000-0000-000000000000 с телом { "body_md": "x" }
  Then сервис возвращает 404
```

### 2.4 Business rule: сортировка заметок

```gherkin
Scenario: Переупорядочить заметки через PUT /api/notes/order
  Given существуют заметки с id = "n1", "n2", "n3"
  When клиент отправляет PUT /api/notes/order с телом { "order": ["n3", "n1", "n2"] }
  Then сервис возвращает 200 OK
    And GET /api/notes возвращает заметки в порядке n3 → n1 → n2
```

### 2.5 Edge case

```gherkin
Scenario: Создать заметку с очень длинным телом (>100KB)
  Given тело размером 150KB
  When клиент отправляет POST /api/notes с body_md = очень длинный текст
  Then сервис возвращает 413 Payload Too Large
    ИЛИ сервис возвращает 201 Created (если лимит >150KB)
```

```gherkin
Scenario: Теги с пробелами и спецсимволами
  When клиент отправляет POST /api/notes с телом
    | body_md | "Тег с пробелами" |
    | tags    | ["my tag!", "tag/one", "русский_тег"] |
  Then сервис возвращает 201 Created
    And note.tags содержит ["my tag!", "tag/one", "русский_тег"]
```

### 2.6 Contract: событие notes.created при создании

```gherkin
Scenario: Проверить формат события notes.created (Pact)
  Given notes-service запущен
  When создаётся заметка с телом "Test body" и profile_ids = ["p1"]
  Then событие notes.created опубликовано в NATS
    And событие имеет корректную структуру:
    | поле          | ожидание                              |
    | id            | UUID v4                               |
    | type          | "notes.created"                       |
    | source        | "notes"                               |
    | timestamp     | ISO 8601                              |
    | data.noteId   | UUID                                  |
    | data.bodyMd   | "Test body"                           |
    | correlationId | UUID                                  |
```

---

## 3. tasks — Задачи

### 3.1 Happy path: CRUD задачи

```gherkin
Scenario: Создать задачу со статусом и дедлайном
  Given существует профиль с id = "p1"
  When клиент отправляет POST /api/tasks с телом
    | title       | "Купить продукты"       |
    | status      | "todo"                  |
    | priority    | 3                       |
    | deadline    | "2026-08-15T18:00:00Z"  |
    | profile_ids | ["p1"]                  |
  Then сервис возвращает 201 Created
    And task.title равен "Купить продукты"
    And task.status равен "todo"
    And опубликовано событие tasks.created
```

```gherkin
Scenario: Закрыть задачу (статус → done)
  Given существует задача с id = "t1" и status = "in_progress"
  When клиент отправляет PATCH /api/tasks/t1 с телом { "status": "done" }
  Then сервис возвращает 200 OK
    And task.status равен "done"
    And task.completed_at — не null, ISO 8601
    And опубликовано событие tasks.status_changed
    And событие содержит oldStatus = "in_progress" и newStatus = "done"
```

### 3.2 Validation error

```gherkin
Scenario: Создать задачу без title
  When клиент отправляет POST /api/tasks с телом { "status": "todo" }
  Then сервис возвращает 422
    And тело ошибки содержит "title"
```

```gherkin
Scenario: Некорректный статус задачи
  When клиент отправляет POST /api/tasks с телом
    | title  | "Test"      |
    | status | "unknown_status" |
  Then сервис возвращает 422
    And тело ошибки содержит "status" с перечислением допустимых значений
```

### 3.3 Not found

```gherkin
Scenario: Закрыть несуществующую задачу
  When клиент отправляет PATCH /api/tasks/00000000-0000-0000-0000-000000000000 с телом { "status": "done" }
  Then сервис возвращает 404
```

### 3.4 Business rule: зависимости блокируют закрытие

```gherkin
Scenario: Закрыть задачу, у которой есть незакрытая блокирующая задача
  Given существует задача t1 (status = "in_progress")
    And существует задача t2 (status = "todo")
    And задача t1 зависит от t2 через task_dependencies
  When клиент отправляет PATCH /api/tasks/t1 с телом { "status": "done" }
  Then сервис возвратает 409 Conflict
    And тело ошибки содержит "Blocked by tasks"
    And task.status остаётся "in_progress"
```

```gherkin
Scenario: Рекуррентная задача создаёт новую после закрытия
  Given существует задача t1 с recurrence = "FREQ=DAILY" и status = "in_progress"
  When клиент отправляет PATCH /api/tasks/t1 с телом { "status": "done" }
  Then сервис возвращает 200
    And в БД появилась новая задача t2 с recurrence = "FREQ=DAILY" и status = "todo"
    And t2.dueDate = today + 1 day
```

### 3.5 Edge case

```gherkin
Scenario: Дедлайн в прошлом при создании
  When клиент отправляет POST /api/tasks с телом
    | title    | "Past task"                 |
    | deadline | "2020-01-01T00:00:00Z"      |
  Then сервис возвращает 201 Created (можно создать задачу с просроченным дедлайном)
    ИЛИ сервис возвращает 422 (если бизнес-правило запрещает)

Scenario: Пустой заголовок задачи
  When клиент отправляет POST /api/tasks с телом { "title": "", "status": "todo" }
  Then сервис возвращает 422
```

---

## 4. calendar — Встречи

### 4.1 Happy path: CRUD встречи

```gherkin
Scenario: Создать встречу с временем и описанием
  Given существует профиль с id = "p1"
  When клиент отправляет POST /api/calendar с телом
    | title       | "Sprint Planning"                    |
    | start_time  | "2026-08-01T10:00:00Z"              |
    | end_time    | "2026-08-01T11:00:00Z"              |
    | description | "Weekly sprint planning"            |
    | location    | "Room 301"                           |
    | profile_ids | ["p1"]                               |
  Then сервис возвращает 201 Created
    And meeting.title равен "Sprint Planning"
    And опубликовано событие meetings.created
```

```gherkin
Scenario: Обновить время встречи
  Given существует встреча с id = "m1" и start_time = 2026-08-01T10:00:00Z
  When клиент отправляет PATCH /api/calendar/m1 с телом
    | start_time | "2026-08-01T14:00:00Z" |
  Then сервис возвращает 200 OK
    And meeting.start_time равен "2026-08-01T14:00:00Z"
    And опубликовано событие meetings.updated
```

### 4.2 Validation error

```gherkin
Scenario: Создать встречу где end_time раньше start_time
  When клиент отправляет POST /api/calendar с телом
    | title      | "Backwards"                  |
    | start_time | "2026-08-01T11:00:00Z"       |
    | end_time   | "2026-08-01T10:00:00Z"       |
  Then сервис возвращает 422
    And тело ошибки содержит "end_time must be after start_time"
```

### 4.3 Not found

```gherkin
Scenario: Удалить несуществующую встречу
  When клиент отправляет DELETE /api/calendar/00000000-0000-0000-0000-000000000000
  Then сервис возвращает 404
```

### 4.4 Business rule: рекуррентная встреча

```gherkin
Scenario: Создать рекуррентную встречу с правилом weekly
  When клиент отправляет POST /api/calendar с телом
    | title      | "Weekly standup"                      |
    | start_time | "2026-08-01T09:00:00Z"                |
    | end_time   | "2026-08-01T09:15:00Z"                |
    | recurrence | "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10" |
  Then сервис возвращает 201 Created
    And GET /api/calendar возвращает 10 экземпляров встречи
    And каждый экземпляр имеет правильный день недели
```

```gherkin
Scenario: Обнаружение пересечения встреч (конфликт)
  Given существуют встречи:
    | id | start               | end                 |
    | m1 | 2026-08-01T10:00:00Z | 2026-08-01T11:00:00Z |
  When клиент отправляет POST /api/calendar с телом
    | title      | "Conflict meeting"              |
    | start_time | "2026-08-01T10:30:00Z"          |
    | end_time   | "2026-08-01T11:30:00Z"          |
  Then сервис возвращает 201 Created
    And ответ содержит warning о пересечении с встречей m1
```

### 4.5 Edge case

```gherkin
Scenario: All-day встреча
  When клиент отправляет POST /api/calendar с телом
    | title    | "Holiday"  |
    | date     | "2026-12-31" |
    | all_day  | true          |
  Then сервис возвращает 201 Created
    And meeting.all_day равен true
    And meeting.start_time = "2026-12-31T00:00:00Z"
    And meeting.end_time = "2026-12-31T23:59:59Z"
```

```gherkin
Scenario: ICS экспорт встречи
  Given существует встреча с id = "m1"
  When клиент отправляет GET /api/calendar/m1/ics
  Then сервис возвращает 200 OK
    And Content-Type равен "text/calendar"
    And тело содержит BEGIN:VCALENDAR и BEGIN:VEVENT
    And тело содержит UID встречи
    And тело содержит SUMMARY и DTSTART встречи
```

---

## 5. projects — Проекты

### 5.1 Happy path: CRUD проекта

```gherkin
Scenario: Создать проект с целью и статусом
  Given существует профиль с id = "p1"
  When клиент отправляет POST /api/projects с телом
    | name         | "Website Redesign"          |
    | description  | "Redesign company website"  |
    | goal         | "Launch by Q4"              |
    | status       | "active"                    |
    | profile_ids  | ["p1"]                      |
  Then сервис возвращает 201 Created
    And project.name равен "Website Redesign"
    And опубликовано событие projects.created
```

### 5.2 Validation error

```gherkin
Scenario: Создать проект без названия
  When клиент отправляет POST /api/projects с телом { "status": "active" }
  Then сервис возвращает 422
```

### 5.3 Not found

```gherkin
Scenario: Запросить dashboard несуществующего проекта
  When клиент отправляет GET /api/projects/00000000-0000-0000-0000-000000000000/items
  Then сервис возвращает 404
```

### 5.4 Business rule: проект собирает связанные сущности

```gherkin
Scenario: Dashboard проекта содержит заметки, задачи и встречи
  Given существует проект с id = "pr1"
    And существует заметка n1 с linked_project_id = "pr1"
    And существует задача t1 с project_id = "pr1"
    And существует встреча m1 с linked_project_id = "pr1"
  When клиент отправляет GET /api/projects/pr1/items
  Then сервис возвращает 200 OK
    And body.notes содержит заметку n1
    And body.tasks содержит задачу t1
    And body.meetings содержит встречу m1
```

### 5.5 Edge case

```gherkin
Scenario: Gantt-диаграмма для проекта без задач
  Given существует проект с id = "pr1"
    And в проекте нет задач с датами
  When клиент отправляет GET /api/projects/pr1/gantt
  Then сервис возвращает 200 OK
    And body.tasks — пустой массив
```

```gherkin
Scenario: Удалить проект с привязанными сущностями
  Given существует проект pr1
    And к нему привязана заметка n1 (linked_project_id = "pr1")
  When клиент отправляет DELETE /api/projects/pr1
  Then сервис возвращает 204 No Content
    And заметка n1 существует, её linked_project_id = null (каскадный null)
```

---

## 6. files — Файлы

### 6.1 Happy path: загрузка, чтение, извлечение текста, удаление

```gherkin
Scenario: Загрузить текстовый файл
  Given существует профиль с id = "p1"
  When клиент отправляет POST /api/files с multipart/form-data
    | file        | "notes.txt" (content: "Hello World") |
    | profile_ids | ["p1"]                               |
  Then сервис возвращает 201 Created
    And file_meta.filename равен "notes.txt"
    And file_meta.mimeType равен "text/plain"
    And file_meta.size > 0
    And опубликовано событие files.uploaded
```

```gherkin
Scenario: Скачать загруженный файл
  Given существует файл с id = "f1" и filename = "notes.txt"
  When клиент отправляет GET /api/files/f1/download
  Then сервис возвращает 200 OK
    And Content-Disposition содержит "notes.txt"
    And Content-Type равен "text/plain"
    And тело равно содержимому файла
```

```gherkin
Scenario: Удалить файл
  Given существует файл с id = "f1"
  When клиент отправляет DELETE /api/files/f1
  Then сервис возвращает 204
    And файл удалён с диска
    And опубликовано событие files.deleted
```

### 6.2 Validation error

```gherkin
Scenario: Загрузить файл больше лимита (>50MB)
  Given файл размером 51MB
  When клиент отправляет POST /api/files с multipart/form-data
  Then сервис возвращает 413 Payload Too Large
```

```gherkin
Scenario: Загрузить файл без файла
  When клиент отправляет POST /api/files без поля file
  Then сервис возвращает 422
```

### 6.3 Not found

```gherkin
Scenario: Скачать несуществующий файл
  When клиент отправляет GET /api/files/00000000-0000-0000-0000-000000000000/download
  Then сервис возвращает 404
```

### 6.4 Business rule: извлечение текста из разных MIME

```gherkin
Scenario: Извлечение текста из .md файла
  Given загружен файл "readme.md" с содержимым "# README\n\nDescription"
  When обработчик files.text_extracted выполнен
  Then событие files.text_extracted содержит extractedText = "# README\n\nDescription"
```

```gherkin
Scenario: Извлечение текста из .pdf файла
  Given загружен PDF-файл с текстом "Invoice #123"
  When обработчик files.text_extracted выполнен
  Then событие files.text_extracted содержит extractedText, включающий "Invoice #123"
```

### 6.5 Edge case

```gherkin
Scenario: Загрузить пустой файл
  When клиент отправляет POST /api/files с пустым файлом (0 bytes)
  Then сервис возвращает 201 Created (пустой файл допустим)
    And file_meta.size равен 0
```

```gherkin
Scenario: Имя файла с Unicode и спецсимволами
  When клиент отправляет POST /api/files с файлом
    | filename | "отчёт (2026) - v2.0!.txt" |
  Then сервис возвращает 201 Created
    And file_meta.filename сохранён корректно
    And скачивание возвращает правильное имя в Content-Disposition
```

---

## 7. settings — Настройки (KV)

### 7.1 Happy path: upsert, чтение, удаление

```gherkin
Scenario: Создать новую настройку
  When клиент отправляет POST /api/settings с телом
    | key   | "theme"    |
    | value | { "mode": "dark" } |
  Then сервис возвращает 201 Created
    And setting.key равен "theme"
    And setting.value равен { "mode": "dark" }
    And опубликовано событие settings.created
```

```gherkin
Scenario: Обновить существующую настройку (upsert)
  Given существует настройка key = "theme", value = { "mode": "light" }
  When клиент отправляет POST /api/settings с телом
    | key   | "theme"    |
    | value | { "mode": "dark" } |
  Then сервис возвращает 200 OK (не 201 — обновление)
    And setting.value равен { "mode": "dark" }
    And опубликовано событие settings.updated
    And setting.updatedAt обновлён
```

```gherkin
Scenario: Получить настройку по ключу и удалить её
  Given существует настройка key = "theme"
  When клиент отправляет GET /api/settings/theme
  Then сервис возвращает 200 OK
    And setting.key равен "theme"
  When клиент отправляет DELETE /api/settings/theme
  Then сервис возвращает 204 No Content
    And GET /api/settings/theme возвращает 404
    And опубликовано событие settings.deleted
```

### 7.2 Validation error

```gherkin
Scenario: Создать настройку без ключа
  When клиент отправляет POST /api/settings с телом { "value": { "a": 1 } }
  Then сервис возвращает 500 Internal Server Error (нарушение PK: key = NULL)
    And событие settings.created НЕ опубликовано
  # ⚠ gap: роут не валидирует key (additionalProperties: true), контракт ссылается
  # на несуществующую схему SettingUpsert (битый $ref в settings.yaml) — см. REVIEW.md §3.
```

### 7.3 Business rule: пагинация и сортировка

```gherkin
Scenario: Список настроек с пагинацией
  Given существует 25 настроек
  When клиент отправляет GET /api/settings?limit=10&offset=0
  Then сервис возвращает 200 OK
    And в ответе 10 настроек
    And settings отсортированы по updatedAt ASC
```

### 7.4 Business rule: graceful degradation Ollama

```gherkin
Scenario: Список моделей Ollama при недоступном сервисе
  Given Ollama не запущен
  When клиент отправляет GET /api/settings/ollama-models
  Then сервис возвращает 200 OK (не 500)
    And body равен { "models": [], "degraded": true }
```

---

## 8. search-rag — Поиск + RAG

### 8.1 Happy path: полнотекстовый поиск

```gherkin
Scenario: Найти заметку по подстроке
  Given в search_rag_.embeddings существует запись entityType = "note", content = "Купить молоко"
  When клиент отправляет POST /api/search с телом { "query": "молоко" }
  Then сервис возвращает 200 OK
    And результаты содержат заметку с content = "Купить молоко"
    And результат НЕ содержит поле embedding (только метаданные)
```

### 8.2 Business rule: фильтры

```gherkin
Scenario: Поиск с фильтром по типу и профилям
  Given существуют записи: note "A", task "B"
    And note "A" имеет profileIds = ["p1"]
  When клиент отправляет POST /api/search с телом
    | query       | "работа" |
    | type        | "note"   |
    | profileIds  | ["p1"]   |
  Then сервис возвращает 200 OK
    And результаты содержат только записи type = "note" и profileIds ⊇ ["p1"]
```

### 8.3 Edge case: fallback при недоступном Ollama

```gherkin
Scenario: Семантический поиск при недоступном Ollama — чистый ILIKE
  Given Ollama недоступен (embedding timeout 3s)
  When клиент отправляет POST /api/search с телом { "query": "отчёт" }
  Then сервис возвращает 200 OK
    And результаты построены только по ILIKE-совпадениям
    And сервис не возвращает ошибку (graceful degradation)
```

### 8.4 Business rule: идемпотентность индексации

```gherkin
Scenario: Повторное событие notes.created не создаёт дубликат
  Given в embeddings уже есть запись (entityType = "note", entityId = "n1")
  When обработчик получает повторное событие notes.created с entityId = "n1"
  Then в embeddings остаётся 1 запись для (note, n1) (unique index, upsert)
```

---

## 9. ai-gateway — AI-прокси

### 9.1 Happy path: диктовка

```gherkin
Scenario: Диктовка структурирует текст
  Given ai-gateway запущен, Ollama отвечает
  When клиент отправляет POST /api/ai-gateway/dictate с телом
    | text | "купить молоко хлеб яйца" |
  Then сервис возвращает 200 OK
    And body.title не пустой
    And body.bodyMd не пустой
    And body.degraded равен false
    And опубликовано событие ai-gateway.dictation.completed
```

### 9.2 Business rule: восстановление пунктуации

```gherkin
Scenario: Восстановление пунктуации через LLM
  Given Ollama отвечает
  When клиент отправляет POST /api/ai-gateway/restore-punctuation с телом
    | text | "привет как дела" |
  Then сервис возвращает 200 OK
    And body.text содержит пунктуацию (не равен исходному, если модель сработала)
    And body.degraded равен false
    And опубликовано событие ai-gateway.punctuation.restored
```

### 9.3 Edge case: эвристический fallback

```gherkin
Scenario: Диктовка при ошибке LLM — эвристика, а не 500
  Given Ollama недоступен
  When клиент отправляет POST /api/ai-gateway/dictate с телом { "text": "Первая строка\nВторая" }
  Then сервис возвращает 200 OK
    And body.title равен первой непустой строке, обрезанной до 60 символов (иначе "Без названия")
    And body.bodyMd равен исходному тексту
    And body.tag равен null
    And body.degraded равен true
```

---

## 10. agent — ИИ-ассистент (inbox)

### 10.1 Happy path: inbox и respond

```gherkin
Scenario: Получить pending-сообщения инбокса
  Given существуют сообщения: 2 pending, 1 dismissed
  When клиент отправляет GET /api/agent/inbox
  Then сервис возвращает 200 OK
    And в ответе только сообщения status = "pending"
```

```gherkin
Scenario: Принять сообщение
  Given существует сообщение m1 со статусом "pending"
  When клиент отправляет POST /api/agent/respond с телом
    | messageId | "m1"  |
    | action    | "accept" |
  Then сервис возвращает 200 OK
    And ответ { "ok": true }
    And message m1 имеет статус "accepted"
```

### 10.2 Business rule: dismiss-all

```gherkin
Scenario: Отклонить все pending-сообщения разом
  Given существуют 3 pending-сообщения
  When клиент отправляет POST /api/agent/dismiss-all
  Then сервис возвращает 200 OK
    And body.dismissed равен 3
    And все сообщения имеют статус "dismissed"
```

### 10.3 Business rule: дайджесты строятся из локального read model

```gherkin
Scenario: Дайджест на сегодня содержит сообщения, встречи и задачи
  Given agent_messages содержит сообщение, созданное сегодня
    And daily_events содержит встречу (kind = "meeting") на сегодня
    And daily_events содержит задачу (kind = "task") на сегодня
  When клиент отправляет GET /api/agent/today
  Then сервис возвращает 200 OK
    And body содержит messages, meetings и tasks (не пустые)
    And agent не обращался к чужим БД (только локальные таблицы)
```

### 10.4 Validation error

```gherkin
Scenario: Невалидный action в respond
  When клиент отправляет POST /api/agent/respond с телом
    | message_id | "m1"  |
    | action     | "explode" |
  Then сервис возвращает 400 Bad Request
```

---

## 11. time-tracking — Учёт времени

### 11.1 Happy path: CRUD timesheet

```gherkin
Scenario: Создать запись времени
  Given существует задача t1
  When клиент отправляет POST /api/time-tracking/timesheet с телом
    | taskId      | "t1"  |
    | startedAt   | "2026-08-01T09:00:00Z" |
    | durationSec | 3600  |
  Then сервис возвращает 201 Created
    And timesheet.taskId равен "t1"
    And timesheet.durationSec равен 3600
    And опубликовано событие time-tracking.timesheet.created
```

### 11.2 Business rule: статистика

```gherkin
Scenario: Статистика за сегодня и неделю
  Given существуют записи: 1h сегодня, 3h в этой неделе, 5h на прошлой неделе
  When клиент отправляет GET /api/time-tracking/timesheet/stats
  Then сервис возвращает 200 OK
    And body.todayTotal равен 3600
    And body.weekTotal равен 14400 (4h: 1h сегодня + 3h ранее на неделе)
```

### 11.3 Business rule: завершение pomodoro

```gherkin
Scenario: Завершить pomodoro-сессию
  Given существует pomodoro-сессия s1 со startedAt = "2026-08-01T09:00:00Z"
  When клиент отправляет PATCH /api/time-tracking/pomodoro/s1 с телом
    | endedAt | "2026-08-01T09:25:00Z" |
  Then сервис возвращает 200 OK
    And session.completed равен true (endedAt автоматически помечает)
    And session.completedMin равен 25
    And опубликовано событие time-tracking.pomodoro.updated
```

### 11.4 Validation error

```gherkin
Scenario: Создать pomodoro с невалидным mode
  When клиент отправляет POST /api/time-tracking/pomodoro с телом
    | mode | "quantum" |
  Then сервис возвращает 400 Bad Request
```

---

## 12. email — IMAP-почта

### 12.1 Happy path: аккаунт и синхронизация

```gherkin
Scenario: Создать IMAP-аккаунт
  When клиент отправляет POST /api/email/imap с телом
    | host      | "imap.example.com" |
    | port      | 993                |
    | ssl       | true               |
    | username  | "user@example.com" |
    | password  | "secret"           |
  Then сервис возвращает 201 Created
    And аккаунт создан
    And ответ НЕ содержит encryptedPassword
    And опубликовано событие email.imap.created
```

```gherkin
Scenario: Синхронизировать письма
  Given существует IMAP-аккаунт a1 с валидными credentials
    And IMAP-сервер отвечает: 3 письма в INBOX
  When клиент отправляет POST /api/email/imap/a1/sync
  Then сервис возвращает 200 OK
    And body.synced равен 3
    And письма сохранены в emails (accountId = "a1")
    And account.lastSyncAt обновлён
    And опубликовано событие email.synced
```

### 12.2 Business rule: пароль шифруется AES-256-GCM

```gherkin
Scenario: Пароль хранится в зашифрованном виде
  When клиент отправляет POST /api/email/imap с password = "secret"
  Then в БД поле encryptedPassword имеет формат "enc:<iv>:<tag>:<data>"
    And plaintext "secret" отсутствует в БД
```

### 12.3 Business rule: конвертация письма в заметку

```gherkin
Scenario: Конвертировать письмо в заметку
  Given существует письмо e1
  When клиент отправляет PATCH /api/email/imap/emails с телом
    | id         | "e1"   |
    | convertTo  | "note" |
  Then сервис возвращает 200 OK
    And ответ { "ok": true }
    And опубликовано событие email.converted_to_note
```

### 12.4 Error: IMAP недоступен

```gherkin
Scenario: Синхронизация при недоступном IMAP-сервере
  Given IMAP-сервер не отвечает
  When клиент отправляет POST /api/email/imap/a1/sync
  Then сервис возвращает 502 Bad Gateway
    And body.code равен "IMAP_UNAVAILABLE"
```

---

## 13. external-calendars — Внешние календари

### 13.1 Happy path: ICS-календарь и синхронизация

```gherkin
Scenario: Создать ICS-календарь
  When клиент отправляет POST /api/external-calendars/calendars с телом
    | displayName | "Рабочий"                        |
    | provider    | "ics"                            |
    | authData    | "https://example.com/cal.ics"    |
  Then сервис возвращает 201 Created
    And calendar.provider равен "ics"
    And опубликовано событие external-calendars.calendars.created
```

```gherkin
Scenario: Синхронизировать ICS-календарь
  Given существует ICS-календарь c1
    And URL возвращает ICS с 2 VEVENT
  When клиент отправляет POST /api/external-calendars/calendars/sync/c1
  Then сервис возвращает 200 OK
    And body.synced равен 2
    And новые события сохранены (externalEvents)
    And для новых событий опубликовано external_events.created
    And calendar.lastSyncAt обновлён
```

### 13.2 Business rule: связывание с локальной встречей

```gherkin
Scenario: Связать внешнее событие с встречей
  Given существует внешнее событие ee1
    And существует локальная встреча m1
  When клиент отправляет PATCH /api/external-calendars/calendars/events/ee1/link с телом
    | meetingId | "m1" |
  Then сервис возвращает 200 OK
    And ответ { "ok": true }
    And опубликовано событие external-calendars.external_event.linked
```

### 13.3 Error: провайдер не сконфигурирован

```gherkin
Scenario: Синхронизация Google Calendar без OAuth
  Given существует календарь с provider = "google"
    And OAuth flow не реализован
  When клиент отправляет POST /api/external-calendars/calendars/sync/c1
  Then сервис возвращает 502 Bad Gateway
    And body.code равен "PROVIDER_NOT_CONFIGURED"
```

---

## 14. integrations — Webhooks и API-ключи

### 14.1 Happy path: CRUD webhook

```gherkin
Scenario: Создать webhook
  When клиент отправляет POST /api/integrations/webhooks с телом
    | url    | "https://example.com/hook" |
    | events | ["notes.created"]          |
  Then сервис возвращает 201 Created
    And webhook.id — UUID
    And webhook.active равен true (по умолчанию)
    And опубликовано событие integrations.webhooks.created
```

### 14.2 Business rule: API-ключ хранится как SHA-256 хеш

```gherkin
Scenario: Создать API-ключ — raw ключ возвращается один раз
  When клиент отправляет POST /api/integrations/api-keys с телом { "name": "My App" }
  Then сервис возвращает 201 Created
    And body.apiKey начинается с "pk_"
    And в БД хранится keyHash (SHA-256), не raw-ключ
    And body содержит keyPrefix (первые 8 символов)
  When клиент отправляет GET /api/integrations/api-keys
  Then ответ содержит keyPrefix, но НЕ содержит apiKey и keyHash
```

### 14.3 Business rule: доставка webhook

```gherkin
Scenario: Событие notes.created доставляется на webhook
  Given существует активный webhook с events = ["notes.created"]
    And внешний сервер отвечает 200
  When клиент создаёт заметку (публикуется notes.created)
  Then webhook_delivery создан со статусом "delivered"
    And delivery.eventType нормализован до "notes.created"
    And payload — полный EventEnvelope
    And заголовок X-Webhook-Signature — HMAC-SHA256
```

### 14.4 Error: удаление несуществующего webhook

```gherkin
Scenario: Удалить несуществующий webhook
  When клиент отправляет DELETE /api/integrations/webhooks/00000000-0000-0000-0000-000000000000
  Then сервис возвращает 404 Not Found
```

---

## 15. export-import — Экспорт/импорт

### 15.1 Happy path: экспорт ZIP

```gherkin
Scenario: Экспортировать все данные в ZIP
  Given export_store содержит записи по notes и tasks
  When клиент отправляет GET /api/export-import/export?format=zip
  Then сервис возвращает 200 OK
    And Content-Disposition содержит "pmos-export-<сегодня>.zip"
    And body — бинарный ZIP архив
    And архив содержит manifest.json и файлы по типам сущностей
    And создана запись в export_jobs (kind = "export", status = "completed")
```

### 15.2 Happy path: импорт текста

```gherkin
Scenario: Импортировать текст как заметку
  When клиент отправляет POST /api/export-import/import с телом
    | format  | "text"   |
    | content | "Импортированная заметка" |
  Then сервис возвращает 201 Created
    And body.id — UUID
    And body.status существует
    And опубликовано событие export-import.import.imported
```

### 15.3 Business rule: импорт JSON с валидацией

```gherkin
Scenario: Импортировать массив сущностей из JSON
  When клиент отправляет POST /api/export-import/import с телом
    | format  | "json" |
    | content | "[{\"title\":\"A\"},{\"title\":\"B\"}]" |
  Then сервис возвращает 200 OK
    And body.imported равен 2
    And body.items содержит 2 элемента

Scenario: Импортировать JSON с пустой сущностью — 422
  When клиент отправляет POST /api/export-import/import с телом
    | format  | "json" |
    | content | "[{\"type\":\"note\"}]" |
  Then сервис возвращает 422 Unprocessable Entity (нет title и content)
```

### 15.4 Business rule: read model строится из событий

```gherkin
Scenario: export_store обновляется по событиям CRUD
  Given клиент создаёт заметку (notes.created)
  Then в export_store появилась запись entityType = "note" с id созданной заметки
    And повторное получение того же события не создаёт дубликат (processed_events)
```

---

## 16. sync — Синхронизация папок

### 16.1 Happy path: CRUD sync-папки

```gherkin
Scenario: Создать sync-папку с автозагрузкой
  When клиент отправляет POST /api/sync/sync-folders с телом
    | path       | "/Users/user/vault" |
    | autoImport | true                |
  Then сервис возвращает 201 Created
    And syncFolder.path равен "/Users/user/vault"
    And опубликовано событие sync.sync-folders.created
```

### 16.2 Business rule: сканирование .md файлов

```gherkin
Scenario: Сканирование папки находит .md файлы
  Given существует sync-папка f1 с path = "/tmp/vault"
    And в /tmp/vault лежат: "note1.md", "image.png", ".hidden/note2.md"
  When клиент запускает повторное сканирование (PATCH с тем же path и autoImport = true)
  Then scanned_files содержит только "note1.md" (скрытые и не-.md пропущены)
    And content_md равен содержимому note1.md
    And опубликовано событие sync.folder_scanned
```

### 16.3 Business rule: лимит размера файла

```gherkin
Scenario: Файл больше 512 KB — content пустой
  Given в папке есть "huge.md" размером 600 KB
  When клиент запускает сканирование
  Then scanned_files содержит запись для "huge.md"
    And content_md равен "" (пустая строка)
```

### 16.4 Business rule: удаление папки каскадит файлы

```gherkin
Scenario: Удалить sync-папку — scanned_files удаляются
  Given существует sync-папка f1 с 2 сканированными файлами
  When клиент отправляет DELETE /api/sync/sync-folders/f1
  Then сервис возвращает 204 No Content
    And сканированные файлы папки f1 удалены
```

---

## 17. Cross-service scenarios (Integration)

### 17.1 Note creation → AI title generation

```gherkin
Scenario: Создание заметки запускает AI-генерацию заголовка
  Given ai-gateway запущен и доступен (Ollama отвечает)
    And notes-service запущен
  When клиент создаёт заметку POST /api/notes с body_md = "Купить молоко, хлеб, яйца"
  Then в течение 30 секунд:
    And получено событие notes.created
    And ai-gateway опубликовал notes.title_generated
    And notes.title_generated.data.title не пустой
    And notes.title_generated.data.title включает "молок" или "покупк"
    And GET /api/notes/{noteId} возвращает обновлённый title
```

```gherkin
Scenario: AI-таймаут — заметка остаётся с пустым заголовком
  Given ai-gateway не отвечает (Ollama отключён)
    And notes-service запущен
  When клиент создаёт заметку POST /api/notes с body_md = "Test"
  Then через 35 секунд:
    And событие notes.title_generated НЕ опубликовано
    And GET /api/notes/{noteId} возвращает title = "" (пустой)
    And заметка существует и доступна
```

### 17.2 Task status change → agent trigger

```gherkin
Scenario: Закрытие задачи с дедлайном запускает триггер deadline_soon
  Given agent-service запущен
    And существует задача t1 с deadline = через 2 часа, status = "in_progress"
  When клиент закрывает задачу PATCH /api/tasks/t1 { "status": "done" }
  Then events:
    And опубликовано tasks.status_changed
    And agent опубликовал agent.trigger_evaluated с result = { "triggered": false }
      (дедлайн прошёл, задача уже закрыта — триггер не нужен)
```

```gherkin
Scenario: Создание неназначенной задачи → agent предлагает назначить
  Given agent-service запущен
    And существует проект pr1
  When клиент создаёт задачу POST /api/tasks с телом
    | title      | "Fix bug"            |
    | project_id | "pr1"               |
    | assignee   | null                |
  Then agent опубликовал agent.message_created
    And message.text содержит "без назначенного исполнителя"
```

### 17.3 File upload → text extraction → embedding creation

```gherkin
Scenario: Загрузка текстового файла создаёт embedding
  Given search-rag запущен (Ollama доступен, pgvector настроен)
    И files-service запущен
  When клиент загружает файл "notes.txt" с текстом "Семантический поиск"
  Then events последовательно:
    And опубликовано files.uploaded
    And опубликовано files.text_extracted
    And search-rag сохранил embedding в search_rag_.embeddings
    And POST /api/search с query = "семантический" возвращает файл в результатах
```

```gherkin
Scenario: Загрузка .txt файла при недоступном Ollama — ILIKE fallback
  Given Ollama недоступен
    And search-rag запущен
  When клиент загружает файл "notes.txt" с текстом "Важный документ"
  Then events:
    And опубликовано files.uploaded
    And опубликовано files.text_extracted
    And search-rag получает files.text_extracted
    And embedding НЕ сохранён (Ollama timeout)
    And файл доступен в результатах текстового поиска (ILIKE)
```

### 17.4 Webhook delivery chain

```gherkin
Scenario: Создание заметки вызывает webhook
  Given integrations запущен
    And существует webhook с url = "https://example.com/hook" и events = ["notes.created"]
    And внешний сервер отвечает 200 на POST /hook
  When клиент создаёт заметку POST /api/notes с body_md = "Test"
  Then integrations выполнил POST https://example.com/hook
    And payload содержит notes.created событие
    And заголовок X-Webhook-Signature содержит HMAC-SHA256
    And webhook_delivery отмечен как delivered
```

```gherkin
Scenario: Webhook retry при 500 ошибке
  Given существует webhook с url = "https://example.com/hook" и events = ["notes.created"]
    And внешний сервер отвечает 500 на первые 2 попытки, 200 на 3-ю
  When клиент создаёт заметку
  Then webhook_delivery имеет статус delivered
    And записей delivery попыток = 3 с интервалами ~1s, ~5s
```

```gherkin
Scenario: Webhook dead-letter после 3 неудач
  Given существует webhook с url = "https://example.com/hook" и events = ["notes.created"]
    And внешний сервер отвечает 500 на все попытки
  When клиент создаёт заметку
  Then webhook_delivery имеет статус dead
    And delivery.log содержит 3 попытки с ошибками
```

---

## 18. API Gateway / инфраструктура

### 18.1 correlationId propagation

```gherkin
Scenario: correlationId пробрасывается через HTTP-запрос и событие
  When клиент отправляет POST /api/notes с заголовком X-Correlation-Id = "corr-123"
  Then ответ содержит заголовок X-Correlation-Id = "corr-123"
    And событие notes.created содержит correlationId = "corr-123"
    And все события в цепочке (title_generated, updated) содержат тот же correlationId
```

```gherkin
Scenario: correlationId генерируется автоматически, если не передан
  When клиент отправляет POST /api/notes без заголовка X-Correlation-Id
  Then ответ содержит заголовок X-Correlation-Id (UUID)
    And событие notes.created содержит тот же UUID
```

### 18.2 Healthcheck

```gherkin
Scenario: healthcheck возвращает ok
  When клиент отправляет GET /health
  Then сервис возвращает 200 OK
    And тело содержит { "ok": true }
    And тело содержит "uptime" (число)
```

```gherkin
Scenario: healthcheck отражает состояние БД
  Given PostgreSQL недоступен
  When клиент отправляет GET /health
  Then сервис возвращает 503 Service Unavailable
    And тело содержит { "ok": false, "db": false, "nats": ... }
```

### 18.3 Metrics

```gherkin
Scenario: metrics возвращают prometheus-формат
  When клиент отправляет GET /metrics
  Then сервис возвращает 200 OK
    And Content-Type равен "text/plain; version=0.0.4"
    And тело содержит:
      - http_requests_total
      - http_request_duration_ms
      - events_published_total
      - events_processed_total
      - db_query_duration_ms
      - service_info
```

### 18.4 Public API rate limit

```gherkin
Scenario: Rate limit срабатывает после 100 запросов в минуту
  Given API key валиден
  When клиент отправляет 101 запрос GET /api/v1/notes за 1 минуту
  Then первые 100 запросов возвращают 200
    And 101-й запрос возвращает 429 Too Many Requests
    And заголовок Retry-After присутствует
```

---

## 19. E2E сценарии (Playwright)

```gherkin
Scenario: Полный цикл создания и поиска заметки
  Given пользователь открыл localhost:8080
    And профиль "Work" активен
  When пользователь нажимает "Новая заметка"
    And вводит текст "купить молоко хлеб яйца" в редактор
    And нажимает "Сохранить"
  Then заметка отображается в списке
    And заголовок сгенерирован AI (не пустой)
  When пользователь переходит в поиск
    And вводит "молоко"
  Then результат поиска содержит созданную заметку
```

```gherkin
Scenario: Создание рекуррентной задачи на Kanban
  Given пользователь на странице Kanban
  When пользователь создаёт задачу "Daily standup" с recurrence "каждый день"
    And перемещает задачу в колонку "Done"
  Then задача исчезает из колонки "In Progress"
    And новая задача "Daily standup" появляется в колонке "To Do"
    And дата новой задачи — следующий день
```

---

## Приложение: Матрица покрытия

| Сервис | Happy | Validation | Not Found | Business Rule | Edge | Cross-service |
|--------|-------|-----------|-----------|---------------|------|---------------|
| profiles | 3 | 1 | 2 | 1 | 2 | — |
| notes | 4 | 1 | 1 | 1 | 2 | 2 (AI title) |
| tasks | 2 | 2 | 1 | 2 | 1 | 1 (agent trigger) |
| calendar | 2 | 1 | 1 | 2 | 2 | — |
| projects | 1 | 1 | 1 | 1 | 2 | — |
| files | 3 | 2 | 1 | 2 | 2 | 2 (embedding) |
| settings | 3 | 1 | — | 2 | — | — |
| search-rag | 1 | — | — | 2 | 1 | — |
| ai-gateway | 1 | — | — | 1 | 1 | — |
| agent | 2 | 1 | — | 2 | — | — |
| time-tracking | 1 | 1 | — | 2 | — | — |
| email | 2 | — | — | 2 | — | — |
| external-calendars | 2 | — | — | 1 | — | — |
| integrations | 1 | — | 1 | 2 | — | 3 (webhooks) |
| export-import | 2 | — | — | 2 | — | — |
| sync | 1 | — | — | 3 | — | — |
| api-gateway | — | — | — | — | — | 4 (correlationId, health, metrics, rate limit) |
| **Всего** | **31** | **11** | **8** | **28** | **13** | **12** |

---

## Связанные ADR

- ADR-002: Testing Strategy (пирамида тестирования, уровни)
- ADR-003: Event-Driven Communication (формат событий для integration тестов)
- ADR-004: Database per Service (схемы БД для очистки тестовых данных)
- ADR-005: Observability (метрики и healthcheck)
