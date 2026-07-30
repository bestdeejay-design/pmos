# Архитектура ЦУП — Personal OS

## Общая схема

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (nginx :8080)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ Frontend │  │  Public  │  │ WebSocket │  │  Health  │  │  Rate   │  │
│  │  (SPA)   │  │  API v1  │  │  upgrade  │  │  /health │  │  Limit  │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                      ┌─────────────┴─────────────┐
                      ▼                           ▼
             ┌─────────────────┐       ┌──────────────────┐
             │  Event Bus      │       │  Shared Types    │
             │  (NATS)         │◄──────│  @pmos/shared   │
             │  JetStream      │       └──────────────────┘
             └──────┬───┬──────┘
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
│  └────────────┘  │     │ Productivity     │
└──────────────────┘     │  ┌────────────┐  │
                          │  │ time-      │  │
┌──────────────────┐      │  │ tracking   │  │
│  Integrations    │      │  │ digests    │  │
│  ┌────────────┐  │      │  └────────────┘  │
│  │ email      │  │      └──────────────────┘
│  │ external-  │  │
│  │ calendars  │  │      ┌──────────────────┐
│  │ sync       │  │      │  Cross-cutting   │
│  │ webhooks   │  │      │  ┌────────────┐  │
│  │ api-keys   │  │      │  │ export-    │  │
│  └────────────┘  │      │  │ import     │  │
└──────────────────┘      │  └────────────┘  │
                          └──────────────────┘
```

## Принципы коммуникации

### 1. Синхронные запросы (клиент → сервис)
```
Browser → API Gateway → Service
```
Только для запросов от фронтенда. API Gateway маршрутизирует по URL.

### 2. Асинхронные события (сервис → сервис)
```
Service A → Event Bus → Service B (и Service C, D...)
```
Все изменения данных публикуются как события. Сервисы, которым нужны эти данные, подписываются и строят свои read models.

### 3. Запрещено
- Прямые HTTP-вызовы между сервисами (кроме api-gateway → service)
- Общие базы данных между сервисами
- Импорт кода одного сервиса в другой

## Технологический стек

| Компонент | Технология | Обоснование |
|-----------|-----------|-------------|
| Язык | TypeScript (strict mode) | Единый язык для всех сервисов, shared types |
| Backend runtime | Node.js 22, **Fastify 5** | Канонический фреймворк (ADR-007 §2). Монолит был на Express — мигрируем |
| Frontend | React 18 + Vite + TypeScript | Сохраняем текущий стек |
| База данных | PostgreSQL 16 | Каждому сервису — своя БД или схема |
| Event bus | NATS (JetStream) | Лёгкий, быстрый, без лишних зависимостей |
| Desktop | Tauri v2 (без Rust-логики) | Только Docker lifecycle + WebView |
| Containerization | Docker + Docker Compose | Сохраняем текущий подход |
| API specification | OpenAPI 3.0 (только для api-gateway) | Единая точка входа |

## Событийная модель

### Структура события

```typescript
interface Event {
  id: string;           // UUID
  type: string;         // "pmos.notes.created" (канонический subject, см. ADR-007 §3)
  source: string;       // имя сервиса-отправителя
  timestamp: string;    // ISO 8601
  version: number;      // версия схемы события (ADR-007 §3)
  data: Record<string, unknown>;  // camelCase payload
  correlationId: string; // для отслеживания цепочек событий
}
```

### Гарантии доставки
- At-least-once (NATS JetStream)
- Идемпотентные обработчики на стороне подписчиков
- Dead letter queue после 3 неудачных попыток

## Безопасность

| Уровень | Механизм |
|---------|---------|
| Внутренний (localhost) | Без аутентификации |
| Публичный API (/api/v1) | Bearer token (SHA256 API key) |
| Межсервисный | mTLS (опционально, для production) |
| WebSocket | Аутентификация через query param при подключении |

## Навигация по репозиторию

```
pmos/
├── platform/           # Общая инфрастуктура
│   ├── event-bus/      # NATS клиент, SDK для публикации/подписки
│   └── shared-types/   # @pmos/shared — типы, интерфейсы, event schemas
├── services/           # Сервисы
│   ├── api-gateway/    # nginx + entry point
│   ├── profiles/       # Контекстные профили
│   ├── settings/       # Настройки
│   ├── notes/          # Заметки
│   ├── tasks/          # Задачи
│   ├── calendar/       # Встречи
│   ├── projects/       # Проекты
│   ├── files/          # Файлы
│   ├── search-rag/     # Поиск + RAG
│   ├── ai-gateway/     # AI-прокси
│   ├── agent/          # ИИ-ассистент
│   ├── email/          # IMAP-почта
│   ├── external-calendars/  # Внешние календари
│   ├── integrations/   # Webhooks + API keys
│   ├── time-tracking/  # Timesheet + Pomodoro
│   ├── export-import/  # Экспорт/импорт
│   └── sync/           # Синхронизация папок
├── desktop/            # Tauri desktop app (Docker lifecycle)
├── frontend/           # React SPA
├── contracts/         # Машинно-проверяемые контракты (OpenAPI + AsyncAPI)
│   ├── openapi/        # per-service OpenAPI specs (source of truth для API)
│   └── asyncapi/       # events.yaml — канонический каталог событий
└── docs/               # Документация
    ├── ADR/            # Architecture Decision Records (ADR-001..007)
    ├── REVIEW.md       # Аудит консистентности и резолюция конфликтов
    ├── ARCHITECTURE.md # Этот файл
    ├── FEATURES.md     # Полный каталог функций
    ├── SAGA.md         # Cross-service сценарии
    ├── DEV_GUIDE.md    # Настройка окружения
    ├── TEST_CASES.md   # Gherkin-сценарии
    └── BACKLOG.md      # План работ
```

## Правила для разработчиков

1. **OpenAPI-first**: любой новый эндпоинт сначала описывается в спецификации, потом реализуется
2. **Event-first**: изменение данных = публикация события. Не вызывай сервис B из сервиса A напрямую
3. **Immutable IDs**: никогда не меняй ID сущности. Ссылки по ID — единственный способ связи между сервисами
4. **Никаких `any`**: TypeScript strict mode, zero tolerance для `@ts-ignore`, `as any`
5. **Тесты до кода**: для каждого эндпоинта — контрактный тест. Для каждой бизнес-логики — unit-тест
6. **ADR**: каждое архитектурное решение — в документ. Не «почему так вышло», а «почему мы так решили»
