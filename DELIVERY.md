# DELIVERY.md — ЦУП Personal OS

> Заполняется строящим агентом при достижении Delivery Gate (AGENT.md §5).

## Как запустить

```bash
npx pnpm install
docker compose -f platform/docker/docker-compose.yml --profile core up -d   # Postgres + NATS
# миграции всех сервисов (нужен Postgres)
for svc in profiles settings notes tasks calendar projects files search-rag ai-gateway agent integrations export-import time-tracking email external-calendars sync; do
  DATABASE_URL=postgres://pmos:pmos@localhost:5432/pmos DATABASE_SCHEMA=${svc//-/_}_ npx pnpm --filter @pmos/$svc run db:migrate
done
docker compose -f platform/docker/docker-compose.yml --profile all up -d   # все сервисы + gateway
# открыть http://localhost:8080
```

## Что реализовано (vs FEATURES.md)

| Сервис | Статус | Заметки |
|--------|--------|---------|
| profiles | ✅ | CRUD + is_default/hidden + защита удаления default |
| settings | ✅ | KV CRUD + /ollama-models |
| notes | ✅ | CRUD + шаблоны + сортировка + ILIKE + **Сага §1: AI-заголовок** |
| tasks | ✅ | CRUD + рекурренс + streaks + зависимости + Kanban-валидация |
| calendar | ✅ | CRUD + ICS (RFC5545) + **Сага §4: импорт внешних встреч** |
| projects | ✅ | CRUD + dashboard items + gantt |
| files | ✅ | CRUD + download + **Сага §3: извлечение текста** |
| search-rag | ✅ | `/search` ILIKE + Ollama embedding + подписки на события |
| ai-gateway | ✅ | dictation + restore-punctuation + fallback + **Сага §1: генерация заголовков** |
| agent | ✅ | триггеры (deadline_soon, task_no_assignee) + **Сага §2: task status → suggestion** + today/week |
| email | ✅ | IMAP-аккаунты + sync + конвертация → note/task |
| external-calendars | ✅ | Yandex CalDAV + ICS URL + sync + **Сага §4: публикация external_events.created** |
| integrations | ✅ | webhooks + retry/DLQ + api-keys + **Сага §5: доставка событий** |
| time-tracking | ✅ | timesheet + stats + pomodoro (3 режима) |
| export-import | ✅ | ZIP-экспорт + импорт текста/JSON |
| sync | ✅ | sync-folders + scan |
| ops | ✅ | **DLQ-панель (stateless, без БД):** `GET /api/ops/v1/dlq` — просмотр dead-letter сообщений `@pmos/event-bus`; `POST /dlq/:seq/replay` — replay в исходный subject

**5 cross-service саг (docs/SAGA.md §1–§5) реализованы и проверены против реального NATS + Postgres:**
1. Note creation → AI title generation (notes ↔ ai-gateway)
2. Task status change → agent trigger → suggestion (tasks → agent)
3. File upload → text extraction → embedding (files → search-rag)
4. External calendar sync → local meeting (external-calendars → calendar)
5. Webhook delivery (integrations ← все события)

## Тесты

- Unit (vitest): `npx pnpm -r run test` — все зелёные (17 сервисов)
- Contract (OpenAPI-conformance): `npx pnpm -r run test:contract` — **17/17 green**
- Typecheck: `npx pnpm -r run typecheck` — **19/19 Done**
- Integration (Postgres + NATS): `DATABASE_URL=… DATABASE_SCHEMA=<svc>_ NATS_URL=nats://localhost:4222 npx vitest run test/integration` (в `services/<svc>/`) — **90/90 green**, включая 5 saga-наборов
- Build: `npx pnpm -r run build` — 17/17

## Известные ограничения

- **Ollama** опциональна: LLM-вызовы деградируют на эвристики (dictation-парсинг без LLM не работает; AI-заголовки и embedding используют fallback: первая строка текста / ILIKE-поиск).
- **Google Calendar OAuth** не реализован (📋 в FEATURES.md) — доступны Yandex CalDAV и ICS-URL.
- **WebSocket push** (api-gateway) не реализован — доставка уведомлений только через событийную шину/webhooks.
- E2E (Playwright) не входит в эту поставку: проверки покрыты integration-тестами сервисов.
