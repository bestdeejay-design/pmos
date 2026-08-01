/**
 * Shared LLM plumbing for ai-gateway: Ollama HTTP calls, title generation and
 * heuristic fallbacks. Both the HTTP routes (/dictate, /restore-punctuation)
 * and the note-creation event handler (SAGA §1) reuse these helpers (DRY).
 */

interface OllamaGenerateResponse {
  response?: unknown;
}

/** POST /api/generate against local Ollama. Throws on any failure (network/timeout/HTTP/empty). */
export async function ollamaGenerate(prompt: string, model: string): Promise<string> {
  const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ollama generate failed: HTTP ${res.status}`);
    const data = (await res.json()) as OllamaGenerateResponse;
    if (typeof data.response !== "string" || data.response.length === 0) {
      throw new Error("ollama returned empty response");
    }
    return data.response;
  } finally {
    clearTimeout(timer);
  }
}

export function selectedModel(requested?: string): string {
  return requested ?? process.env.OLLAMA_MODEL ?? "llama3.2";
}

/**
 * Parse the Ollama dictation/title response. Robust multiline: body is everything
 * after "ТЕЛО:" up to "ЗАГОЛОВОК:", title/tag are the first line after their markers.
 */
export function parseDictation(raw: string): { title: string | null; bodyMd: string | null; tag: string | null } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const bodyMatch = text.match(/^ТЕЛ[ОА]:\s*([\s\S]*?)(?=\nЗАГОЛОВОК:)/im);
  const titleMatch = text.match(/^ЗАГОЛОВОК:\s*(.+)/im);
  const tagMatch = text.match(/^ТЕГ:\s*(.+)/im);
  return {
    bodyMd: bodyMatch?.[1]?.trim() || null,
    title: titleMatch?.[1]?.trim() || null,
    tag: tagMatch?.[1]?.trim() || null,
  };
}

/** Heuristic fallback title: first non-empty line of bodyMd truncated to 60 chars. */
export function heuristicTitle(bodyMd: string): string {
  const firstLine = bodyMd.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return firstLine.slice(0, 60) || "Без названия";
}

/** Prompt asking the LLM for a short title + one tag for a note body. */
export function buildTitlePrompt(bodyMd: string): string {
  return [
    "Ты — ассистент, который придумывает заголовок и один тег для заметки по её тексту.",
    "Ответь строго в формате:",
    "ЗАГОЛОВОК:",
    "<короткий заголовок до 60 символов>",
    "ТЕГ:",
    "<один тег>",
    "",
    "Текст заметки:",
    bodyMd,
  ].join("\n");
}

export interface TitleResult {
  title: string;
  tag: string | null;
}

/**
 * Generate a title (+ optional tag) for a note body. NEVER throws — on any LLM
 * failure (unreachable/timeout/parse) it degrades to the heuristic first line.
 */
export async function generateTitle(bodyMd: string): Promise<TitleResult> {
  const usedModel = selectedModel();
  try {
    const raw = await ollamaGenerate(buildTitlePrompt(bodyMd), usedModel);
    const parsed = parseDictation(raw);
    if (parsed.title) return { title: parsed.title, tag: parsed.tag };
    console.error("[ai-gateway] generateTitle: LLM output unparseable, using heuristic");
  } catch (e) {
    console.error("[ai-gateway] generateTitle: LLM call failed, using heuristic:", e);
  }
  return { title: heuristicTitle(bodyMd), tag: null };
}
