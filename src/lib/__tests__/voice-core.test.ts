import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceService, normaliseAudio, VOICE_LIMITS, type VoiceDependencies, type VoiceContext } from "../voice/core";

const input = { data: Buffer.from("audio"), mimeType: "audio/ogg; codecs=opus" };
function harness() {
  const transcribe = vi.fn(async () => "  hello  ");
  const synthesize = vi.fn(async () => ({ data: Buffer.from("speech"), mimeType: "audio/mpeg" }));
  const deps = {
    resolveProviders: vi.fn(async () => ({ transcriber: { id: "local-stt", transcribe }, synthesizer: { id: "local-tts", synthesize } })),
    storeSpeech: vi.fn(async () => ({ url: "https://media.example/reply.mp3" })),
    report: vi.fn(),
  };
  return { service: createVoiceService(deps), deps, transcribe, synthesize };
}
afterEach(() => vi.useRealTimers());

describe("recorded speech foundation", () => {
  it("runs an injected local adapter, retaining tenant context and normalising MIME", async () => {
    const h = harness();
    expect(await h.service.transcribe(input, "tenant-a")).toMatchObject({ ok: true, value: "hello", provider: "local-stt" });
    expect(h.deps.resolveProviders).toHaveBeenCalledWith("tenant-a", "transcribe");
    expect(h.transcribe).toHaveBeenCalledWith({ ...input, mimeType: "audio/ogg" }, expect.objectContaining({ tenantId: "tenant-a", signal: expect.any(AbortSignal) }));
  });

  it("never falls back to a default workspace or reaches a provider for invalid audio", async () => {
    const h = harness();
    expect(await h.service.transcribe(input, "")).toMatchObject({ ok: false, code: "invalid_input" });
    for (const [audio, code] of [
      [{ ...input, data: Buffer.alloc(0) }, "empty_audio"],
      [{ ...input, mimeType: "text/html" }, "unsupported_format"],
      [{ ...input, mimeType: "__proto__" }, "unsupported_format"],
      [{ ...input, mimeType: "application/octet-stream" }, "unsupported_format"],
      [{ ...input, data: Buffer.alloc(VOICE_LIMITS.audioBytes + 1) }, "too_large"],
    ] as const) expect(await h.service.transcribe(audio, "tenant-a")).toMatchObject({ ok: false, code });
    expect(h.deps.resolveProviders).not.toHaveBeenCalled();
  });

  it("recognises generic CDN Ogg data without allowing HTML to masquerade as audio", () => {
    expect(normaliseAudio({ data: Buffer.from("OggSbytes"), mimeType: "application/octet-stream" })?.mimeType).toBe("audio/ogg");
    expect(normaliseAudio({ data: Buffer.from("<html>"), mimeType: "application/octet-stream" })).toBeNull();
  });

  it("fails safely for no provider, empty speech and exceptions, without exposing error contents", async () => {
    const h = harness();
    h.transcribe.mockRejectedValueOnce(new Error("secret key sk-private; caller medical transcript"));
    expect(await h.service.transcribe(input, "tenant-a")).toMatchObject({ ok: false, code: "provider_error" });
    expect(JSON.stringify(h.deps.report.mock.calls)).not.toMatch(/sk-private|medical transcript|hello/);
    h.transcribe.mockResolvedValueOnce("   ");
    expect(await h.service.transcribe(input, "tenant-a")).toMatchObject({ ok: false, code: "empty_transcript" });
    const service = createVoiceService({ ...h.deps, resolveProviders: async () => ({}) });
    expect(await service.transcribe(input, "tenant-a")).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("refuses long replies rather than speaking only part of an answer", async () => {
    const h = harness();
    expect(await h.service.synthesize("x".repeat(4001), "tenant-a")).toMatchObject({ ok: false, code: "too_large" });
    expect(h.synthesize).not.toHaveBeenCalled();
    expect(h.deps.storeSpeech).not.toHaveBeenCalled();
  });

  it("distinguishes provider authentication, quota and timeout failures without exposing SDK bodies", async () => {
    const h = harness();
    for (const [status, code] of [[401, "credentials_rejected"], [429, "rate_limited"], [504, "timeout"]] as const) {
      h.transcribe.mockRejectedValueOnce(Object.assign(new Error("private provider details"), { status }));
      const result = await h.service.transcribe(input, "tenant-a");
      expect(result).toMatchObject({ ok: false, code });
      expect(JSON.stringify(result)).not.toContain("private provider details");
    }
  });

  it("bounds output and handles storage failures without claiming success", async () => {
    const h = harness();
    h.synthesize.mockResolvedValueOnce({ data: Buffer.alloc(0), mimeType: "audio/mpeg" });
    expect(await h.service.synthesize("hello", "tenant-a")).toMatchObject({ ok: false, code: "empty_audio" });
    h.synthesize.mockResolvedValueOnce({ data: Buffer.alloc(VOICE_LIMITS.audioBytes + 1), mimeType: "audio/mpeg" });
    expect(await h.service.synthesize("hello", "tenant-a")).toMatchObject({ ok: false, code: "too_large" });
    expect(h.deps.storeSpeech).not.toHaveBeenCalled();
    h.deps.storeSpeech.mockRejectedValueOnce(new Error("private storage details"));
    expect(await h.service.synthesize("hello", "tenant-a")).toMatchObject({ ok: false, code: "storage_error" });
  });

  it("keeps simultaneous tenants separate without global provider state", async () => {
    const received: string[] = [];
    const deps: VoiceDependencies = {
      resolveProviders: async tenantId => ({ transcriber: { id: tenantId, async transcribe(_audio, context) {
        await Promise.resolve(); received.push(context.tenantId); return tenantId;
      } } }),
      storeSpeech: async () => ({ url: "unused" }),
    };
    const service = createVoiceService(deps);
    const results = await Promise.all([service.transcribe(input, "a"), service.transcribe(input, "b")]);
    expect(results.map(r => r.ok && r.value)).toEqual(["a", "b"]);
    expect(received).toEqual(["a", "b"]);
  });

  it("honours cancellation before any key lookup", async () => {
    const h = harness();
    expect(await h.service.transcribe(input, "tenant-a", { signal: AbortSignal.abort() })).toMatchObject({ ok: false, code: "cancelled" });
    expect(h.deps.resolveProviders).not.toHaveBeenCalled();
  });

  it("times out a stuck adapter and forwards cancellation", async () => {
    vi.useFakeTimers();
    const h = harness();
    let context: VoiceContext | undefined;
    h.transcribe.mockImplementation((_audio?: unknown, ctx?: unknown) => {
      context = ctx as VoiceContext;
      return new Promise(() => {});
    });
    const result = h.service.transcribe(input, "tenant-a", { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ ok: false, code: "timeout" });
    expect(context?.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not store late audio after the caller cancels", async () => {
    const h = harness();
    let resolve!: (audio: typeof input) => void;
    h.synthesize.mockImplementation(() => new Promise(r => { resolve = r; }));
    const controller = new AbortController();
    const pending = h.service.synthesize("hello", "tenant-a", { signal: controller.signal });
    await vi.waitFor(() => expect(resolve).toBeDefined());
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: "cancelled" });
    resolve(input);
    await Promise.resolve(); await Promise.resolve();
    expect(h.deps.storeSpeech).not.toHaveBeenCalled();
  });
});
