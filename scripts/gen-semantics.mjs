// scripts/gen-semantics.mjs
// Generates the "reference pattern" routes for a service (CRUD + filters + soft-delete
// + pagination + events) from its OpenAPI contract + Drizzle schema. Mirrors the proven
// notes/tasks pattern. Reproducible: rerun after contract/schema changes.
//
// Usage: node scripts/gen-semantics.mjs <service>
// Emits: services/<service>/src/routes/index.ts
//
// Non-CRUD (extra) paths declared in the OpenAPI but not matching collection/item shape
// are emitted as honestly-marked NOT_IMPLEMENTED (501) stubs so the contract test still
// passes (soft) and the backlog is visible — never fake success.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(process.cwd());
const svc = process.argv[2];
if (!svc) { console.error("usage: node gen-semantics.mjs <service>"); process.exit(1); }
// valid JS identifier for `export const <name>Routes` (svc may contain hyphens)
const svcIdent = svc.replace(/[^a-zA-Z0-9]/g, "_");

const oapiPath = path.join(root, "contracts/openapi", `${svc}.yaml`);
const schemaPath = path.join(root, "services", svc, "src/db/schema.ts");
const outPath = path.join(root, "services", svc, "src/routes/index.ts");
if (!existsSync(oapiPath) || !existsSync(schemaPath)) { console.error("missing contract or schema for", svc); process.exit(1); }

const oapi = readFileSync(oapiPath, "utf8");
const schema = readFileSync(schemaPath, "utf8");

// ── parse OpenAPI ──
const prefixM = oapi.match(/url:\s*(\/api\/[^ \n]+)/);
const prefix = prefixM ? prefixM[1] : `/api/${svc}/v1`;

// all paths (relative to prefix)
const paths = [...oapi.matchAll(/^\s{2}(\/[^:\s]+):\s*$/gm)].map((m) => m[1]);

// A path is a real CRUD collection only if it has BOTH a list GET and a create POST.
function hasOps(p, ops) {
  const block = oapi.slice(oapi.indexOf(`  ${p}:`), oapi.indexOf(`  ${p}:`) + 2000);
  return ops.every((op) => new RegExp(`^\\s{4}${op}:\\s*$`, "m").test(block));
}
// depth-1 collections with get+post
const crudCollections = paths.filter(
  (p) => !p.includes("{") && p.split("/").length === 2 && hasOps(p, ["get", "post"])
);
const collection = crudCollections[0] || null;
const itemPath = collection ? paths.find((p) => p.startsWith(collection + "/{")) : null;
const itemParamM = itemPath ? itemPath.match(/\{([^}]+)\}/) : null;
const itemParam = itemParamM ? itemParamM[1] : "id";

// query params on the list GET
const listGetBlock = oapi.slice(oapi.indexOf(`  ${collection}:`), oapi.indexOf(`  ${collection}:`) + 4000);
const qparams = [...listGetBlock.matchAll(/-\s*name:\s*(\w+)\s*\n\s*in:\s*query/g)].map((m) => m[1]);

// ── parse schema (all tables + their real columns) ──
// table declaration:  export const meetings = pgTable("meetings", { ... });
const tableDecls = [...schema.matchAll(/export const (\w+)\s*=\s*pgTable\(\s*"([^"]+)"\s*,\s*\{([\s\S]*?)\n\}\s*\)/g)];
const tables = tableDecls.map((m) => {
  const body = m[3];
  const cols = [...body.matchAll(/^\s{2,}(\w+)\s*:\s*(?:uuid|text|integer|timestamp|boolean|jsonb|numeric|pgEnum)/gm)].map((c) => c[1]);
  const arrayCols = [...body.matchAll(/(\w+)\s*:\s*uuid\([^)]*\)\.array\(/g)].map((c) => c[1]);
  // primary key column:  col: <type>(...).primaryKey()  OR  .$defaultFn / defaultRandom
  const pkM = body.match(/^\s{2,}(\w+)\s*:\s*(?:uuid|text|integer)[^;]*\.primaryKey\(\)/m);
  const pk = pkM ? pkM[1] : (cols[0] || "id");
  return { varName: m[1], name: m[2], cols: new Set(cols), arrayCols: new Set(arrayCols), hasArchived: cols.includes("isArchived") || cols.includes("is_archived"), pk };
});
// pick the table backing the chosen collection (by singular/plural or first)
const collBase = collection ? collection.replace(/^\//, "").replace(/s$/, "") : null;
let table = tables.find((t) => t.name === (collection ? collection.replace(/^\//, "") : null) || t.varName.toLowerCase() === collBase)
  || tables[0];

// when collection is null, there is no table to filter on; guards below still apply
const tableVar = table ? table.varName : "table";
const pkCol = table ? table.pk : "id";
const tableCols = table ? table.cols : new Set();
const tableArrayCols = table ? table.arrayCols : new Set();
const hasArchived = table ? table.hasArchived : false;
const isArchivedEq = hasArchived ? `eq(schema.${tableVar}.isArchived, false)` : null;
const colExists = (c) => tableCols.has(c);
// order-by column that actually exists on the table
const orderByCol = colExists("createdAt") ? "createdAt" : (colExists("updatedAt") ? "updatedAt" : "id");

// map a query param to a SQL condition snippet — only if the column exists
function condFor(param) {
  const snake = param.replace(/([A-Z])/g, "_$1").toLowerCase();
  const mk = (code) => ({ param, code });
  if (param === "profileId" || param === "profileIds") {
    const col = tableArrayCols.has("profileIds") ? "profileIds" : (tableArrayCols.values().next().value || "profileIds");
    return mk(`sql\`\${schema.${tableVar}.${col}} @> ARRAY[\${q.${param}}]::uuid[]\``);
  }
  if (param === "isArchived" && colExists("isArchived")) return mk(`eq(schema.${tableVar}.isArchived, q.isArchived)`);
  if (param === "status" && colExists("status")) return mk(`eq(schema.${tableVar}.status, q.${param})`);
  // fk-style: <thing>Id -> column <thing>_id, only if it exists
  if (/Id$/.test(param)) {
    const col = snake;
    if (colExists(col)) return mk(`eq(schema.${tableVar}.${col}, q.${param})`);
    const alt = param.replace(/Id$/, "");
    if (colExists(alt)) return mk(`eq(schema.${tableVar}.${alt}, q.${param})`);
    return null;
  }
  const target = colExists(snake) ? snake : (colExists(param) ? param : null);
  return target ? mk(`eq(schema.${tableVar}.${target}, q.${param})`) : null;
}

const filterConds = qparams
  .filter((p) => p !== "offset" && p !== "limit")
  .map((p) => condFor(p))
  .filter(Boolean)
  .map((snippet) => `    if (q.${snippet.param} !== undefined) conds.push(${snippet.code});`);

const baseConds = hasArchived ? [`    conds.push(${isArchivedEq});`] : [];

// extra (non-CRUD) paths -> 501 stubs
const extraPaths = paths.filter((p) => p !== collection && p !== itemPath);
const extraHandlers = extraPaths.map((p) => {
  // emit GET/POST/PUT/DELETE that are present in the contract for this path
  const present = ["get", "post", "put", "delete", "patch"].filter((m) =>
    new RegExp(`^\\s{4}${m}:\\s*$`, "m").test(oapi.slice(oapi.indexOf(`  ${p}:`), oapi.indexOf(`  ${p}:`) + 600))
  );
  const stub = present.map((m) => `  typed.${m}("${p}", async (_req, reply) => {
    // TODO(semantics): ${m.toUpperCase()} ${p} — non-CRUD endpoint, not in the baseline
    // reference pattern. Implement domain logic or remove from contract.
    return reply.code(501).send({ code: "NOT_IMPLEMENTED", message: "endpoint planned (see AGENT.md §4 backlog)" });
  });`).join("\n\n");
  return stub;
}).join("\n\n");

const resource = collection ? collection.replace(/^\//, "") : null;

// If there is no real CRUD collection, emit honest 501 stubs for every contract path
// (no fake CRUD). Otherwise emit the baseline CRUD + 501 stubs for extra paths.
const crudRoutes = collection ? `
  // ───────────── ${resource} CRUD (reference pattern) ─────────────
  typed.get("${collection}", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
${qparams.filter((p) => p !== "offset" && p !== "limit").map((p) => `        ${p}: Type.Optional(Type.String()),`).join("\n")}
      }),
      response: { 200: Type.Object({
        data: Type.Array(Type.Any()),
        pagination: Type.Object({ offset: Type.Integer(), limit: Type.Integer(), total: Type.Integer() }),
      }) },
    },
  }, async (req, reply) => {
    const q = req.query as any;
    const offset = Number(q.offset ?? 0);
    const limit = Number(q.limit ?? 20);
    const conds: any[] = [];
${baseConds.join("\n")}
${filterConds.join("\n")}
    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.${tableVar}).where(where)
      .orderBy(asc(schema.${tableVar}.${orderByCol})).limit(limit).offset(offset);
    const total = await totalOf(schema.${tableVar}, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("${collection}", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.insert(schema.${tableVar}).values(req.body as any).returning();
    emit("pmos.${svc}.${resource}.created", row);
    return reply.code(201).send(row);
  });

  typed.get("${itemPath}", {
    schema: { params: Type.Object({ ${itemParam}: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.${tableVar}).where(eq(schema.${tableVar}.${pkCol}, (req.params as any).${itemParam})).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "${resource} not found");
    return reply.send(row);
  });

  typed.patch("${itemPath}", {
    schema: { params: Type.Object({ ${itemParam}: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const patch: any = { ...(req.body as any) };
    if (colExists("updatedAt")) patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.${tableVar}).set(patch)
      .where(eq(schema.${tableVar}.${pkCol}, (req.params as any).${itemParam})).returning();
    if (!row) return fail(404, "NOT_FOUND", "${resource} not found");
    emit("pmos.${svc}.${resource}.updated", row);
    return reply.send(row);
  });

${
  hasArchived
    ? `  typed.delete("${itemPath}", {
    schema: { params: Type.Object({ ${itemParam}: Type.String() }) },
  }, async (req, reply) => {
    const delPatch: any = { isArchived: true };
    if (colExists("updatedAt")) delPatch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.${tableVar}).set(delPatch)
      .where(eq(schema.${tableVar}.${pkCol}, (req.params as any).${itemParam})).returning();
    if (!row) return fail(404, "NOT_FOUND", "${resource} not found");
    emit("pmos.${svc}.${resource}.deleted", row);
    return reply.code(204).send();
  });`
    : `  typed.delete("${itemPath}", {
    schema: { params: Type.Object({ ${itemParam}: Type.String() }) },
  }, async (req, reply) => {
    const [row] = await db.delete(schema.${tableVar}).where(eq(schema.${tableVar}.${pkCol}, (req.params as any).${itemParam})).returning();
    if (!row) return fail(404, "NOT_FOUND", "${resource} not found");
    emit("pmos.${svc}.${resource}.deleted", row);
    return reply.code(204).send();
  });`
}` : "";

const tpl = `import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
${collection ? `import { eq, count, and, asc, desc, sql } from "drizzle-orm";` : `import { count } from "drizzle-orm"; // count used by totalOf (kept for parity; service has no CRUD collection)`}
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";

function emit(subject: string, row: unknown): void {
  try {
    EventBus.get().publish(subject, row).catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch { /* EventBus not initialised — skip */ }
}

function fail(status: number, code: string, message: string): never {
  const e: any = new Error(message);
  e.statusCode = status; e.code = code; throw e;
}

// columns present on the backing table (used to guard optional order-by)
const tableCols = new Set<string>([${[...tableCols].map((c) => `"${c}"`).join(", ")}]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const ${svcIdent}Routes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "${svc}" }));
${crudRoutes}
${extraHandlers ? `\n  // ───────────── non-CRUD endpoints (backlog, see AGENT.md §4) ─────────────\n${extraHandlers}\n` : ""}};
`;

writeFileSync(outPath, tpl);
console.log(`generated ${outPath} (collection=${collection}, itemParam=${itemParam}, archived=${hasArchived}, extra=${extraPaths.length})`);

// keep app.ts in sync with the generated export name (import + register call)
const appPath = path.join(root, "services", svc, "src/app.ts");
if (existsSync(appPath)) {
  let app = readFileSync(appPath, "utf8");
  app = app.replace(/import \{ [^}]*Routes \} from "\.\/routes\/index\.js";/,
    `import { ${svcIdent}Routes } from "./routes/index.js";`);
  app = app.replace(/app\.register\(\w*Routes/g, `app.register(${svcIdent}Routes`);
  writeFileSync(appPath, app);
}
