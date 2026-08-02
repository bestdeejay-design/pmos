import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, RouteHandlerMethod } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { apiKeys } from "../db/schema.js";

interface MirrorTarget {
  hostEnv: string;
  hostDefault: string;
  svcPath: string;
}

const TARGETS: Record<string, MirrorTarget> = {
  notes: { hostEnv: "PUBLIC_UPSTREAM_NOTES", hostDefault: "http://notes:3000", svcPath: "/api/notes/v1/notes" },
  tasks: { hostEnv: "PUBLIC_UPSTREAM_TASKS", hostDefault: "http://tasks:3000", svcPath: "/api/tasks/v1/tasks" },
  projects: { hostEnv: "PUBLIC_UPSTREAM_PROJECTS", hostDefault: "http://projects:3000", svcPath: "/api/projects/v1/projects" },
  calendar: { hostEnv: "PUBLIC_UPSTREAM_CALENDAR", hostDefault: "http://calendar:3000", svcPath: "/api/calendar/v1/meetings" },
};

function upstreamBase(name: string): string {
  const target = TARGETS[name];
  return target ? (process.env[target.hostEnv] ?? target.hostDefault) : "";
}

async function authenticate(rawKey: string): Promise<boolean> {
  const keyPrefix = rawKey.slice(0, 8);
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, keyPrefix)).limit(1);
  if (!row || !row.active) return false;
  const digest = createHash("sha256").update(rawKey).digest();
  const stored = Buffer.from(row.keyHash, "hex");
  return stored.length === digest.length && timingSafeEqual(stored, digest);
}

export const publicApiRoutes: FastifyPluginAsync = async (app) => {
  for (const [name, target] of Object.entries(TARGETS)) {
    const handler: RouteHandlerMethod = async (req, reply) => {
      const header = (req.headers.authorization ?? "").trim();
      if (!header.startsWith("Bearer ") || !(await authenticate(header.slice("Bearer ".length)))) {
        return reply.code(401).send({ code: "UNAUTHORIZED", message: "invalid or missing API key", details: null });
      }
      const wildcard = ((req.params as Record<string, unknown>)["*"] as string | undefined) ?? "";
      const qs = req.url.split("?")[1];
      const upstreamUrl = `${upstreamBase(name)}${target.svcPath}${wildcard ? "/" + wildcard : ""}${qs ? "?" + qs : ""}`;
      let resp: Response;
      try {
        resp = await fetch(upstreamUrl, { method: "GET" });
      } catch {
        return reply.code(502).send({ code: "BAD_GATEWAY", message: "upstream unavailable", details: null });
      }
      const text = await resp.text();
      return reply.code(resp.status).header("content-type", resp.headers.get("content-type") ?? "application/json").send(text);
    };

    // Match both the bare resource path (/tasks) and any sub-path (/tasks/abc).
    app.get(`/${name}`, handler);
    app.get(`/${name}/*`, handler);
  }
};