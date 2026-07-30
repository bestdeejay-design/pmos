# template-service

Шаблон микросервиса для ЦУП.

## Быстрый старт

```bash
# Скопировать шаблон для нового сервиса
cp -r ../template-service ../services/my-new-service
cd ../services/my-new-service

# Установить зависимости
npm install

# Настроить окружение
cp .env.example .env
# Отредактировать .env: SERVICE_NAME, DATABASE_URL, NATS_URL

# Сгенерировать миграции
npm run db:generate

# Запустить dev
npm run dev
```

## Что включено

| Компонент | Библиотека | Endpoint / Файл |
|-----------|-----------|-----------------|
| HTTP сервер | Fastify 5 | `src/app.ts` |
| Структурированные логи | pino | stdout |
| Метрики | prom-client | `GET /metrics` |
| Healthcheck | — | `GET /health` |
| CorrelationId | — | Header `X-Correlation-Id` |
| База данных | Drizzle ORM + postgres.js | `src/db/` |
| Миграции | drizzle-kit | `npm run db:migrate` |
| Event Bus | NATS JetStream | `src/events/` |
| Типизированные ошибки | — | `src/lib/errors.ts` |
| Graceful shutdown | — | SIGTERM → NATS → DB → HTTP |
| Docker | multi-stage, alpine | `Dockerfile` |

## Структура

```
src/
├── index.ts              # Entry point
├── app.ts                # Fastify app factory
├── env.ts                # Env validation
├── lib/
│   ├── errors.ts         # Типизированные ошибки
│   └── logger.ts         # Pino logger
├── plugins/
│   ├── correlationId.ts  # X-Correlation-Id middleware
│   ├── health.ts         # GET /health
│   └── metrics.ts        # GET /metrics + prom-client
├── db/
│   ├── connection.ts     # Drizzle + postgres.js
│   ├── schema.ts         # Схема БД (заменить под свой сервис)
│   └── migrate.ts        # Программный запуск миграций
└── events/
    ├── publisher.ts      # NATS publish wrapper
    └── subscriber.ts     # NATS JetStream pull consumer
```

## Переменные окружения

| Переменная | Обязательная | По умолчанию | Описание |
|-----------|-------------|-------------|----------|
| `SERVICE_NAME` | ✅ | — | Имя сервиса |
| `PORT` | ❌ | `3000` | HTTP порт |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `NATS_URL` | ✅ | — | NATS server URL |
| `LOG_LEVEL` | ❌ | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `NODE_ENV` | ❌ | `development` | `development` / `production` |

## Разработка

```bash
# Запуск в dev режиме (tsx watch)
npm run dev

# Сборка
npm run build

# Продакшн
npm start

# Тесты
npm test

# База данных
npm run db:generate   # Сгенерировать миграцию
npm run db:migrate    # Применить миграции
npm run db:studio     # Drizzle Studio (UI для БД)
```

## Docker

```bash
# Собрать образ
docker build -t my-service .

# Запустить
docker compose up -d

# Остановить
docker compose down
```

## Как использовать шаблон для нового сервиса

1. Скопируйте `template-service` → `services/your-service`
2. Поменяйте `name` в `package.json`
3. Отредактируйте `.env` под свой сервис
4. Замените `src/db/schema.ts` — добавьте свои таблицы
5. Добавьте свои route-файлы в `src/plugins/`
6. Зарегистрируйте новые плагины в `src/app.ts`
7. Добавьте бизнес-логику в `src/services/` (создайте, если нужно)
8. Напишите тесты в `test/`

## Принципы

- **TypeScript strict mode** — без `any`, `as any`, `@ts-ignore`
- **No business logic in template** — только cross-cutting concerns
- **JetStream guaranteed delivery** — at-least-once, dead-letter после 3 попыток
- **Graceful shutdown** — SIGTERM → NATS drain → DB close → HTTP close → exit
- **CorrelationId** — сквозной идентификатор для всех запросов и событий
