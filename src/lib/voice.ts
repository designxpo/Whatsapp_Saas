// Recorded voice-note facade. Existing callers retain null/text fallback;
// detailed results and replaceable adapters prepare the foundation for calling.
import { randomUUID } from "node:crypto";
import { getTenantSetting } from "./store";
import { uploadPublic } from "./supabase";
import { safeFetch, readCappedBytes } from "./ssrf";
import { createVoiceService, baseMime, audioExtension, VOICE_LIMITS, type InboundAudio, type VoiceOptions } from "./voice/core";
import { resolveVoiceProviders, VOICE_KEYS } from "./voice/providers";

export { VOICE_KEYS };
export { VOICE_LIMITS } from "./voice/core";
export type { InboundAudio, VoiceOptions, VoiceResult, SpeechTranscriber, SpeechSynthesizer } from "./voice/core";
export type VoiceReplyMode = "off" | "mirror" | "always";

const service = createVoiceService({
  resolveProviders: resolveVoiceProviders,
  async storeSpeech(audio, { signal }) {
    signal.throwIfAborted();
    const file = new File([new Uint8Array(audio.data)], `reply_${randomUUID()}.${audioExtension(audio.mimeType)}`, { type: audio.mimeType });
    return { url: await uploadPublic(file) };
  },
  report(event) { console.info(JSON.stringify({ tag: "voice_operation", ...event })); },
});

export function shouldSpeak(mode: VoiceReplyMode, inboundWasVoice: boolean): boolean {
  return mode === "always" || (mode === "mirror" && inboundWasVoice);
}

export async function getVoiceReplyMode(tenantId: string): Promise<VoiceReplyMode> {
  if (!tenantId?.trim()) return "off";
  const value = await getTenantSetting<string | null>(tenantId, VOICE_KEYS.mode, null);
  return value === "always" || value === "mirror" ? value : "off";
}

export function visionInlineMime(mime?: string | null): string | null {
  const m = baseMime(mime || "");
  if (m === "image/jpg") return "image/jpeg";
  return m.startsWith("image/") || m.startsWith("video/") || m === "application/pdf" ? m : null;
}

export const transcribeAudioDetailed = service.transcribe;
export const synthesizeSpeechDetailed = service.synthesize;

export async function transcribeAudio(audio: InboundAudio, tenantId: string, options: VoiceOptions = {}): Promise<string | null> {
  const result = await transcribeAudioDetailed(audio, tenantId, options);
  return result.ok ? result.value : null;
}

// Shared Instagram/Messenger download path for audio, images and video.
// Redirects and DNS are validated, and bytes are bounded as they arrive.
export async function downloadRemoteMedia(url: string, options: Pick<VoiceOptions, "signal"> = {}): Promise<InboundAudio | null> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(VOICE_LIMITS.downloadTimeoutMs)])
    : AbortSignal.timeout(VOICE_LIMITS.downloadTimeoutMs);
  try {
    const response = await safeFetch(url, { signal });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); return null; }
    const data = await readCappedBytes(response, VOICE_LIMITS.remoteMediaBytes, signal);
    return data.length ? { data, mimeType: response.headers.get("content-type") || "application/octet-stream" } : null;
  } catch {
    console.warn(JSON.stringify({ tag: "voice_media_download_failed", code: signal.aborted ? "cancelled_or_timeout" : "download_error" }));
    return null;
  }
}

export async function transcribeRemoteAudio(url: string, tenantId: string, options: VoiceOptions = {}): Promise<string | null> {
  if (!tenantId?.trim()) return null;
  const audio = await downloadRemoteMedia(url, options);
  return audio ? transcribeAudio(audio, tenantId, options) : null;
}

export async function synthesizeSpeech(text: string, tenantId: string, options: VoiceOptions = {}): Promise<{ url: string } | null> {
  const result = await synthesizeSpeechDetailed(text, tenantId, options);
  return result.ok ? result.value : null;
}

export async function voiceReplyAvailable(tenantId: string): Promise<boolean> {
  if (!tenantId?.trim()) return false;
  try { return !!(await resolveVoiceProviders(tenantId, "synthesize")).synthesizer; }
  catch { return false; }
}
