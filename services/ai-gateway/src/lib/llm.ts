/**
 * Shared LLM plumbing for ai-gateway: provider abstraction (OpenAI / Anthropic /
 * Google / Ollama), title generation and heuristic fallbacks. Both the HTTP
 * routes (/dictate, /restore-punctuation, /transcribe) and the note-creation
 * event handler (SAGA §1) reuse these helpers (DRY).
 *
 * Fallback chain (never throws for network errors — degrades gracefully):
 *   configured cloud provider (only if its API key is present) → Ollama → heuristic.
 */

export type LlmProvider = "openai" | "anthropic" | "google" | "ollama";

/** A single LLM provider: turns a prompt into a text completion. */
export interface LlmProviderClient {
  generate(prompt: string, model: string): Promise<string>;
}

interface OllamaGenerateResponse {
  response?: unknown;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
}

interface GoogleGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
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

/** POST /v1/chat/completions against OpenAI. Throws on any failure. */
async function openaiGenerate(prompt: string, model: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`openai generate failed: HTTP ${res.status}`);
    const data = (await res.json()) as OpenAiChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("openai returned empty response");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /v1/messages against Anthropic. Throws on any failure. */
async function anthropicGenerate(prompt: string, model: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const base = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`anthropic generate failed: HTTP ${res.status}`);
    const data = (await res.json()) as AnthropicMessagesResponse;
    const text = data.content?.map((b) => b.text ?? "").join("");
    if (!text || text.length === 0) throw new Error("anthropic returned empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** POST :generateContent against Google Gemini. Throws on any failure. */
async function googleGenerate(prompt: string, model: string): Promise<string> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY not set");
  const base = process.env.GOOGLE_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`google generate failed: HTTP ${res.status}`);
    const data = (await res.json()) as GoogleGenerateContentResponse;
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text || text.length === 0) throw new Error("google returned empty response");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Registry of every provider client keyed by its name. */
export const llmProviders: Record<LlmProvider, LlmProviderClient> = {
  openai: { generate: openaiGenerate },
  anthropic: { generate: anthropicGenerate },
  google: { generate: googleGenerate },
  ollama: { generate: ollamaGenerate },
};

export function selectedModel(requested?: string): string {
  return requested ?? process.env.OLLAMA_MODEL ?? "llama3.2";
}

interface CloudCandidate {
  provider: LlmProvider;
  key: string;
  modelEnv: string;
  defaultModel: string;
}

const CLOUD_CANDIDATES: CloudCandidate[] = [
  { provider: "openai", key: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", defaultModel: "gpt-4o-mini" },
  { provider: "anthropic", key: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", defaultModel: "claude-3-5-haiku-latest" },
  { provider: "google", key: "GOOGLE_API_KEY", modelEnv: "GOOGLE_MODEL", defaultModel: "gemini-1.5-flash" },
];

/**
 * The configured cloud provider, if any. Honors an explicit LLM_PROVIDER env
 * (openai|anthropic|google); otherwise auto-detects the first provider whose
 * API key is present. Returns null when no cloud provider is configured.
 */
export function configuredCloudProvider(): { provider: LlmProvider; model: string } | null {
  const forced = process.env.LLM_PROVIDER;
  if (forced) {
    const c = CLOUD_CANDIDATES.find((x) => x.provider === forced);
    if (c && process.env[c.key]) return { provider: c.provider, model: process.env[c.modelEnv] ?? c.defaultModel };
    return null; // forced provider not configured → no cloud
  }
  for (const c of CLOUD_CANDIDATES) {
    if (process.env[c.key]) return { provider: c.provider, model: process.env[c.modelEnv] ?? c.defaultModel };
  }
  return null;
}

/**
 * Ordered fallback chain: configured cloud provider (if any) → Ollama.
 * The requested model only applies to Ollama (cloud models come from env).
 */
export function resolveProviderChain(requested?: string): Array<{ provider: LlmProvider; model: string }> {
  const chain: Array<{ provider: LlmProvider; model: string }> = [];
  const cloud = configuredCloudProvider();
  if (cloud) chain.push(cloud);
  chain.push({ provider: "ollama", model: selectedModel(requested) });
  return chain;
}

/**
 * Generate a completion by walking the fallback chain (cloud → Ollama).
 * NEVER throws for network/provider errors — each provider failure is logged and
 * the next is tried. Returns null only when every provider failed, so callers
 * can degrade to a heuristic.
 */
export async function generate(prompt: string, model?: string): Promise<string | null> {
  for (const { provider, model: modelName } of resolveProviderChain(model)) {
    try {
      const out = await llmProviders[provider].generate(prompt, modelName);
      if (out !== null && out.length > 0) return out;
    } catch (e) {
      console.error(`[ai-gateway] ${provider} generate failed, trying next:`, e);
    }
  }
  return null;
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
    const raw = await generate(buildTitlePrompt(bodyMd), usedModel);
    if (raw !== null) {
      const parsed = parseDictation(raw);
      if (parsed.title) return { title: parsed.title, tag: parsed.tag };
      console.error("[ai-gateway] generateTitle: LLM output unparseable, using heuristic");
    } else {
      console.error("[ai-gateway] generateTitle: LLM call failed, using heuristic");
    }
  } catch (e) {
    console.error("[ai-gateway] generateTitle: LLM call failed, using heuristic:", e);
  }
  return { title: heuristicTitle(bodyMd), tag: null };
}