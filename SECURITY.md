# Security Policy

## Supported Versions

PMOS is a monorepo under active development. Security fixes are applied to the
latest state of the `main` branch and released with the next build.

| Branch | Supported |
|--------|-----------|
| `main` | ✅ latest |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, report them privately:

- **Email / private report:** open a [private vulnerability report](https://github.com/bestdeejay-design/pmos/security/advisories/new)
  on GitHub (preferred), or create a regular issue with the `security` label
  if private reports are unavailable.
- **Include:**
  - A description of the vulnerability and its impact
  - Steps to reproduce (proof of concept, if possible)
  - Affected components/services (e.g. `services/<name>`, `@pmos/event-bus`)
  - Suggested mitigation, if you have one

## What happens next

1. We acknowledge receipt within **5 business days**.
2. We investigate and confirm the issue, then decide on a fix and timeline
   (typically **30–90 days** depending on severity and complexity).
3. We keep you informed of progress.
4. When a fix is ready, it lands on `main` and the change is announced in the
   release notes / commit message. We credit reporters unless they ask
   to stay anonymous.

## Security-relevant areas in this codebase

- `@pmos/event-bus` — NATS JetStream publish/subscribe (message integrity, durable
  consumers, DLQ).
- `services/*/src/db/connection.ts` — DB credentials, schema isolation (`search_path`).
- `services/email/src/lib/crypto.ts` — IMAP password encryption.
- `services/integrations` — webhook delivery, API keys, retry/DLQ.
- `platform/docker/nginx.conf` — API gateway routing.
- LLM/AI integrations (`ai-gateway`, `search-rag`) — prompt/data boundaries.

## Out of scope

- The frontend/UI layer (planned, see `docs/BACKLOG.md`) — no public endpoints exist yet.
- Local development tooling that does not affect deployed deployments.
