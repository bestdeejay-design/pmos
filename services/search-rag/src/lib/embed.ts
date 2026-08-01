// Semantic embedding helper — best-effort Ollama client.
// Returns null on ANY failure (Ollama down, model missing, timeout, non-2xx)
// so callers degrade gracefully to pure text search.

const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const EMBED_TIMEOUT_MS = 3_000;

/** Resolved at call time so tests can point OLLAMA_URL elsewhere. */
export function ollamaUrl(): string {
  return process.env.OLLAMA_URL ?? "http://localhost:11434";
}

export async function embed(text: string): Promise<number[] | null> {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${ollamaUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: trimmed }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { embedding?: unknown };
    if (!Array.isArray(body.embedding)) return null;
    return body.embedding as number[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
