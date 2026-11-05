import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ ai: vi.fn(), secret: vi.fn(), setting: vi.fn(), upload: vi.fn(), openai: vi.fn(), genai: vi.fn(), stt: vi.fn(), tts: vi.fn(), generate: vi.fn() }));
vi.mock("../ai/keys", () => ({ resolveTenantAi: h.ai }));
vi.mock("../store", () => ({ getTenantSecret: h.secret, getTenantSetting: h.setting }));
vi.mock("../supabase", () => ({ uploadPublic: h.upload }));
vi.mock("openai", () => ({ default: class {
  constructor(config: unknown) { h.openai(config); }
  audio = { transcriptions: { create: h.stt }, speech: { create: h.tts } };
} }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {
  constructor(config: unknown) { h.genai(config); }
  models = { generateContent: h.generate };
} }));
import { downloadRemoteMedia, synthesizeSpeech, transcribeAudio, transcribeAudioDetailed } from "../voice";
const audio = { data: Buffer.from("OggSaudio"), mimeType: "audio/ogg" };
beforeEach(() => {
  vi.resetAllMocks();
  h.ai.mockResolvedValue({ provider: "openai", apiKey: "tenant-own-key" });
  h.secret.mockResolvedValue(null); h.stt.mockResolvedValue({ text: "hello" });
  h.tts.mockImplementation(async () => new Response("mp3bytes"));
  h.upload.mockResolvedValue("https://media.example/speech.mp3");
  h.generate.mockResolvedValue({ text: "hello" });
});
afterEach(() => vi.unstubAllGlobals());

describe("tenant speech adapters", () => {
  it("uses bounded non-retrying SDK calls and propagates cancellation", async () => {
    expect(await transcribeAudio(audio, "tenant-a")).toBe("hello");
    expect(h.openai).toHaveBeenCalledWith({ apiKey: "tenant-own-key", maxRetries: 0, timeout: 30000 });
    expect(h.stt.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(h.secret).not.toHaveBeenCalled();
  });
  it("does not make Gemini transcription depend on an unrelated voice secret", async () => {
    h.ai.mockResolvedValue({ provider: "gemini", apiKey: "gemini-own-key" });
    h.secret.mockRejectedValue(new Error("secret store unavailable"));
    expect(await transcribeAudio(audio, "tenant-a")).toBe("hello");
    expect(h.secret).not.toHaveBeenCalled();
    const config = h.generate.mock.calls[0][0].config;
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
    expect(config.httpOptions.retryOptions.attempts).toBe(1);
  });
  it("refuses truncated Gemini transcripts and does not retry on another provider", async () => {
    h.ai.mockResolvedValue({ provider: "gemini", apiKey: "gemini-own-key" });
    h.generate.mockResolvedValue({ text: "partial request", candidates: [{ finishReason: "MAX_TOKENS" }] });
    expect(await transcribeAudioDetailed(audio, "tenant-a")).toMatchObject({ ok: false, code: "incomplete_transcript" });
    expect(h.stt).not.toHaveBeenCalled();
  });
  it("requires an explicitly configured tenant key; no environment-key fallback", async () => {
    h.ai.mockRejectedValue(new Error("no tenant key"));
    expect(await transcribeAudio(audio, "tenant-a")).toBeNull();
    expect(h.secret).toHaveBeenCalledWith("tenant-a", "voice_openai_key");
    expect(h.openai).not.toHaveBeenCalled();
  });
  it("stores bounded speech with unique names and preserves the full synthesis text", async () => {
    expect(await synthesizeSpeech("Complete answer", "tenant-a")).toEqual({ url: "https://media.example/speech.mp3" });
    await synthesizeSpeech("Another answer", "tenant-a");
    expect(h.tts.mock.calls[0][0].input).toBe("Complete answer");
    const first = h.upload.mock.calls[0][0] as File;
    const second = h.upload.mock.calls[1][0] as File;
    expect(first.name).not.toBe(second.name);
    expect(first.type).toBe("audio/mpeg");
    expect(await first.text()).toBe("mp3bytes");
  });
  it("falls back without calling speech or uploading when a reply is too long", async () => {
    expect(await synthesizeSpeech("x".repeat(4001), "tenant-a")).toBeNull();
    expect(h.tts).not.toHaveBeenCalled(); expect(h.upload).not.toHaveBeenCalled();
  });
});

describe("remote media safety", () => {
  it("rejects local/metadata targets before any network request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const url of ["http://127.0.0.1/x", "http://169.254.169.254/x", "file:///etc/passwd"]) expect(await downloadRemoteMedia(url)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects redirects into private networks", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadRemoteMedia("https://8.8.8.8/clip")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]).toBeDefined();
  });
  it("rejects an oversized declared length before consuming the body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-length": "999999999" } })));
    expect(await downloadRemoteMedia("https://8.8.8.8/clip")).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
  it("returns bytes and MIME for a bounded public response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("OggSaudio", { headers: { "content-type": "audio/ogg" } })));
    expect(await downloadRemoteMedia("https://8.8.8.8/clip")).toEqual(audio);
  });
});
