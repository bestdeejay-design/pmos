#!/usr/bin/env node
/**
 * gen-routes.mjs — LEGACY route generator. Produces a thin CRUD stub WITHOUT filters,
 * soft-delete, or business logic.
 *
 * ⚠️ DO NOT run this over a service that already has a reference impl (notes/tasks/calendar)
 * or a gen-semantics.mjs output — it overwrites and silently drops business logic.
 * Use `scripts/gen-semantics.mjs <svc>` for the canonical "reference pattern" routes.
 * See docs/ADR/ADR-007.md §8 R2. Kept only to bootstrap a brand-new service from scratch.
 *
 * Each routes/index.ts keeps GET /health-check (required by existing tests) and implements:
 *   - CRUD over the primary table (list with offset/limit pagination, get, create, patch, delete)
 *   - service-specific endpoints from FEATURES.md
 * Timestamps use `.toISOString()` (Drizzle mode:"string", ADR-007 §8 R3).
 * Idempotent: overwrites services/<svc>/src/routes/index.ts.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ---- type helpers ----
const TB = {
  string: "Type.String()",
  integer: "Type.Integer()",
  number: "Type.Number()",
  boolean: "Type.Boolean()",
  any: "Type.Any()",
  array: "Type.Array(Type.String())",
  uuid: "Type.String({ format: \"uuid\" })",
};

// Build a TypeBox Object schema text from a field list.
// fields: [{ name, type, optional }]
function objSchema(fields) {
  const lines = fields.map((f) => {
    const t = TB[f.type] ?? "Type.Any()";
    return `    ${f.name}: ${f.optional ? `Type.Optional(${t})` : t},`;
  });
  return `Type.Object({\n${lines.join("\n")}\n  }, { additionalProperties: true })`;
}

// Generic CRUD block over a table const (schema.<tbl>).
// Map Drizzle table name -> URL collection resource (matches OpenAPI crudPaths).
const RESOURCE = {
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

function crud(svc, tbl, createFields, updateFields, idType = "Type.String()") {
  const resource = RESOURCE[tbl] ?? tbl;              // collection path segment
  const base = `/${resource}`;
  const createSchema = objSchema(createFields);
  const updateSchema = objSchema(updateFields);
  return `
  // ───────────── ${tbl} CRUD ─────────────
  app.get("${base || "/"}", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      response: {
        200: Type.Object({
          data: Type.Array(Type.Any()),
          pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
        }),
      },
    },
  }, async (req, reply) => {
    const offset = Number((req.query as any).offset ?? 0);
    const limit = Number((req.query as any).limit ?? 20);
    const rows = await db.select().from(schema.${tbl}).limit(limit).offset(offset);
    const total = await totalOf(schema.${tbl});
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  app.post("${base || "/"}", {
    schema: { body: ${createSchema}, response: { 201: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.insert(schema.${tbl}).values(req.body as any).returning();
    emit('pmos.${svc}.${resource}.created', row);
    return reply.code(201).send(row);
  });

  app.get("${base}/:id", {
    schema: { params: Type.Object({ id: ${idType} }), response: { 200: Type.Any(), 404: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.${tbl}).where(eq(schema.${tbl}.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "${tbl} not found");
    return reply.send(row);
  });

  app.patch("${base}/:id", {
    schema: { params: Type.Object({ id: ${idType} }), body: ${updateSchema}, response: { 200: Type.Any() } }
  }, async (req, reply) => {
    const [row] = await db.update(schema.${tbl}).set({ ...(req.body as any), updatedAt: new Date().toISOString() })
      .where(eq(schema.${tbl}.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "${tbl} not found");
    emit('pmos.${svc}.${resource}.updated', row);
    return reply.send(row);
  });

  app.delete("${base}/:id", {
    schema: { params: Type.Object({ id: ${idType} }) }
  }, async (req, reply) => {
    const [row] = await db.delete(schema.${tbl}).where(eq(schema.${tbl}.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "${tbl} not found");
    emit('pmos.${svc}.${resource}.deleted', row);
    return reply.code(204).send();
  });
`;
}

// ---- per-service route generators ----
const GEN = {};

// 1. profiles
GEN.profiles = () => wrap("profiles", `
${crud("profiles", "profiles",
  [{ name: "name", type: "string" }],
  [{ name: "name", type: "string", optional: true }, { name: "color", type: "string", optional: true }, { name: "description", type: "string", optional: true }, { name: "isDefault", type: "boolean", optional: true }, { name: "avatarUrl", type: "string", optional: true }])}
`);

// 2. settings (key-value, custom)
GEN.settings = () => wrap("settings", `
  app.get("/", async (_req, reply) => {
    const rows = await db.select().from(schema.settings);
    return reply.send({ data: rows });
  });

  app.get("/:key", {
    schema: { params: Type.Object({ key: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, (req.params as any).key)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "setting not found");
    return reply.send(row);
  });

  app.post("/", {
    schema: { body: Type.Object({ key: Type.String(), value: Type.Any() }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const body = req.body as any;
    const [row] = await db.insert(schema.settings).values({ key: body.key, value: body.value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: body.value, updatedAt: new Date().toISOString() } }).returning();
    return reply.code(200).send(row);
  });

  app.delete("/:key", {
    schema: { params: Type.Object({ key: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.settings).where(eq(schema.settings.key, (req.params as any).key)).returning();
    if (!row) return fail(404, "NOT_FOUND", "setting not found");
    return reply.code(204).send();
  });

  app.get("/ollama-models", async (_req, reply) => {
    return reply.send({ data: [] });
  });
`);

// 3. notes
GEN.notes = () => wrap("notes", `
${crud("notes", "notes",
  [{ name: "title", type: "string" }, { name: "bodyMd", type: "string", optional: true }, { name: "tags", type: "array", optional: true }, { name: "profileIds", type: "array", optional: true }, { name: "linkedProjectId", type: "uuid", optional: true }, { name: "linkedMeetingId", type: "uuid", optional: true }, { name: "linkedTaskId", type: "uuid", optional: true }],
  [{ name: "title", type: "string", optional: true }, { name: "bodyMd", type: "string", optional: true }, { name: "tags", type: "array", optional: true }, { name: "profileIds", type: "array", optional: true }, { name: "linkedProjectId", type: "uuid", optional: true }, { name: "linkedMeetingId", type: "uuid", optional: true }, { name: "linkedTaskId", type: "uuid", optional: true }, { name: "isArchived", type: "boolean", optional: true }])}
`);

// 4. tasks (+ priorities)
GEN.tasks = () => wrap("tasks", `
${crud("tasks", "tasks",
  [{ name: "title", type: "string" }, { name: "status", type: "string", optional: true }, { name: "priority", type: "integer", optional: true }, { name: "description", type: "string", optional: true }, { name: "assignee", type: "string", optional: true }, { name: "deadline", type: "string", optional: true }, { name: "projectId", type: "uuid", optional: true }, { name: "profileIds", type: "array", optional: true }, { name: "recurrence", type: "string", optional: true }],
  [{ name: "title", type: "string", optional: true }, { name: "status", type: "string", optional: true }, { name: "priority", type: "integer", optional: true }, { name: "description", type: "string", optional: true }, { name: "assignee", type: "string", optional: true }, { name: "deadline", type: "string", optional: true }, { name: "projectId", type: "uuid", optional: true }, { name: "profileIds", type: "array", optional: true }, { name: "recurrence", type: "string", optional: true }, { name: "isArchived", type: "boolean", optional: true }])}

  app.get("/priorities", async (_req, reply) => {
    const rows = await db.select().from(schema.tasks).orderBy(schema.tasks.priority).limit(100);
    return reply.send({ data: rows });
  });

  app.put("/priorities/order", {
    schema: { body: Type.Object({ orderedIds: Type.Array(Type.String({ format: "uuid" })) }, { additionalProperties: true }) },
  }, async (_req, reply) => {
    return reply.send({ ok: true });
  });
`);

// 5. calendar (+ ics)
GEN.calendar = () => wrap("calendar", `
${crud("calendar", "meetings",
  [{ name: "title", type: "string" }, { name: "startTime", type: "string" }, { name: "endTime", type: "string" }, { name: "allDay", type: "boolean", optional: true }, { name: "description", type: "string", optional: true }, { name: "location", type: "string", optional: true }, { name: "recurrence", type: "string", optional: true }, { name: "linkedProjectId", type: "uuid", optional: true }, { name: "profileIds", type: "array", optional: true }],
  [{ name: "title", type: "string", optional: true }, { name: "startTime", type: "string", optional: true }, { name: "endTime", type: "string", optional: true }, { name: "allDay", type: "boolean", optional: true }, { name: "description", type: "string", optional: true }, { name: "location", type: "string", optional: true }, { name: "recurrence", type: "string", optional: true }, { name: "linkedProjectId", type: "uuid", optional: true }, { name: "profileIds", type: "array", optional: true }])}

  app.get("/meetings/:id/ics", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.meetings).where(eq(schema.meetings.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "meeting not found");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//pmos//EN",
      "BEGIN:VEVENT", \`UID:\${row.id}\`, \`SUMMARY:\${row.title}\`,
      \`DTSTART:\${new Date(row.startTime).toISOString().replace(/[-:]/g, "").split(".")[0]}Z\`,
      \`DTEND:\${new Date(row.endTime).toISOString().replace(/[-:]/g, "").split(".")[0]}Z\`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\\n");
    return reply.header("content-type", "text/calendar").send(ics);
  });
`);

// 6. projects (+ items/gantt stubs)
GEN.projects = () => wrap("projects", `
${crud("projects", "projects",
  [{ name: "name", type: "string" }, { name: "description", type: "string", optional: true }, { name: "goal", type: "string", optional: true }, { name: "status", type: "string", optional: true }, { name: "profileIds", type: "array", optional: true }],
  [{ name: "name", type: "string", optional: true }, { name: "description", type: "string", optional: true }, { name: "goal", type: "string", optional: true }, { name: "status", type: "string", optional: true }, { name: "profileIds", type: "array", optional: true }])}

  app.get("/:id/items", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "project not found");
    return reply.send({ notes: [], tasks: [], meetings: [], files: [] });
  });

  app.get("/:id/gantt", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.projects).where(eq(schema.projects.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "project not found");
    // Cross-service data (tasks) is fetched via events/gateway at runtime; return empty here.
    return reply.send({ tasks: [] });
  });
`);

// 7. files (+ download)
GEN.files = () => wrap("files", `
${crud("files", "fileMeta",
  [{ name: "filename", type: "string" }, { name: "mimeType", type: "string" }, { name: "size", type: "integer", optional: true }, { name: "ownerType", type: "string", optional: true }, { name: "ownerId", type: "uuid", optional: true }, { name: "storagePath", type: "string" }, { name: "profileIds", type: "array", optional: true }],
  [{ name: "filename", type: "string", optional: true }, { name: "mimeType", type: "string", optional: true }, { name: "size", type: "integer", optional: true }, { name: "ownerType", type: "string", optional: true }, { name: "ownerId", type: "uuid", optional: true }, { name: "storagePath", type: "string", optional: true }, { name: "profileIds", type: "array", optional: true }])}

  app.get("/:id/download", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.fileMeta).where(eq(schema.fileMeta.id, (req.params as any).id)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "file not found");
    return reply.header("content-type", row.mimeType).send(Buffer.from(""));
  });
`);

// 8. search-rag (semantic search over embeddings)
GEN["search-rag"] = () => wrap("search-rag", `
  app.post("/search", {
    schema: { body: Type.Object({
      query: Type.String(),
      type: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      projectId: Type.Optional(Type.String({ format: "uuid" })),
      profileIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
      limit: Type.Optional(Type.Integer()),
    }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const body = req.body as any;
    const rows = await db.select().from(schema.embeddings).limit(Number(body.limit ?? 20));
    return reply.send({ results: rows, semantic: false, total: rows.length });
  });
`);

// 9. ai-gateway (stateless; log requests)
GEN["ai-gateway"] = () => wrap("ai-gateway", `
  async function logAndEcho(kind: string, req: any, reply: any) {
    const body = req.body as any;
    await db.insert(schema.aiRequestLog).values({ kind, model: body.model ?? null, promptChars: String(body.text ?? "").length }).returning();
    return reply.send({ text: body.text ?? "" });
  }

  app.post("/restore-punctuation", {
    schema: { body: Type.Object({ text: Type.String(), model: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (req, reply) => logAndEcho("restore_punctuation", req, reply));

  app.post("/dictate", {
    schema: { body: Type.Object({ text: Type.String(), model: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const body = req.body as any;
    await db.insert(schema.aiRequestLog).values({ kind: "dictate", model: body.model ?? null, promptChars: String(body.text ?? "").length }).returning();
    const words = String(body.text ?? "").trim().split(/\\s+/).filter(Boolean);
    const title = words.slice(0, 5).join(" ") || "Untitled";
    return reply.send({ title, bodyMd: body.text ?? "", tag: "note" });
  });
`);

// 10. agent (+ inbox/digest)
GEN.agent = () => wrap("agent", `
${crud("agent", "agentMessages",
  [{ name: "title", type: "string" }, { name: "body", type: "string" }, { name: "type", type: "string" }, { name: "source", type: "string", optional: true }, { name: "status", type: "string", optional: true }, { name: "actions", type: "any", optional: true }],
  [{ name: "title", type: "string", optional: true }, { name: "body", type: "string", optional: true }, { name: "type", type: "string", optional: true }, { name: "source", type: "string", optional: true }, { name: "status", type: "string", optional: true }, { name: "actions", type: "any", optional: true }])}

  app.get("/agent/inbox", {
    schema: { querystring: Type.Object({ status: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) }) },
  }, async (req, reply) => {
    const offset = Number((req.query as any).offset ?? 0);
    const limit = Number((req.query as any).limit ?? 20);
    const rows = await db.select().from(schema.agentMessages).limit(limit).offset(offset);
    const total = await totalOf(schema.agentMessages);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  app.post("/agent/respond", {
    schema: { body: Type.Object({ messageId: Type.String({ format: "uuid" }), action: Type.String(), reply: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ ok: true }));

  app.post("/agent/dismiss-all", async (_req, reply) => reply.send({ dismissed: 0 }));

  app.get("/today", async (_req, reply) => reply.send({ meetings: [], tasks: [], messages: [] }));
  app.get("/week", async (_req, reply) => reply.send({ meetings: [], tasks: [] }));
`);

// 11. email (imap accounts + emails)
GEN.email = () => wrap("email", `
${crud("email", "imapAccounts",
  [{ name: "host", type: "string" }, { name: "port", type: "integer", optional: true }, { name: "ssl", type: "boolean", optional: true }, { name: "username", type: "string" }, { name: "encryptedPassword", type: "string" }, { name: "syncEnabled", type: "boolean", optional: true }, { name: "profileIds", type: "array", optional: true }],
  [{ name: "host", type: "string", optional: true }, { name: "port", type: "integer", optional: true }, { name: "ssl", type: "boolean", optional: true }, { name: "username", type: "string", optional: true }, { name: "encryptedPassword", type: "string", optional: true }, { name: "syncEnabled", type: "boolean", optional: true }, { name: "profileIds", type: "array", optional: true }])}

  app.post("/imap/:id/sync", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (_req, reply) => reply.send({ synced: 0 }));

  app.get("/imap/emails", {
    schema: { querystring: Type.Object({ accountId: Type.Optional(Type.String({ format: "uuid" })), isArchived: Type.Optional(Type.Boolean()), offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) }) },
  }, async (req, reply) => {
    const offset = Number((req.query as any).offset ?? 0);
    const limit = Number((req.query as any).limit ?? 20);
    const rows = await db.select().from(schema.emails).limit(limit).offset(offset);
    const total = await totalOf(schema.emails);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  app.patch("/imap/emails", {
    schema: { body: Type.Object({ id: Type.Optional(Type.String({ format: "uuid" })), isArchived: Type.Optional(Type.Boolean()), convertTo: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ ok: true }));
`);

// 12. external-calendars
GEN["external-calendars"] = () => wrap("external-calendars", `
${crud("external-calendars", "externalCalendars",
  [{ name: "displayName", type: "string" }, { name: "provider", type: "string" }, { name: "syncEnabled", type: "boolean", optional: true }, { name: "authData", type: "any", optional: true }],
  [{ name: "displayName", type: "string", optional: true }, { name: "provider", type: "string", optional: true }, { name: "syncEnabled", type: "boolean", optional: true }, { name: "authData", type: "any", optional: true }])}

  app.post("/calendars/sync/:id", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (_req, reply) => reply.send({ syncedEvents: 0 }));

  app.get("/calendars/:id/events", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    const rows = await db.select().from(schema.externalEvents).where(eq(schema.externalEvents.calendarId, (req.params as any).id)).limit(200);
    return reply.send({ data: rows });
  });

  app.patch("/calendars/events/:id/link", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }), body: Type.Object({ meetingId: Type.Optional(Type.String({ format: "uuid" })) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ ok: true }));
`);

// 13. integrations (webhooks + api-keys)
GEN.integrations = () => wrap("integrations", `
${crud("integrations", "webhooks",
  [{ name: "url", type: "string" }, { name: "events", type: "array" }, { name: "secret", type: "string", optional: true }, { name: "active", type: "boolean", optional: true }],
  [{ name: "url", type: "string", optional: true }, { name: "events", type: "array", optional: true }, { name: "secret", type: "string", optional: true }, { name: "active", type: "boolean", optional: true }])}

  app.get("/webhooks/:id/deliveries", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }), querystring: Type.Object({ offset: Type.Optional(Type.Integer()), limit: Type.Optional(Type.Integer()) }) },
  }, async (req, reply) => {
    const offset = Number((req.query as any).offset ?? 0);
    const limit = Number((req.query as any).limit ?? 20);
    const rows = await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, (req.params as any).id)).limit(limit).offset(offset);
    const total = await totalOf(schema.webhookDeliveries);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  app.get("/api-keys", async (_req, reply) => {
    const rows = await db.select().from(schema.apiKeys);
    return reply.send({ data: rows });
  });

  app.post("/api-keys", {
    schema: { body: Type.Object({ name: Type.String() }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.apiKeys).values({ name: (req.body as any).name, keyHash: "pending", active: true }).returning();
    return reply.code(201).send(row);
  });

  app.delete("/api-keys/:id", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }) },
  }, async (req, reply) => {
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, (req.params as any).id)).returning();
    return reply.code(204).send();
  });
`);

// 14. time-tracking
GEN["time-tracking"] = () => wrap("time-tracking", `
${crud("time-tracking", "timesheet",
  [{ name: "startedAt", type: "string" }, { name: "taskId", type: "uuid", optional: true }, { name: "description", type: "string", optional: true }, { name: "endedAt", type: "string", optional: true }, { name: "durationSec", type: "integer", optional: true }, { name: "profileIds", type: "array", optional: true }],
  [{ name: "startedAt", type: "string", optional: true }, { name: "taskId", type: "uuid", optional: true }, { name: "description", type: "string", optional: true }, { name: "endedAt", type: "string", optional: true }, { name: "durationSec", type: "integer", optional: true }, { name: "profileIds", type: "array", optional: true }])}

  app.get("/timesheet/stats", async (_req, reply) =>
    reply.send({ todayTotal: 0, weekTotal: 0, byTask: [], byProject: [] }));

  app.get("/pomodoro", async (_req, reply) => {
    const rows = await db.select().from(schema.pomodoroSessions).limit(100);
    return reply.send({ data: rows, pagination: { offset: 0, limit: 100, total: rows.length } });
  });

  app.post("/pomodoro", {
    schema: { body: Type.Object({ mode: Type.String(), plannedMin: Type.Optional(Type.Integer()), taskId: Type.Optional(Type.String({ format: "uuid" })) }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.pomodoroSessions).values(req.body as any).returning();
    return reply.code(201).send(row);
  });

  app.patch("/pomodoro/:id", {
    schema: { params: Type.Object({ id: Type.String({ format: "uuid" }) }), body: Type.Object({ endedAt: Type.Optional(Type.String()), completed: Type.Optional(Type.Boolean()) }, { additionalProperties: true }) },
  }, async (req, reply) => {
    const [row] = await db.update(schema.pomodoroSessions).set(req.body as any).where(eq(schema.pomodoroSessions.id, (req.params as any).id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "pomodoro session not found");
    return reply.send(row);
  });
`);

// 15. export-import
GEN["export-import"] = () => wrap("export-import", `
  app.get("/export", {
    schema: { querystring: Type.Object({ format: Type.Optional(Type.String()) }) },
  }, async (_req, reply) =>
    reply.header("content-type", "application/zip").send(Buffer.from("PK\\x05\\x06")));

  app.post("/import", {
    schema: { body: Type.Object({ format: Type.String(), content: Type.String(), target: Type.Optional(Type.String()) }, { additionalProperties: true }) },
  }, async (_req, reply) => reply.send({ importedNotes: 0, importedTasks: 0, importedCalendars: 0 }));
`);

// 16. sync
GEN.sync = () => wrap("sync", `
${crud("sync", "syncFolders",
  [{ name: "path", type: "string" }, { name: "autoImport", type: "boolean", optional: true }, { name: "autoExport", type: "boolean", optional: true }, { name: "profileScope", type: "any", optional: true }],
  [{ name: "path", type: "string", optional: true }, { name: "autoImport", type: "boolean", optional: true }, { name: "autoExport", type: "boolean", optional: true }, { name: "profileScope", type: "any", optional: true }])}
`);

// ---- wrapper: imports + health-check + fail helper ----
function wrap(svc, body) {
  const exportName = `${svc.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Routes`;
  return `import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

// Best-effort event publish. Skipped silently if the bus isn't initialised
// (e.g. unit tests) or NATS is unreachable — never breaks the HTTP request.
function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error('[event] publish ' + subject + ' failed:', e));
  } catch {
    /* EventBus not initialised — skip */
  }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status;
  e.code = code;
  throw e;
}

async function totalOf(t: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).limit(1);
  return r[0]?.total ?? 0;
}

export const ${exportName}: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "${svc}" }));
${body.replace(/\bapp\.(get|post|patch|delete|put)\b/g, "typed.$1")}
};
`;
}

// ---- write files ----
let count = 0;
for (const [name, gen] of Object.entries(GEN)) {
  const target = join(ROOT, "services", name, "src", "routes", "index.ts");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, gen());
  count++;

  // update app.ts: fix route import name + prefix to match this service
  const exportName = `${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Routes`;
  const appTs = join(ROOT, "services", name, "src", "app.ts");
  if (existsSync(appTs)) {
    let src = readFileSync(appTs, "utf8");
    src = src.replace(/import \{ \w+Routes \} from "\.\/routes\/index\.js";/,
      `import { ${exportName} } from "./routes/index.js";`);
    src = src.replace(/await app\.register\(\w+Routes, \{ prefix: "\/api\/[-\w]+\/v1" \}\);/,
      `await app.register(${exportName}, { prefix: "/api/${name}/v1" });`);
    // wire the event bus + best-effort connect (idempotent — add only if absent)
    if (!/EventBus/.test(src)) {
      src = src.replace(
        /import \{ errorHandler \} from "\.\/lib\/errors\.js";/,
        'import { errorHandler } from "./lib/errors.js";\nimport { EventBus } from "@pmos/event-bus";',
      );
    }
    if (!/EventBus\.init/.test(src)) {
      src = src.replace(
        /export async function buildApp\(\) \{/,
        'export async function buildApp() {\n  EventBus.init({ serviceName: "' + name + '", url: process.env.NATS_URL });',
      );
    }
    if (!/ensureStream/.test(src)) {
      src = src.replace(
        /EventBus\.init\(\{ serviceName: "[^"]*"[^}]*\}\);/,
        'EventBus.init({ serviceName: "' + name + '", url: process.env.NATS_URL });\n  // Best-effort: connect + ensure the JetStream stream exists. Skipped if NATS is down.\n  await EventBus.get().connect().then(() => EventBus.get().ensureStream()).catch(() => {});',
      );
    }
    writeFileSync(appTs, src);
  }
}
console.log(`Generated routes for ${count} services.`);
