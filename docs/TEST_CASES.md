# Test Cases — Gherkin-сценарии для сервисов ЦУП

> Документ содержит конкретные Given-When-Then сценарии для unit, integration и contract тестов.
> Формат: **Gherkin** (`Given ... When ... Then ...`).
> Инструмент: **Vitest** (unit + integration), **Pact** (contract), **Playwright** (E2E).

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

## 7. Cross-service scenarios (Integration)

### 7.1 Note creation → AI title generation

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

### 7.2 Task status change → agent trigger

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

### 7.3 File upload → text extraction → embedding creation

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

### 7.4 Webhook delivery chain

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

## 8. API Gateway / инфраструктура

### 8.1 correlationId propagation

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

### 8.2 Healthcheck

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

### 8.3 Metrics

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

### 8.4 Public API rate limit

```gherkin
Scenario: Rate limit срабатывает после 100 запросов в минуту
  Given API key валиден
  When клиент отправляет 101 запрос GET /api/v1/notes за 1 минуту
  Then первые 100 запросов возвращают 200
    And 101-й запрос возвращает 429 Too Many Requests
    And заголовок Retry-After присутствует
```

---

## 9. E2E сценарии (Playwright)

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
| integrations | — | — | — | — | — | 3 (webhooks) |
| api-gateway | — | — | — | — | — | 4 (correlationId, health, metrics, rate limit) |
| **Всего** | **15** | **8** | **7** | **9** | **11** | **12** |

---

## Связанные ADR

- ADR-002: Testing Strategy (пирамида тестирования, уровни)
- ADR-003: Event-Driven Communication (формат событий для integration тестов)
- ADR-004: Database per Service (схемы БД для очистки тестовых данных)
- ADR-005: Observability (метрики и healthcheck)
