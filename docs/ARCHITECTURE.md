# Архитектура ЦУП — Personal OS (PMOS)

> **Статус:** backend-ядро реализовано и проверено — 16 сервисов, 5 саг, 90/90 тестов.
> Конвенции, перекрывающие этот документ при конфликте: **ADR-007** (канонические).

## Общая схема

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (nginx :8080)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  SPA     │  │  Public  │  │ WebSocket │  │  Health  │  │  Rate   │  │
│  │ (planned)│  │  API v1  │  │  upgrade  │  │  /health │  │  Limit  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                      ┌─────────────┴─────────────┐
                      ▼                           ▼
             ┌─────────────────┐       ┌──────────────────┐
             │  Event Bus      │       │  Shared Types    │
             │  (NATS          │       │  @pmos/shared   │
             │  JetStream)     │◄──────└──────────────────┘
             └──────┬───┬──────┘
                    │   │   (TSSRUP stream, subject pmos.>)
        ┌───────────┘   └───────────┐
        ▼                           ▼
┌──────────────────┐     ┌──────────────────┐
│  Core Services   │     │  AI Services     │
│  ┌────────────┐  │     │  ┌────────────┐  │
│  │ profiles   │  │     │  │ ai-gateway │  │
│  │ settings   │  │     │  │ search-rag │  │
│  │ notes      │  │     │  │ agent      │  │
│  │ tasks      │  │     │  └────────────┘  │
│  │ calendar   │  │     └──────────────────┘
│  │ projects   │  │
│  │ files      │  │     ┌──────────────────┐
│  └────────────┘  │     │  Productivity    │
└──────────────────┘     │  ┌────────────┐  │
                         │  │ time-      │  │
┌──────────────────┐     │  │ tracking   │  │
│  Integrations    │     │  └────────────┘  │
│  ┌────────────┐  │     └──────────────────┘
│  │ email      │  │
│  │ external-  │  │     ┌──────────────────┐
│  │ calendars  │  │     │  Cross-cutting   │
│  │ sync       │  │     │  ┌────────────┐  │
│  │ integrations│ │     │  │ export-    │  │
│  └────────────┘  │     │  │ import     │  │
└──────────────────┘     │  └────────────┘  │
                         └──────────────────┘
```

## Принципы коммуникации

### 1. Синхронные запросы (клиент → сервис)
```
Browser → API Gateway → Service
```
Только для запросов от фронтенда. API Gateway (nginx) маршрутизирует по `/api/<svc>/v1`.

### 2. Асинхронные события (сервис → сервис)
```
Service A → NATS JetStream → Service B (и Service C, D...)
```
Все изменения данных публикуются как события. Сервисы, которым нужны эти данные,
подписываются и строят свои read models (саги, idempotency).

### 3. Запрещено
- Прямые HTTP-вызовы между сервисами (кроме api-gateway → service)
- Общие базы данных между сервисами (каждому сервису — своя схема, ADR-004)
- Импорт кода одного сервиса в другой

## Технологический стек

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Язык | TypeScript (strict mode) | Единый язык для всех сервисов, shared types, zero `any` |
| Backend runtime | Node.js 22, **Fastify 5** + TypeBox | Канонический фреймворк (ADR-007 §2, ADR-003) |
| Frontend | React SPA — 📋 запланировано (BACKLOG §1) | Backend-API готов, UI не входил в backend-DoD |
| База данных | PostgreSQL 16 | Схема на сервис (`<svc>_`), изоляция через search_path (ADR-004) |
| ORM | Drizzle ORM + drizzle-kit | Миграции в репозитории, воспроизводимость (ADR-006) |
| Event bus | NATS 2.10 JetStream | Асинхронность, durable consumers, DLQ (ADR-002) |
| API specification | OpenAPI 3.0 — **по контракту на каждый сервис** (ADR-005) | 16 спецификаций в `contracts/openapi/`, conformance 16/16 |
| Event catalog | AsyncAPI — `contracts/asyncapi/events.yaml` | Канонический каталог, `x-implemented-wire-events` = факт |
| Containerization | Docker + Docker Compose | Профили core / all, 16 сервисов + nginx |
| Desktop | Tauri v2 — 📋 запланировано (BACKLOG §1) | Без Rust-логики, только lifecycle + WebView |

## Событийная модель

### Структура события (EventEnvelope)

```typescript
interface Event {
  id: string;           // UUID
  type: string;         // "pmos.notes.notes.created" (канонический subject, ADR-007 §3)
  source: string;       // имя сервиса-отправителя
  timestamp: string;    // ISO 8601
  version: number;      // версия схемы события (ADR-007 §3)
  data: Record<string, unknown>;  // camelCase payload
  correlationId: string; // для отслеживания цепочек событий
}
```

Формат subject: `pmos.<svc>.<resource>.<action>`, action ∈ `created|updated|deleted`
(двойное существительное: `pmos.notes.notes.created`). Помимо CRUD публикуются
доменные события: `pmos.tasks.tasks.status_changed`, `pmos.files.uploaded`,
`pmos.files.text_extracted`, `pmos.notes.title_generated`, `pmos.email.synced`,
`pmos.external-calendars.external_event.linked`, `pmos.sync.folder_scanned` и др.

**Полный и актуальный список публикуемых subject'ов**: `contracts/asyncapi/events.yaml`
→ `x-implemented-wire-events` (59 wire-событий). Это единственный источник правды.

### Гарантии доставки
- At-least-once (NATS JetStream, stream `TSSRUP`, subject `pmos.>`)
- Идемпотентные обработчики на стороне подписчиков
- Dead letter queue после 3 неудачных попыток (`maxDeliver(3)` в `@pmos/event-bus`)
- Durable consumers — переживают рестарт сервиса

## Cross-service сценарии (саги)

5 хореографических саг с компенсацией реализованы и покрыты интеграционными тестами
(см. `docs/SAGA.md`):

| § | Сценарий | Цепочка |
|---|----------|---------|
| §1 | AI-генерация заголовка заметки | notes → ai-gateway → notes |
| §2 | Триггер агента при смене статуса задачи | tasks → agent |
| §3 | Загрузка файла → извлечение текста → embedding | files → search-rag |
| §4 | Импорт внешнего календаря → связывание встречи | external-calendars → calendar |
| §5 | Доставка webhook'а по событиям | integrations ← все CRUD-события |

## Безопасность

| Уровень | Механизм |
|---------|---------|
| Внутренний (localhost/dev) | Без аутентификации |
| Публичный API (/api/v1) | Bearer token (SHA256 API key) — 📋 частью реализовано в integrations, mirror запланирован |
| Межсервисный | mTLS (опционально, для production) — 📋 запланировано (BACKLOG §3) |
| WebSocket | Аутентификация через query param — 📋 запланировано (BACKLOG §1, WS-пуши) |

## Навигация по репозиторию

```
pmos/
├── AGENT.md           # Runbook для автономного build-агента (фазы, гейты §5)
├── DELIVERY.md        # Delivery Gate: как запускать, что сделано, тесты, ограничения
├── README.md          # ← English (репозиторий), README.ru.md — русское зеркало
├── platform/          # Общая инфраструктура
│   ├── event-bus/     # @pmos/event-bus — NATS JetStream publisher/consumer (durable, DLQ)
│   ├── shared-types/  # @pmos/shared — EventEnvelope, доменные типы, DTO
│   └── docker/        # docker-compose.yml (profiles: core / all) + nginx.conf (api-gateway)
├── services/          # 16 сервисов, единый шаблон (см. README «Service template»)
│   ├── notes/ 3001  notes_      ├── search-rag/ 3008  search_rag_
│   ├── tasks/ 3002  tasks_      ├── ai-gateway/ 3009  ai_gateway_
│   ├── calendar/ 3003  calendar_│   ├── agent/ 3010  agent_
│   ├── projects/ 3004  projects_│   ├── time-tracking/ 3011  time_tracking_
│   ├── files/ 3005  files_      ├── email/ 3012  email_
│   ├── profiles/ 3006  profiles_│   ├── external-calendars/ 3013  external_calendars_
│   └── settings/ 3007  settings_│   ├── integrations/ 3014  integrations_
│                               ├── export-import/ 3015  export_import_
│                               └── sync/ 3016  sync_
├── contracts/         # Машинно-проверяемые контракты (source of truth)
│   ├── openapi/       # 16 × <svc>.yaml — OpenAPI (ADR-005, conformance 16/16)
│   ├── asyncapi/      # events.yaml — каталог событий + x-implemented-wire-events
│   └── test/          # фикстуры контрактных тестов
├── scripts/           # Генераторы (scaffold-services, gen-openapi, gen-schemas, gen-routes,
│                      #  gen-semantics, gen-contract-tests) — воспроизводимость каркаса
├── template-service/  # Scaffold-артефакт (исключён из сборки)
├── tests/             # Резерв для E2E (Playwright) — сейчас заменено integration 90/90
└── docs/              # Документация (ARCHITECTURE, FEATURES, SAGA, REVIEW, TEST_CASES,
                       #  BACKLOG, DEV_GUIDE, ADR/ADR-001..007)
```

## Правила для разработчиков

1. **OpenAPI-first**: любой новый эндпоинт сначала описывается в контракте, потом реализуется (ADR-005)
2. **Event-first**: изменение данных = публикация события. Не вызывай сервис B из сервиса A напрямую
3. **Immutable IDs**: никогда не меняй ID сущности. Ссылки по ID — единственный способ связи между сервисами
4. **Никаких `any`**: TypeScript strict mode, zero tolerance для `@ts-ignore`, `as any`
5. **Тесты до кода**: для каждого эндпоинта — контрактный тест. Для каждой бизнес-логики — unit/integration тест
6. **ADR**: каждое архитектурное решение — в документ. Канон — ADR-007, при конфликте он побеждает
7. **search_path**: подключение к БД — только через startup-параметр `-csearch_path=<schema>`
   (ADR-004), никогда через `SET search_path` в рантайме (покрывает одно соединение из пула)
