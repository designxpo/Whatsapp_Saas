// SDK- and transport-independent recorded-speech contracts. Live sessions will
// need a separate streaming contract, but can reuse providers and cancellation.
export const VOICE_LIMITS = {
  audioBytes: 16 * 1024 * 1024, speechCharacters: 4000, timeoutMs: 30_000,
  downloadTimeoutMs: 15_000, remoteMediaBytes: 25 * 1024 * 1024,
} as const;
export interface InboundAudio { data: Buffer; mimeType: string }
export interface VoiceOptions { signal?: AbortSignal; timeoutMs?: number }
export interface VoiceContext { tenantId: string; signal: AbortSignal }
export type VoiceErrorCode = "invalid_input" | "unsupported_format" | "too_large" | "unavailable" | "empty_audio" | "empty_transcript" | "incomplete_transcript" | "cancelled" | "timeout" | "rate_limited" | "credentials_rejected" | "provider_error" | "storage_error";
export type VoiceResult<T> =
  | { ok: true; value: T; provider: string; elapsedMs: number }
  | { ok: false; code: VoiceErrorCode; provider?: string; elapsedMs: number };
export interface SpeechTranscriber { id: string; transcribe(audio: InboundAudio, context: VoiceContext): Promise<string> }
export interface SpeechSynthesizer { id: string; synthesize(text: string, context: VoiceContext): Promise<InboundAudio> }
export interface VoiceProviders { transcriber?: SpeechTranscriber; synthesizer?: SpeechSynthesizer }
export interface VoiceDependencies {
  resolveProviders(tenantId: string, stage: "transcribe" | "synthesize"): Promise<VoiceProviders>;
  storeSpeech(audio: InboundAudio, context: VoiceContext): Promise<{ url: string }>;
  report?(event: { stage: "transcribe" | "synthesize"; tenantId: string; ok: boolean; code?: VoiceErrorCode; provider?: string; elapsedMs: number }): void;
}
export class VoiceFailure extends Error {
  constructor(readonly code: VoiceErrorCode) { super(code); }
}
function failureCode(error: unknown): VoiceErrorCode {
  if (error instanceof VoiceFailure) return error.code;
  if (error && typeof error === "object") {
    const { status, name } = error as { status?: unknown; name?: unknown };
    if (status === 429) return "rate_limited";
    if (status === 401 || status === 403) return "credentials_rejected";
    if (status === 408 || status === 504 || name === "TimeoutError" || name === "APIConnectionTimeoutError") return "timeout";
  }
  return "provider_error";
}
export function baseMime(mime: string): string { return mime.split(";")[0].trim().toLowerCase(); }
const AUDIO_TYPES: Record<string, string> = {
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
  "audio/amr": "amr", "audio/webm": "webm", "audio/aac": "aac",
  "audio/flac": "flac", "audio/x-flac": "flac", "audio/aiff": "aiff", "audio/x-aiff": "aiff",
};
export function audioExtension(mime: string): string | undefined {
  const key = baseMime(mime);
  return Object.hasOwn(AUDIO_TYPES, key) ? AUDIO_TYPES[key] : undefined;
}
// Identify common containers only when a CDN omits the type. Never silently
// label arbitrary bytes as Ogg or pass a document to a transcription provider.
export function normaliseAudio(audio: InboundAudio): InboundAudio | null {
  let mime = baseMime(audio.mimeType);
  if (!mime || mime === "application/octet-stream") {
    const bytes = audio.data;
    if (bytes.subarray(0, 4).toString() === "OggS") mime = "audio/ogg";
    else if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE") mime = "audio/wav";
    else if (bytes.subarray(0, 4).toString() === "fLaC") mime = "audio/flac";
    else if (bytes.subarray(0, 3).toString() === "ID3") mime = "audio/mpeg";
    else if (bytes.subarray(4, 8).toString() === "ftyp" && bytes.subarray(8, 12).toString().startsWith("M4A")) mime = "audio/mp4";
  }
  return audioExtension(mime) ? { ...audio, mimeType: mime } : null;
}
async function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}
export function createVoiceService(deps: VoiceDependencies) {
  async function run<T>(stage: "transcribe" | "synthesize", tenantId: string, options: VoiceOptions,
    work: (context: VoiceContext, selected: (id: string) => void) => Promise<T>): Promise<VoiceResult<T>> {
    const started = Date.now();
    let provider: string | undefined;
    const deadline = new AbortController();
    const requested = options.timeoutMs ?? VOICE_LIMITS.timeoutMs;
    const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, VOICE_LIMITS.timeoutMs) : VOICE_LIMITS.timeoutMs;
    const timer = setTimeout(() => deadline.abort(new DOMException("Voice deadline exceeded", "TimeoutError")), timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
    let result: VoiceResult<T>;
    try {
      if (typeof tenantId !== "string" || !tenantId.trim()) throw new VoiceFailure("invalid_input");
      const value = await abortable(() => work({ tenantId, signal }, id => { provider = id; }), signal);
      result = { ok: true, value, provider: provider!, elapsedMs: Date.now() - started };
    } catch (error) {
      const code = options.signal?.aborted ? "cancelled" : deadline.signal.aborted ? "timeout"
        : failureCode(error);
      result = { ok: false, code, provider, elapsedMs: Date.now() - started };
    } finally { clearTimeout(timer); }
    // No audio, transcript, key, URL or raw SDK error in logs/results.
    try { deps.report?.({ stage, tenantId, ok: result.ok, code: result.ok ? undefined : result.code, provider, elapsedMs: result.elapsedMs }); } catch { /* diagnostics cannot break replies */ }
    return result;
  }
  return {
    transcribe(audio: InboundAudio, tenantId: string, options: VoiceOptions = {}): Promise<VoiceResult<string>> {
      return run("transcribe", tenantId, options, async (context, selected) => {
        if (!audio || !Buffer.isBuffer(audio.data) || typeof audio.mimeType !== "string") throw new VoiceFailure("invalid_input");
        if (!audio.data.length) throw new VoiceFailure("empty_audio");
        if (audio.data.length > VOICE_LIMITS.audioBytes) throw new VoiceFailure("too_large");
        const input = normaliseAudio(audio);
        if (!input) throw new VoiceFailure("unsupported_format");
        const { transcriber } = await deps.resolveProviders(tenantId, "transcribe");
        context.signal.throwIfAborted();
        if (!transcriber) throw new VoiceFailure("unavailable");
        selected(transcriber.id);
        const text = (await transcriber.transcribe(input, context)).trim();
        if (!text) throw new VoiceFailure("empty_transcript");
        return text;
      });
    },
    synthesize(text: string, tenantId: string, options: VoiceOptions = {}): Promise<VoiceResult<{ url: string }>> {
      return run("synthesize", tenantId, options, async (context, selected) => {
        if (typeof text !== "string" || !text.trim()) throw new VoiceFailure("invalid_input");
        const clean = text.trim();
        if (clean.length > VOICE_LIMITS.speechCharacters) throw new VoiceFailure("too_large");
        const { synthesizer } = await deps.resolveProviders(tenantId, "synthesize");
        context.signal.throwIfAborted();
        if (!synthesizer) throw new VoiceFailure("unavailable");
        selected(synthesizer.id);
        const audio = await synthesizer.synthesize(clean, context);
        context.signal.throwIfAborted();
        if (!audio || !Buffer.isBuffer(audio.data) || !audio.data.length) throw new VoiceFailure("empty_audio");
        if (audio.data.length > VOICE_LIMITS.audioBytes) throw new VoiceFailure("too_large");
        const output = typeof audio.mimeType === "string" ? normaliseAudio(audio) : null;
        if (!output) throw new VoiceFailure("unsupported_format");
        try { return await deps.storeSpeech(output, context); }
        catch { throw new VoiceFailure("storage_error"); }
      });
    },
  };
}
