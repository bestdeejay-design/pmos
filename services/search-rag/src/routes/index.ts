import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { count, and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import * as schema from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { embed } from "../lib/embed.js";

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
const tableCols = new Set<string>(["id", "entityType", "entityId", "content", "profileIds", "createdAt"]);
const colExists = (c: string): boolean => tableCols.has(c);

async function totalOf(t: any, where?: any): Promise<number> {
  const r = await db.select({ total: count() }).from(t).where(where).limit(1);
  return r[0]?.total ?? 0;
}

// Escape LIKE/ILIKE wildcards so user input is matched literally (case-insensitive).
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

// ts_headline wraps matched terms in <mark>…</mark> — collect them as the plain-text highlights.
function extractHighlights(snippet: string | null): string[] {
  if (!snippet) return [];
  const out: string[] = [];
  const re = /<mark>([^<]+)<\/mark>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet)) !== null) {
    const frag = (m[1] ?? "").trim();
    if (frag) out.push(frag);
  }
  return out;
}

// Public result shape — never leaks the (potentially huge) embedding vector.
// FTS metadata (rank/snippet/highlights) is appended when the full-text slice produced it.
function toResult(r: { id: string; entityType: string; entityId: string; content: string; profileIds: string[]; createdAt: string }, extra?: { rank?: number; snippet?: string; highlights?: string[] }): Record<string, unknown> {
  return {
    id: r.id,
    type: r.entityType,
    entityId: r.entityId,
    content: r.content,
    profileIds: r.profileIds,
    createdAt: r.createdAt,
    ...(extra?.rank != null ? { rank: extra.rank } : {}),
    ...(extra?.snippet ? { snippet: extra.snippet } : {}),
    ...(extra?.highlights?.length ? { highlights: extra.highlights } : {}),
  };
}

export const search_ragRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "search-rag" }));

  // POST /search — full-text (ILIKE) + optional semantic (Ollama embedding) search.
  // Matches contracts/openapi/search-rag.yaml → SearchQuery / SearchResult.
  typed.post("/search", {
    schema: {
      body: Type.Object({
        query: Type.String(),
        type: Type.Optional(Type.String()),
        tags: Type.Optional(Type.Array(Type.String())),
        projectId: Type.Optional(Type.String({ format: "uuid" })),
        profileIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      response: {
        200: Type.Object({
          results: Type.Array(Type.Any()),
          semantic: Type.Boolean(),
          total: Type.Integer(),
        }),
      },
    },
  }, async (req, reply) => {
    const q = req.body as {
      query: string;
      type?: string;
      tags?: string[];
      projectId?: string;
      profileIds?: string[];
      limit?: number;
      offset?: number;
    };
    const query = (q.query ?? "").trim();
    const limit = Number(q.limit ?? 20);
    const offset = Number(q.offset ?? 0);

    // Base filters (metadata jsonb carries tags/projectId harvested from source events).
    const conds: any[] = [];
    if (q.type) conds.push(eq(schema.embeddings.entityType, q.type));
    if (Array.isArray(q.profileIds) && q.profileIds.length) {
      conds.push(sql`${schema.embeddings.profileIds} @> ARRAY[${sql.join(q.profileIds.map((p) => sql`${p}::uuid`), sql`, `)}]`);
    }
    if (Array.isArray(q.tags) && q.tags.length) {
      conds.push(sql`${schema.embeddings.metadata}->'tags' ?| ARRAY[${sql.join(q.tags.map((t) => sql`${t}`), sql`, `)}]`);
    }
    if (q.projectId) {
      conds.push(sql`${schema.embeddings.metadata}->>'projectId' = ${q.projectId}`);
    }

    // ILIKE full-text slice (always available, graceful without Ollama).
    const needle = `%${escapeLike(query)}%`;
    const likeConds = query ? [...conds, ilike(schema.embeddings.content, needle)] : conds;
    const likeWhere = likeConds.length ? and(...likeConds) : undefined;
    const likeRows = query
      ? await db.select().from(schema.embeddings).where(likeWhere)
          .orderBy(desc(schema.embeddings.createdAt)).limit(limit).offset(offset)
      : [];
    const total = await totalOf(schema.embeddings, likeWhere);

    // PostgreSQL full-text slice (tsvector/GIN, migration 0003). websearch_to_tsquery
    // is safe for arbitrary user input; on parse failures (e.g. bare `!`/`*`) we fall
    // back to the ILIKE slice below. Ranks via ts_rank, snippet via ts_headline.
    let ftsRows: {
      id: string; entityType: string; entityId: string; content: string;
      profileIds: string[]; createdAt: string; rank: number; snippet: string;
    }[] = [];
    if (query) {
      try {
        const tsquery = sql`websearch_to_tsquery('simple', ${query})`;
        const ftsWhere = and(...[...conds, sql`${schema.embeddings.contentVector} @@ ${tsquery}`]);
        ftsRows = await db.select({
          id: schema.embeddings.id,
          entityType: schema.embeddings.entityType,
          entityId: schema.embeddings.entityId,
          content: schema.embeddings.content,
          profileIds: schema.embeddings.profileIds,
          createdAt: schema.embeddings.createdAt,
          rank: sql<number>`ts_rank(${schema.embeddings.contentVector}, ${tsquery})`,
          snippet: sql<string>`ts_headline('pg_catalog.simple', ${schema.embeddings.content}, ${tsquery}, 'MaxWords=40, MinWords=10, MaxFragments=3, StartSel=<mark>, StopSel=</mark>')`,
        }).from(schema.embeddings).where(ftsWhere)
          .orderBy(sql`ts_rank(${schema.embeddings.contentVector}, ${tsquery}) desc, ${schema.embeddings.createdAt} desc`)
          .limit(limit).offset(offset);
      } catch {
        ftsRows = [];
      }
    }

    let semantic = false;
    let results: Record<string, unknown>[] = [];

    if (query) {
      const vec = await embed(query);
      let semRows: schema.EmbeddingRow[] = [];
      if (vec && vec.length) {
        // Semantic slice over the same filters (embedding present), cosine distance.
        const semConds = conds.length ? and(...conds, sql`${schema.embeddings.embedding} IS NOT NULL`)
          : sql`${schema.embeddings.embedding} IS NOT NULL`;
        const vecLit = `[${vec.join(",")}]`;
        semRows = await db.select().from(schema.embeddings).where(semConds)
          .orderBy(sql`${schema.embeddings.embedding} <=> ${vecLit}::vector`).limit(limit + offset);
        if (semRows.length) semantic = true;
      }

      // Merge/rank: semantic hits first (dedup), then FTS-ranked hits, then ILIKE fills the page.
      const seen = new Set<string>();
      if (semantic) {
        for (const r of semRows.slice(offset, offset + limit)) {
          results.push(toResult(r));
          seen.add(String(r.id));
        }
      }
      for (const f of ftsRows) {
        if (seen.has(f.id)) continue;
        results.push(toResult(f, { rank: f.rank, snippet: f.snippet, highlights: extractHighlights(f.snippet) }));
        seen.add(f.id);
        if (results.length >= limit) break;
      }
      for (const r of likeRows) {
        if (seen.has(r.id)) continue;
        results.push(toResult(r));
        seen.add(r.id);
        if (results.length >= limit) break;
      }
    }

    return reply.send({ results, semantic, total });
  });
};
