import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import { db } from "../db/connection.js";
import { aiRequestLog } from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { ollamaGenerate, parseDictation, selectedModel, heuristicTitle } from "../lib/llm.js";

// ───────────────────────── helpers ─────────────────────────

function fail(status: number, code: string, message: string): never {
  const e = new Error(message) as Error & { statusCode?: number; code?: string };
  e.statusCode = status;
  e.code = code;
  throw e;
}

// Best-effort event publish. Skipped silently if the bus isn't initialised
// (e.g. unit tests) or NATS is unreachable — never breaks the HTTP request.
function publish(subject: string, data: unknown, correlationId?: string): void {
  try {
    EventBus.get()
      .publish(subject, data, { correlationId })
      .catch((e) => console.error("[event] publish " + subject + " failed:", e));
  } catch {
    /* EventBus not initialised — skip */
  }
}

// Best-effort observability log. DB unreachable must never 500 the request.
async function logRequest(kind: "dictate" | "restore_punctuation", model: string, promptChars: number): Promise<void> {
  try {
    await db.insert(aiRequestLog).values({ kind, model, promptChars });
  } catch (e) {
    console.error("[ai-gateway] failed to log request to ai_request_log:", e);
  }
}

interface AiTextBody {
  text: string;
  model?: string;
}

function buildDictationPrompt(text: string): string {
  return [
    "Ты — ассистент по диктовке. Преобразуй сырой распознанный текст в структурированную заметку.",
    "Ответь строго в формате:",
    "ТЕЛО:",
    "<тело заметки в Markdown>",
    "ЗАГОЛОВОК:",
    "<короткий заголовок до 60 символов>",
    "ТЕГ:",
    "<один тег>",
    "",
    "Исходный текст:",
    text,
  ].join("\n");
}

/** Heuristic fallback when the LLM is unreachable or its output cannot be parsed. */
function heuristicDictation(text: string): { title: string; bodyMd: string; tag: null } {
  return { title: heuristicTitle(text), bodyMd: text, tag: null };
}

export const ai_gatewayRoutes: FastifyPluginAsync = async (app) => {
  const typed = app.withTypeProvider<TypeBoxTypeProvider>();

  typed.get("/health-check", async () => ({ ok: true, service: "ai-gateway" }));

  // ───────────── AI: restore punctuation ─────────────
  typed.post<{ Body: AiTextBody }>("/restore-punctuation", {
    schema: {
      body: Type.Object({ text: Type.String(), model: Type.Optional(Type.String()) }),
      response: {
        200: Type.Object({ text: Type.String(), degraded: Type.Boolean() }),
      },
    },
  }, async (req, reply) => {
    const { text, model } = req.body;
    const usedModel = selectedModel(model);
    const prompt = [
      "Ты — редактор. Восстанови пропущенную пунктуацию в тексте, сохранив все слова без изменений.",
      "Верни только исправленный текст без пояснений и без вступительных фраз.",
      "",
      "Текст:",
      text,
    ].join("\n");

    let degraded = false;
    let restored = text;
    try {
      const raw = await ollamaGenerate(prompt, usedModel);
      const cleaned = raw.trim();
      if (cleaned.length > 0) restored = cleaned;
      else degraded = true;
    } catch {
      degraded = true; // external LLM failure → graceful fallback (input unchanged)
    }

    await logRequest("restore_punctuation", usedModel, prompt.length);
    const correlationId = (req.headers["x-correlation-id"] as string | undefined);
    publish("pmos.ai-gateway.punctuation.restored", { text, restoredText: restored }, correlationId);
    return reply.send({ text: restored, degraded });
  });

  // ───────────── AI: dictation → structured note ─────────────
  typed.post<{ Body: AiTextBody }>("/dictate", {
    schema: {
      body: Type.Object({ text: Type.String(), model: Type.Optional(Type.String()) }),
      response: {
        200: Type.Object({
          title: Type.String(),
          bodyMd: Type.String(),
          tag: Type.Optional(Type.String()),
          degraded: Type.Boolean(),
        }),
      },
    },
  }, async (req, reply) => {
    const { text, model } = req.body;
    const usedModel = selectedModel(model);
    const prompt = buildDictationPrompt(text);

    let degraded = false;
    let title: string | null = null;
    let bodyMd: string | null = null;
    let tag: string | null = null;
    try {
      const raw = await ollamaGenerate(prompt, usedModel);
      const parsed = parseDictation(raw);
      title = parsed.title;
      bodyMd = parsed.bodyMd;
      tag = parsed.tag;
      degraded = !title || !bodyMd; // parse failure → fallback
    } catch {
      degraded = true; // external LLM failure/timeout → fallback
    }

    if (!title || !bodyMd) {
      const heuristic = heuristicDictation(text);
      title = heuristic.title;
      bodyMd = heuristic.bodyMd;
      tag = heuristic.tag;
      degraded = true;
    }

    await logRequest("dictate", usedModel, prompt.length);
    const correlationId = (req.headers["x-correlation-id"] as string | undefined);
    publish("pmos.ai-gateway.dictation.completed", { text, title, bodyMd, tag }, correlationId);
    return reply.send({ title, bodyMd, tag: tag ?? undefined, degraded });
  });
};
