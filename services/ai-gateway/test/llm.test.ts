import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generate,
  configuredCloudProvider,
  resolveProviderChain,
  selectedModel,
} from "../src/lib/llm.js";

describe("configuredCloudProvider", () => {
  const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "LLM_PROVIDER",
    "OPENAI_MODEL", "ANTHROPIC_MODEL", "GOOGLE_MODEL", "OLLAMA_MODEL"] as const;

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("returns null when no cloud key is present (Ollama-only default)", () => {
    expect(configuredCloudProvider()).toBeNull();
  });

  it("auto-detects OpenAI when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(configuredCloudProvider()).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("uses OPENAI_MODEL when provided", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "gpt-4o";
    expect(configuredCloudProvider()).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  it("honors LLM_PROVIDER=anthropic", () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "ak-test";
    expect(configuredCloudProvider()).toEqual({ provider: "anthropic", model: "claude-3-5-haiku-latest" });
  });

  it("returns null when LLM_PROVIDER is forced but its key is absent", () => {
    process.env.LLM_PROVIDER = "openai";
    expect(configuredCloudProvider()).toBeNull();
  });
});

describe("resolveProviderChain", () => {
  const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "LLM_PROVIDER", "OLLAMA_MODEL"] as const;

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("is Ollama-only when no cloud key is set", () => {
    expect(resolveProviderChain()).toEqual([{ provider: "ollama", model: "llama3.2" }]);
  });

  it("prepends the configured cloud provider before Ollama", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const chain = resolveProviderChain();
    expect(chain.map((c) => c.provider)).toEqual(["openai", "ollama"]);
  });

  it("passes the requested model to Ollama", () => {
    expect(resolveProviderChain("my-model")).toEqual([{ provider: "ollama", model: "my-model" }]);
  });
});

describe("selectedModel", () => {
  const KEYS = ["OLLAMA_MODEL"] as const;
  beforeEach(() => { for (const k of KEYS) delete process.env[k]; });
  afterEach(() => { for (const k of KEYS) delete process.env[k]; });

  it("defaults to llama3.2", () => {
    expect(selectedModel()).toBe("llama3.2");
  });
  it("prefers the requested model", () => {
    expect(selectedModel("custom")).toBe("custom");
  });
  it("falls back to OLLAMA_MODEL env", () => {
    process.env.OLLAMA_MODEL = "llama3.1";
    expect(selectedModel()).toBe("llama3.1");
  });
});

describe("generate() fallback routing", () => {
  const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "LLM_PROVIDER", "OLLAMA_MODEL"] as const;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of KEYS) delete process.env[k];
  });

  it("routes to OpenAI when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "cloud answer" } }] }),
    });
    const out = await generate("prompt");
    expect(out).toBe("cloud answer");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/chat/completions");
  });

  it("routes to Ollama when no cloud key is set", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ response: "ollama answer" }),
    });
    const out = await generate("prompt");
    expect(out).toBe("ollama answer");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/api/generate");
  });

  it("falls back from a failing cloud provider to Ollama", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    fetchMock
      .mockRejectedValueOnce(new Error("openai network error")) // cloud fails
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: "ollama answer" }) });
    const out = await generate("prompt");
    expect(out).toBe("ollama answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null (degraded) when every provider fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const out = await generate("prompt");
    expect(out).toBeNull();
  });
});