import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@fastify/type-provider-typebox";
import multipart, { type Multipart } from "@fastify/multipart";
import { db } from "../db/connection.js";
import { aiRequestLog } from "../db/schema.js";
import { EventBus } from "@pmos/event-bus";
import { generate, parseDictation, selectedModel, heuristicTitle } from "../lib/llm.js";
import { transcribeAudio } from "../lib/stt.js";

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

interface DictationResult {
  title: string;
  bodyMd: string;
  tag: string | undefined;
  degraded: boolean;
}

/**
 * Shared dictation pipeline: LLM (cloud → Ollama) → parse → heuristic fallback →
 * observability log → publish pmos.ai-gateway.dictation.completed. Used by both
 * /dictate (text) and /transcribe (audio → text). NEVER throws.
 */
async function runDictation(text: string, model: string | undefined, correlationId?: string): Promise<DictationResult> {
  const usedModel = selectedModel(model);
  const prompt = buildDictationPrompt(text);

  let degraded = false;
  let title: string | null = null;
  let bodyMd: string | null = null;
  let tag: string | null = null;
  try {
    const raw = await generate(prompt, model);
    if (raw !== null) {
      const parsed = parseDictation(raw);
      title = parsed.title;
      bodyMd = parsed.bodyMd;
      tag = parsed.tag;
      degraded = !title || !bodyMd; // parse failure → fallback
    } else {
      degraded = true; // every provider failed → fallback
    }
  } catch {
    degraded = true; // unexpected failure → fallback
  }

  if (!title || !bodyMd) {
    const heuristic = heuristicDictation(text);
    title = heuristic.title;
    bodyMd = heuristic.bodyMd;
    tag = heuristic.tag;
    degraded = true;
  }

  await logRequest("dictate", usedModel, prompt.length);
  publish("pmos.ai-gateway.dictation.completed", { text, title, bodyMd, tag }, correlationId);
  return { title, bodyMd, tag: tag ?? undefined, degraded };
}

/** Multipart text-field value (single occurrence). */
function fieldString(f: Multipart | Multipart[] | undefined): string | undefined {
  const single = Array.isArray(f) ? f[0] : f;
  if (!single || single.type !== "field") return undefined;
  return typeof single.value === "string" ? single.value : undefined;
}

const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25 MB

export const ai_gatewayRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, { limits: { fileSize: MAX_AUDIO_SIZE } });
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
      const raw = await generate(prompt, model);
      if (raw !== null && raw.trim().length > 0) restored = raw.trim();
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
    const correlationId = (req.headers["x-correlation-id"] as string | undefined);
    const result = await runDictation(text, model, correlationId);
    return reply.send(result);
  });

  // ───────────── AI: audio dictation (multipart upload → STT → /dictate pipeline) ─────────────
  typed.post("/transcribe", {
    schema: {
      response: { 200: Type.Any(), 400: Type.Any(), 413: Type.Any(), 502: Type.Any() },
    },
  }, async (req, reply) => {
    let data;
    try {
      data = await req.file();
    } catch (e) {
      const status = e instanceof Error && "statusCode" in e ? (e as { statusCode?: number }).statusCode : undefined;
      if (status === 413) return fail(413, "FILE_TOO_LARGE", "audio file exceeds 25MB limit");
      return fail(400, "VALIDATION_ERROR", "multipart request with an 'audio' file part is required");
    }
    if (!data) return fail(400, "VALIDATION_ERROR", "multipart request with an 'audio' file part is required");

    const buffer = await data.toBuffer().catch(() => null);
    if (buffer === null) return fail(413, "FILE_TOO_LARGE", "audio file exceeds 25MB limit");

    const model = fieldString(data.fields.model) ?? undefined;
    const correlationId = (req.headers["x-correlation-id"] as string | undefined);

    let text: string;
    try {
      text = await transcribeAudio(buffer, model);
    } catch (e) {
      console.error("[ai-gateway] transcription failed, returning degraded response:", e);
      return fail(502, "STT_UNAVAILABLE", "speech recognition failed, please retry");
    }

    const result = await runDictation(text, model, correlationId);
    return reply.send(result);
  });
};