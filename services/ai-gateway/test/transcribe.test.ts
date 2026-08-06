import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

vi.mock("../src/db/connection.js", () => ({
  db: { execute: vi.fn().mockResolvedValue(undefined), insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })) },
}));

vi.mock("@pmos/event-bus", () => ({
  EventBus: {
    init: vi.fn(),
    get: vi.fn(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      ensureStream: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn(() => true),
      publish: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("../src/lib/llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/llm.js")>();
  return {
    ...actual,
    generate: vi.fn().mockResolvedValue("ТЕЛО: Тело заметки\nЗАГОЛОВОК: Заголовок\nТЕГ: тег"),
  };
});

vi.mock("../src/lib/stt.js", () => ({
  transcribeAudio: vi.fn().mockResolvedValue("привет мир"),
}));

import { transcribeAudio } from "../src/lib/stt.js";

const BOUNDARY = "----pmosTestBoundary";

function multipartBody(filename: string, bytes: string): Buffer {
  return Buffer.from(
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n` +
    `Content-Type: audio/webm\r\n\r\n` +
    `${bytes}\r\n` +
    `--${BOUNDARY}--\r\n`,
    "utf8",
  );
}

describe("POST /transcribe (audio dictation)", () => {
  const base = "/api/ai-gateway/v1";

  it("accepts a multipart audio upload and returns a structured note", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `${base}/transcribe`,
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        payload: multipartBody("audio.webm", "fake-audio-bytes"),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { title: string; bodyMd: string; tag?: string; degraded: boolean };
      expect(body.title).toBe("Заголовок");
      expect(body.bodyMd).toBe("Тело заметки");
      expect(body.tag).toBe("тег");
      expect(body.degraded).toBe(false);
      expect(transcribeAudio).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns 400 when the multipart file part is missing", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `${base}/transcribe`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns 400 when the request is not multipart at all", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: `${base}/transcribe`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ text: "hello" }),
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});