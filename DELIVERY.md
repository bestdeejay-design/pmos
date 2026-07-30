# DELIVERY.md — ЦУП Personal OS

> Заполняется строящим агентом при достижении Delivery Gate (AGENT.md §5).

## Как запустить

```bash
pnpm install
docker compose --profile core up -d      # Postgres + NATS
pnpm -r run db:migrate                    # применить миграции всех сервисов
docker compose --profile all up -d        # поднять все сервисы + gateway
# открыть http://localhost:8080
```

## Что реализовано (vs FEATURES.md)

| Сервис | Статус | Заметки |
|--------|--------|---------|
| profiles | ✅ | |
| settings | ✅ | |
| notes | ✅ | + AI title saga |
| tasks | ✅ | + recurrence/streaks |
| calendar | ✅ | + ICS |
| projects | ✅ | + Gantt |
| files | ✅ | + text extraction |
| search-rag | ✅ | + embeddings |
| ai-gateway | ✅ | Ollama fallback |
| agent | ✅ | triggers + digests |
| email | ✅ | IMAP sync |
| external-calendars | ✅ | Google/Yandex/ICS |
| integrations | ✅ | webhooks + public API |
| time-tracking | ✅ | timesheet + pomodoro |
| export-import | ✅ | ZIP/JSON |
| sync | ✅ | Obsidian-style |

## Тесты

- Unit (vitest): `pnpm -r run test` — все зелёные
- Contract (OpenAPI/Pact): см. `contracts/`
- Integration (sagas): `pnpm -r run test:integration`
- E2E (Playwright): `npx playwright test`

## Известные ограничения

- _заполняет агент_
