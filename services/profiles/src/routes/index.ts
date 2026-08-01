import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { eq, count, and, asc, desc, sql } from "drizzle-orm";
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

// #RRGGBB hex color (contract: pattern ^#[0-9a-fA-F]{6}$).
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// columns present on the backing table (used to guard optional order-by)
const tableCols = new Set<string>(["id", "name", "color", "description", "isDefault", "avatarUrl", "createdAt", "updatedAt"]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

export const profilesRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "profiles" }));

  // ───────────── profiles CRUD (reference pattern) ─────────────
  typed.get("/profiles", {
    schema: {
      querystring: Type.Object({
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),

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


    const where = conds.length ? and(...conds) : undefined;
    const rows = await db.select().from(schema.profiles).where(where)
      .orderBy(asc(schema.profiles.createdAt)).limit(limit).offset(offset);
    const total = await totalOf(schema.profiles, where);
    return reply.send({ data: rows, pagination: { offset, limit, total } });
  });

  typed.post("/profiles", {
    schema: { body: Type.Object({}, { additionalProperties: true }), response: { 201: Type.Any() } },
  }, async (req, reply) => {
    const body = req.body as any;
    // Color must be #RRGGBB hex (contract pattern ^#[0-9a-fA-F]{6}$).
    if (body.color !== undefined && typeof body.color === "string" && !COLOR_RE.test(body.color)) {
      return fail(422, "VALIDATION_ERROR", "color invalid format");
    }
    // First created profile automatically becomes the default one.
    const existing = await totalOf(schema.profiles);
    const values: any = { ...body };
    if (existing === 0) values.isDefault = true;
    const [row] = await db.insert(schema.profiles).values(values).returning();
    emit("pmos.profiles.profiles.created", row);
    return reply.code(201).send(row);
  });

  typed.get("/profiles/:profileId", {
    schema: { params: Type.Object({ profileId: Type.String() }), response: { 200: Type.Any(), 404: Type.Any() } },
  }, async (req, reply) => {
    const [row] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, (req.params as any).profileId)).limit(1);
    if (!row) return fail(404, "NOT_FOUND", "profiles not found");
    return reply.send(row);
  });

  typed.patch("/profiles/:profileId", {
    schema: { params: Type.Object({ profileId: Type.String() }), body: Type.Object({}, { additionalProperties: true }), response: { 200: Type.Any() } },
  }, async (req, reply) => {
    const body = req.body as any;
    // Color must be #RRGGBB hex (contract pattern ^#[0-9a-fA-F]{6}$).
    if (body.color !== undefined && typeof body.color === "string" && !COLOR_RE.test(body.color)) {
      return fail(422, "VALIDATION_ERROR", "color invalid format");
    }
    const patch: any = { ...body };
    if (colExists("updatedAt")) patch.updatedAt = new Date().toISOString();
    const [row] = await db.update(schema.profiles).set(patch)
      .where(eq(schema.profiles.id, (req.params as any).profileId)).returning();
    if (!row) return fail(404, "NOT_FOUND", "profiles not found");
    emit("pmos.profiles.profiles.updated", row);
    return reply.send(row);
  });

  typed.delete("/profiles/:profileId", {
    schema: { params: Type.Object({ profileId: Type.String() }) },
  }, async (req, reply) => {
    const id = (req.params as any).profileId;
    const [prev] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, id)).limit(1);
    if (!prev) return fail(404, "NOT_FOUND", "profiles not found");
    // Cannot delete the default profile.
    if (prev.isDefault) return fail(409, "CONFLICT", "Cannot delete default profile");
    // Cannot delete the last remaining profile.
    const total = await totalOf(schema.profiles);
    if (total <= 1) return fail(409, "CONFLICT", "Cannot delete the last remaining profile");
    const [row] = await db.delete(schema.profiles).where(eq(schema.profiles.id, id)).returning();
    if (!row) return fail(404, "NOT_FOUND", "profiles not found");
    emit("pmos.profiles.profiles.deleted", row);
    return reply.code(204).send();
  });
};
