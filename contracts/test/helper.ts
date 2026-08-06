/**
 * Shared helper for OpenAPI-conformance contract tests.
 *
 * Pragmatic replacement for Pact in the scaffold stage: instead of a Pact Broker
 * (see ADR-002 — deferred as infrastructure work), we assert that every
 * CRUD route declared in `contracts/openapi/<service>.yaml` is actually
 * registered by the service's Fastify app. This catches the #1 scaffold bug
 * ("route from contract is missing") without needing a live DB or a broker.
 *
 * Routes are mounted at `/api/<service>/v1`, so an OpenAPI path `/notes/{id}`
 * maps to `/api/notes/v1/notes/:id`.
 *
 * Policy:
 *  - CRUD collection+item paths (matching the RESOURCE map below) are STRICT:
 *    a missing one FAILS the test.
 *  - Everything else (KV stores like settings, nested/service-specific paths
 *    like `/agent/inbox`, `/search`, `/notes/{id}/ics`) is SOFT: reported as a
 *    warning but does not fail — the implementing agent fleshes these out.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import type { FastifyInstance } from "fastify";

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

/** Table name -> URL collection resource (mirrors scripts/gen-routes.mjs). */
export const RESOURCE: Record<string, string> = {
  profiles: "profiles",
  notes: "notes",
  tasks: "tasks",
  meetings: "meetings",
  projects: "projects",
  fileMeta: "files",
  agentMessages: "agent-messages",
  imapAccounts: "imap",
  externalCalendars: "calendars",
  webhooks: "webhooks",
  timesheet: "timesheet",
  syncFolders: "sync-folders",
};

/** Load and parse the OpenAPI document for a service. */
export function loadOpenapi(serviceName: string): any {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const file = join(root, "contracts", "openapi", `${serviceName}.yaml`);
  return YAML.parse(readFileSync(file, "utf8"));
}

/** Convert an OpenAPI path template (`/notes/{id}`) to a Fastify route (`/notes/:id`). */
function toFastifyPath(p: string): string {
  return p.replace(/\{([^}]+)\}/g, ":$1");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse Fastify printRoutes() tree output into a flat list of { method, path }. */
function flatRoutes(printed: string): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack: string[] = []; // path segments by depth
  for (const line of printed.split("\n")) {
    const marker = line.indexOf("└── ");
    const alt = line.indexOf("├── ");
    const idx = marker >= 0 ? marker : alt;
    if (idx < 0) continue;
    const depth = Math.round(idx / 4); // each indent level ~4 spaces
    const rest = line.slice(idx + 4).trim(); // after "└── " / "├── "
    const paren = rest.indexOf("(");
    let segment = (paren >= 0 ? rest.slice(0, paren) : rest).trim();
    if (!segment || segment === "/") {
      // empty / root-only segment (printRoutes emits a bare "/" node) — keep
      // the depth slot but contribute nothing to the path.
      stack[depth] = "";
      stack.length = depth + 1;
      continue;
    }
    segment = segment.replace(/^\/+/, ""); // Fastify emits nested segments with a leading slash
    segment = segment.replace(/\/+$/, ""); // drop trailing slash (e.g. "api/notes/v1/")
    segment = segment.replace(/\{[^/]+\}/g, (m) => ":" + m.slice(1, -1)); // {id} -> :id (match OpenAPI toFastifyPath)
    stack[depth] = segment;
    stack.length = depth + 1;
    const segs = stack.filter(Boolean);
    const full = "/" + segs.join("/");
    if (paren >= 0) {
      const methods = rest
        .slice(paren + 1, rest.indexOf(")", paren))
        .split(",")
        .map((m: string) => m.trim().toUpperCase())
        .filter(Boolean);
      for (const m of methods) {
        out.push({ method: m, path: full.toLowerCase() });
      }
    }
  }
  return out;
}

/** A path is a strict (CRUD) path if it is `<resource>` or `<resource>/:id`
 *  where `resource` is a known CRUD collection from RESOURCE. */
function strictResource(p: string): string | null {
  const f = toFastifyPath(p).replace(/^\//, "").toLowerCase(); // e.g. "notes/:id"
  const parts = f.split("/");
  if (parts.length === 1) {
    const r = Object.values(RESOURCE).find((v) => v === parts[0]);
    return r ?? null;
  }
  if (parts.length === 2 && parts[1].startsWith(":")) {
    const r = Object.values(RESOURCE).find((v) => v === parts[0]);
    return r ?? null;
  }
  return null;
}

/**
 * Fail the test if any STRICT (CRUD) OpenAPI route is not registered by the app.
 * `app` must be a built (not yet listening) Fastify instance.
 */
export async function assertRoutesMatch(
  serviceName: string,
  app: FastifyInstance,
  openapi: any,
): Promise<void> {
  await app.ready();
  // Fastify 5 has no getRoutes(); printRoutes() emits a tree. Parse it into a
  // flat { method, path } list so we can compare against the OpenAPI spec.
  const printed = (app.printRoutes({ includeMeta: false, commonPrefix: false }) ?? "").toString();
  const routes = flatRoutes(printed);
  const prefix = `/api/${serviceName}/v1`;
  const paths = openapi?.paths ?? {};
  const missingStrict: string[] = [];
  const missingSoft: string[] = [];

  for (const rawPath of Object.keys(paths)) {
    const methods = Object.keys(paths[rawPath]).filter((m) =>
      HTTP_METHODS.has(m.toLowerCase()),
    );
    const fastifyPath = `${prefix}${toFastifyPath(rawPath)}`.toLowerCase();
    const normPath = fastifyPath.replace(/:[^/]+/g, ":__param__"); // ignore param name
    const res = strictResource(rawPath);
    for (const method of methods) {
      const m = method.toUpperCase();
      const found = routes.some(
        (r) => r.method === m && r.path.replace(/:[^/]+/g, ":__param__") === normPath,
      );
      if (!found) {
        (res ? missingStrict : missingSoft).push(`${m} ${fastifyPath}`);
      }
    }
  }

  if (missingSoft.length) {
    console.warn(
      `[contract:${serviceName}] soft (non-CRUD) routes not registered yet: ` +
        missingSoft.join(", "),
    );
  }

  if (missingStrict.length) {
    throw new Error(
      `OpenAPI CRUD routes not registered for "${serviceName}":\n  - ${missingStrict.join("\n  - ")}`,
    );
  }

  // Runtime match guard: printRoutes() parsing above can give false positives when a
  // route is registered with an OpenAPI-style `{id}` param instead of Fastify's `:id`
  // (Fastify 5 only matches colon params at runtime, so `{id}` 404s). Verify each STRICT
  // route actually matches at runtime via hasRoute(), which uses the real radix tree.
  const matchFails: string[] = [];
  for (const rawPath of Object.keys(paths)) {
    if (!strictResource(rawPath)) continue;
    const methods = Object.keys(paths[rawPath]).filter((m) => HTTP_METHODS.has(m.toLowerCase()));
    const fastifyPath = `${prefix}${toFastifyPath(rawPath)}`.toLowerCase();
    for (const method of methods) {
      const m = method.toUpperCase();
      const matched = app.hasRoute({ method: m as any, url: fastifyPath });
      if (!matched) matchFails.push(`${m} ${fastifyPath}`);
    }
  }
  if (matchFails.length) {
    throw new Error(
      `OpenAPI CRUD routes do NOT match at runtime for "${serviceName}" ` +
        `(likely an OpenAPI-style {id} param instead of Fastify :id):\n  - ${matchFails.join("\n  - ")}`,
    );
  }
}
