/**
 * Speech-to-text for ai-gateway (/transcribe). Uses the OpenAI Whisper REST API
 * (`/v1/audio/transcriptions`) via node fetch — no SDK dependency. Requires
 * OPENAI_API_KEY; throws on any failure (network/timeout/HTTP/empty) so the
 * route can degrade gracefully.
 */

interface TranscriptionsResponse {
  text?: string;
}

/**
 * Transcribe an audio buffer into plain text. `model` overrides the default
 * OPENAI_STT_MODEL / "whisper-1". Throws when OPENAI_API_KEY is missing or the
 * provider call fails.
 */
export async function transcribeAudio(audio: Buffer, model?: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set — audio transcription requires a cloud STT provider");
  const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("model", model ?? process.env.OPENAI_STT_MODEL ?? "whisper-1");
    form.append("file", new Blob([audio]), "audio.webm");
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`openai transcription failed: HTTP ${res.status}`);
    const data = (await res.json()) as TranscriptionsResponse;
    if (typeof data.text !== "string" || data.text.length === 0) {
      throw new Error("openai transcription returned empty text");
    }
    return data.text;
  } finally {
    clearTimeout(timer);
  }
}