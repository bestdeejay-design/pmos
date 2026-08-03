# Saga Patterns — Хореографические сценарии с компенсацией

> Документ описывает все cross-service процессы (saga) с пошаговым flow,
> timeout'ами, retry-логикой и условиями компенсации/rollback.
> Все сценарии используют **choreography-based saga** (нет центрального оркестратора).

## Общие соглашения

| Параметр | Значение |
|----------|----------|
| **Время ожидания ответа (ack)** | 30s (NATS JetStream `ack_wait`) |
| **Max delivery attempts** | 3 (до dead-letter) |
| **Dead letter subject** | `{subject}.dlq` |
| **Идемпотентность** | Обработчик проверяет `processed_events` по `event.id` |
| **correlationId** | Пробрасывается через все события цепочки |

---

## 1. Note Creation + AI Title Generation

Участвуют: **notes** ↔ **ai-gateway**

### Диаграмма

```
notes                ai-gateway
  │                       │
  │  notes.created ──────►│  (1) заметка сохранена без заголовка
  │                       │
  │◄────────────────────  │  (2) ai-gateway генерирует заголовок
  │  notes.title_generated│
  │                       │
  │  (3) обновляет title   │
  │  notes.updated ───────►│  (4) событие обновления
```

### Спецификация

| Аспект | Детали |
|--------|--------|
| **Триггер** | `notes.created` опубликовано notes-сервисом |
| **Участники** | notes (publisher + consumer), ai-gateway (consumer + publisher) |
| **Формат data** | `notes.created`: `{ noteId, bodyMd, profileIds, correlationId }` |
| | `notes.title_generated`: `{ noteId, title, tag?, correlationId }` |

### Пошаговый flow

#### Шаг 1: notes публикует `notes.created`

- **Действие**: notes создаёт запись в БД с `title = DEFAULT_TITLE` (или пустым).
- **Событие**: `notes.created` → NATS.
- **Success**: событие опубликовано, ai-gateway получил.
- **Failure**: NATS недоступен → запись сохранена в БД, событие будет доставлено позже.
- **Компенсация**: Нет (заметка уже существует с заголовком по умолчанию).

#### Шаг 2: ai-gateway получает `notes.created` и генерирует заголовок

- **Действие**: ai-gateway вызывает LLM (Ollama) с телом заметки, просит сгенерировать заголовок и тег.
- **Success**: ai-gateway публикует `notes.title_generated`.
- **Failure LLM**: модель не ответила, ошибка, таймаут → **ничего не публикуется**, событие логируется.
- **Timeout LLM**: 30s на ответ модели. Если нет — fallback к следующей модели в chain.
- **Timeout общий**: ai-gateway таймаутится через 30s после получения `notes.created`.
- **Retry**: событие `notes.created` может быть передоставлено NATS (at-least-once). ai-gateway проверяет `processed_events`: если событие уже обработано — игнорирует (идемпотентность).
- **Компенсация**: Не требуется. Заметка остаётся с заголовком по умолчанию.

#### Шаг 3: notes получает `notes.title_generated` и обновляет запись

- **Действие**: notes обновляет `title` и `tags` в БД.
- **Событие**: `notes.updated` → NATS (для search-rag, agent и др.).
- **Success**: заголовок обновлён.
- **Failure**: запись в БД не найдена (была удалена) → игнор. Ошибка БД → retry NATS.
- **Компенсация**: Нет.

### Конфигурация timeout'ов

| Таймаут | Значение | Где выставлен |
|---------|----------|---------------|
| Ожидание ответа LLM | 30s | ai-gateway (конфиг модели) |
| Fallback model chain | 30s per model | ai-gateway (retry logic) |
| NATS ack_wait (consumer) | 30s | NATS consumer config |
| Максимальное время saga | ~60s (2× LLM timeout) | — |

### Количество retry

- **NATS delivery**: безлимит (at-least-once), после 3 попыток — `notes.created.dlq`.
- **ai-gateway LLM call**: 0 retry (сразу fallback на следующую модель или завершение).
- **notes обновление БД**: 3 retry от NATS, затем `notes.title_generated.dlq`.

---

## 2. Task Status Change + Agent Trigger

Участвуют: **tasks** → **agent**

### Диаграмма

```
tasks               agent
  │                    │
  │ tasks.status_changed ──►  (1) задача изменила статус
  │                         │
  │                    (2) agent проверяет триггеры
  │                    (3) если совпало — публикует agent.message_created
  │                         │
  │◄──────────────────────  (4) api-gateway получает WS push
```

### Спецификация

| Аспект | Детали |
|--------|--------|
| **Триггер** | `tasks.status_changed` опубликовано tasks-сервисом |
| **Участники** | tasks, agent |
| **Формат data** | `{ taskId, oldStatus, newStatus, task, correlationId }` |
| **Триггеры agent** | `deadline_soon` (дедлайн < N часов), `task_no_assignee`, `project_plan` |

### Пошаговый flow

#### Шаг 1: tasks публикует `tasks.status_changed`

- **Действие**: при смене статуса задачи (например, `todo → in_progress`, `in_progress → done`).
- **Событие**: `tasks.status_changed` → NATS.
- **Success**: событие опубликовано.
- **Failure**: NATS недоступен → задача сохранена, событие будет доставлено позже.
- **Компенсация**: Нет (изменение статуса уже произошло).

#### Шаг 2: agent получает `tasks.status_changed` и оценивает триггеры

- **Действие**: agent проверяет задачу по всем активным триггерам:
  - `deadline_soon`: если `deadline` < configurable_hours → создать напоминание.
  - `task_no_assignee`: если `assignee` пуст → предложить назначить.
  - `project_plan`: если задача в проекте с goal → предложить план.
- **Success**: хотя бы один триггер совпал → agent публикует `agent.message_created`.
- **No match**: ни один триггер не сработал → тихо завершает (лог `agent.trigger_evaluated`).
- **Failure**: agent упал во время оценки → NATS retry через 3 попытки → dead-letter.
- **Timeout обработки**: 60s на всю оценку триггеров. Если не уложился — событие дропается.
- **Компенсация**: Не требуется. Trigger — подсказка (hint), не критическая операция.

### Конфигурация timeout'ов

| Таймаут | Значение | Примечание |
|---------|----------|-----------|
| Оценка триггеров | 60s | Если не успел — событие дропается |
| NATS ack_wait | 30s | NATS может редиливерить при таймауте ack |

### Количество retry

- **NATS delivery**: 3 попытки, затем `tasks.status_changed.dlq`.
- **Оценка триггеров**: 0 retry (идемпотентно — повторная доставка перезапустит оценку).
- **Dead-letter причина**: agent недоступен более 3 минут.

---

## 3. File Upload + Text Extraction + Embedding

Участвуют: **files** → **files** → **search-rag**

### Диаграмма

```
files (upload)      files (text extraction)      search-rag
     │                       │                        │
     │ files.uploaded ──────►│                        │
     │                       │  (1) извлекает текст   │
     │                       │  files.text_extracted ──►  (2) вычисляет embedding
     │                       │                        │
     │                       │                   (3) хранит в pgvector
```

### Спецификация

| Аспект | Детали |
|--------|--------|
| **Триггер** | `files.uploaded` опубликовано files-сервисом |
| **Участники** | files (publisher + consumer), search-rag (consumer) |
| **Формат data** | `files.uploaded`: `{ fileId, filename, mimeType, size, storagePath, profileIds, correlationId }` |
| | `files.text_extracted`: `{ fileId, extractedText, mimeType, correlationId }` |
| **Поддержка MIME** | `text/plain`, `text/markdown`, `application/pdf`, `text/csv` |

### Пошаговый flow

#### Шаг 1: files публикует `files.uploaded`

- **Действие**: файл сохранён на диск (storagePath), метаданные — в таблицу `file_meta`.
- **Событие**: `files.uploaded` → NATS.
- **Success**: файл доступен для скачивания, событие опубликовано.
- **Failure**: диск переполнен → ошибка клиенту, файл не сохранён, событие не публикуется.
- **Компенсация**: Нет.

#### Шаг 2: files получает `files.uploaded` и извлекает текст

- **Действие**: files-сервис (тот же сервис, другой обработчик) читает файл с диска и извлекает текст.
  - `text/plain`, `text/markdown`: читается как есть.
  - `application/pdf`: извлекается через PDF-парсер (pdf.js или аналог).
  - Другие: текст не извлекается (пропуск).
- **Success**: текст извлечён → публикуется `files.text_extracted`.
- **Failure**: файл не найден на диске (удалён) → событие игнорируется. PDF не парсится → публикуется `files.text_extracted` с пустым extractedText.
- **Timeout извлечения**: 60s на извлечение текста (большие PDF).
- **Компенсация**: Нет (файл уже загружен, текст извлечён или нет).

#### Шаг 3: search-rag получает `files.text_extracted` и вычисляет embedding

- **Действие**: search-rag вызывает Ollama embedding API (nomic-embed-text), сохраняет вектор в `search_rag_.embeddings`.
- **Success**: embedding сохранён в pgvector.
- **Failure**: Ollama недоступен → retry 3 раза, потом dead-letter. Embedding не сохранён.
- **Timeout embedding**: 30s на вычисление embedding.
- **Компенсация**: embedding не создан. Поиск по файлу будет работать только через ILIKE.
- **Manual retry**: в будущем — кнопка «Переиндексировать» в UI (файл → retry embedding).

### Конфигурация timeout'ов

| Таймаут | Значение |
|---------|----------|
| Извлечение текста (PDF) | 60s |
| Вычисление embedding | 30s |
| NATS ack_wait | 30s |

### Количество retry

| Шаг | Retry | Dead-letter |
|-----|-------|-------------|
| Извлечение текста | 3 (NATS) | `files.uploaded.dlq` |
| Embedding (search-rag) | 3 (NATS) | `files.text_extracted.dlq` |
| Embedding (Ollama) | 3 попытки внутри обработчика | embedding не сохранён |

---

## 4. Calendar Sync with External Provider

Участвуют: **external-calendars** → **calendar**

### Диаграмма

```
external-calendars          calendar
     │                         │
     │ (1) fetch внешних       │
     │     событий             │
     │                         │
     │ external_events.created ──►  (2) merge в локальный календарь
     │                         │
     │                    (3) meetings.created (если создана встреча)
```

### Спецификация

| Аспект | Детали |
|--------|--------|
| **Триггер** | Ручной (`POST /api/calendars/sync/:id`) или по расписанию (cron внутри external-calendars) |
| **Участники** | external-calendars, calendar |
| **Формат data** | `external_events.created`: `{ externalCalendarId, externalEventId, summary, description, startTime, endTime, recurrenceRule?, location?, correlationId }` |
| **Провайдеры** | Google Calendar (OAuth), Yandex Calendar (CalDAV), ICS URL |

### Пошаговый flow

#### Шаг 1: external-calendars синхронизирует внешний календарь

- **Действие**: external-calendars запрашивает события с внешнего API:
  - Google Calendar API (OAuth2, token refresh).
  - Yandex CalDAV (Basic auth).
  - ICS URL (HTTP GET + парсинг).
- **Success**: список внешних событий получен.
- **Failure**: внешний API недоступен, token expired → логируется ошибка.
- **Token refresh**: Google OAuth token автоматически обновляется перед запросом.
- **Компенсация**: нет (данные не сохранялись).

#### Шаг 2: для каждого нового/изменённого события external-calendars публикует `external_events.created`

- **Действие**: только для событий, которых нет в локальной БД `external_events` (по `externalEventId`), или которые изменились.
- **Событие**: `external_events.created` → NATS.
- **Success**: событие опубликовано.
- **Failure**: NATS недоступен → external-calendars логирует и продолжит синхронизацию позже.
- **Компенсация**: нет.

#### Шаг 3: calendar получает `external_events.created` и создаёт встречу

- **Действие**: calendar-сервис создаёт запись в `meetings` на основе данных внешнего события.
  - Поле `linked_external_event_id` связывает с `external_events`.
- **Событие**: `meetings.created` → NATS (для search-rag, agent и др.).
- **Success**: встреча создана, связана с внешним событием.
- **Failure**: ошибка БД → NATS retry. Если все retry исчерпаны → `external_events.created.dlq`.
- **Duplicate prevention**: calendar проверяет `linked_external_event_id` для идемпотентности.
- **Конфликт**: если на это время уже есть встреча — логируется, встреча создаётся с пометкой "возможен конфликт".
- **Компенсация (manual)**: администратор может удалить встречу в UI и пересинхронизировать.

### Количество retry

| Шаг | Retry | Dead-letter |
|-----|-------|-------------|
| Fetch внешнего API | 3 (в сервисе) | Лог ошибки |
| `external_events.created` доставка | 3 (NATS) | `external_events.created.dlq` |
| Создание встречи | 3 (NATS) | `external_events.created.dlq` (ручное разбирательство) |

---

## 5. Webhook Delivery + Retry

Участвуют: **integrations** (подписчик на все события)

### Диаграмма

```
Любой сервис         integrations                   Внешний сервер
     │                     │                              │
     │ notes.created ──────►                              │
     │                     │                              │
     │                (1) проверить подписки               │
     │                (2) POST на URL webhook ───────────► │
     │                     │◄──────────────────────────── │
     │                (3) 200 = success, удалить доставку   │
     │                (4) 4xx/5xx = retry с backoff       │
```

### Спецификация

| Аспект | Детали |
|--------|--------|
| **Триггер** | Любое событие из подписок integrations (см. Event Catalog) |
| **Участники** | integrations, внешний HTTP-сервер |
| **Подписки** | `notes.*`, `tasks.*`, `meetings.*`, `files.*`, `projects.*`, `agent.message_created` |
| **Payload** | Полный объект Event (JSON) с подписью HMAC-SHA256 через `webhook.secret` |

### Пошаговый flow

#### Шаг 1: integrations получает событие

- **Действие**: integrations проверяет все активные webhook'и, подписанные на этот тип события.
- **Нет подписок**: событие игнорируется (ack NATS).
- **Success**: есть подходящие webhook'и → создаётся запись в `webhook_deliveries`.

#### Шаг 2: POST на URL webhook'а

- **Действие**: HTTP POST с заголовками:
  - `Content-Type: application/json`
  - `X-Webhook-Signature: HMAC-SHA256(body, secret)`
  - `X-Event-Type: notes.created`
  - `X-Correlation-Id: <correlationId>`
- **Success**: внешний сервер ответил `2xx` → доставка помечена `delivered`, повтор не нужен.
- **Failure**: внешний сервер ответил `4xx` → доставка помечена `failed_4xx` (вероятно, неверная конфигурация).
- **Failure**: внешний сервер ответил `5xx` / timeout / network error → retry с backoff.
- **Timeout отправки**: 10s на один HTTP-запрос.

#### Шаг 3: Retry с exponential backoff

| Попытка | Задержка | После |
|---------|----------|-------|
| 1 | — | immediately |
| 2 | 1s | +1s |
| 3 | 5s | +4s |
| 4 | 30s | +25s |
| **Dead-letter** | — | ∞ |

- **Dead-letter**: webhook_delivery помечается `dead`. Причина логируется.
- **Manual retry**: администратор может повторно отправить через UI.
- **Компенсация**: нет (интеграции — однонаправленные уведомления).

### Общий timeout

| Параметр | Значение |
|----------|----------|
| Timeout HTTP-запроса | 10s |
| Общий timeout цепочки (4 попытки) | ~37s |
| NATS ack_wait | 30s (интеграции ack'ят сразу после старта обработки) |

---

## Матрица компенсаций

| Сценарий | Компенсация | Тип |
|----------|-------------|-----|
| Notes + AI Title | Не нужна (заголовок по умолчанию) | None |
| Task Status + Agent | Не нужна (триггер — это hint) | None |
| File + Embedding | Embedding не сохранён → ручная переиндексация | Manual |
| Calendar Sync | Удалить встречу → пересинхронизировать | Manual |
| Webhook Delivery | Повторная отправка через UI | Manual |

## Dead-letter queue

Все события, исчерпавшие 3 попытки доставки, попадают в `{subject}.dlq`.
Формат сообщения в DLQ — оригинальное событие без изменений.

### Обработка DLQ

- Визуальный мониторинг через NATS CLI: `nats consumer list`.
- Автоматической репликации из DLQ нет.
- После исправления причины (починили сервис, поправили webhook URL) — ручной replay.
- **Реализовано** (ops-сервис, порт 3017, stateless): `GET /api/ops/v1/dlq` — список DLQ-сообщений
  (seq, subject, декодированный конверт EventEnvelope); `POST /api/ops/v1/dlq/{seq}/replay` —
  перепубликация в оригинальный subject байт-в-байт + удаление из стрима.
  Механизм DLQ в `@pmos/event-bus`: при исчерпании `maxDeliver` копия публикуется в
  `<subject>.dlq`, оригинал терминируется (`term`). Контракт: `contracts/openapi/ops.yaml`.

---

## Проверка идемпотентности

Каждый сервис использует таблицу `processed_events`:

```sql
CREATE TABLE <schema>.processed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Перед обработкой события:

```typescript
const alreadyProcessed = await db.query(
  'SELECT 1 FROM processed_events WHERE event_id = $1',
  [event.id]
);
if (alreadyProcessed.rows.length > 0) {
  // Игнорируем — уже обработано
  return;
}
// ... обработка ...
await db.query(
  'INSERT INTO processed_events (event_id) VALUES ($1)',
  [event.id]
);
```

---

## Связанные ADR

- ADR-003: Event-Driven Communication (формат событий, гарантии доставки)
- ADR-004: Database per Service (processed_events таблица)
- ADR-005: Observability (correlationId, логирование цепочек)
