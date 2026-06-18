// Voice AI — speech-to-text for inbound voice notes and text-to-speech for voice
// replies, both PER TENANT (they bring their own AI key).
//
//   Transcription: Gemini understands audio natively (the default + cheapest
//   path); OpenAI tenants use Whisper. Anthropic has no audio input, so it falls
//   back to a dedicated OpenAI "voice key" if the tenant added one, else null.
//
//   Speech: OpenAI's speech API → an mp3 hosted on our public bucket, sent back
//   as a WhatsApp/Instagram audio message. Uses the tenant's OpenAI chat key when
//   their provider is OpenAI, otherwise the dedicated voice key.
//
// Everything is best-effort and NEVER throws into the message path: a failed
// transcription/synthesis just falls back to text, so voice can't break replies.

import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { resolveTenantAi } from "./ai/keys";
import { getTenantSecret, getTenantSetting } from "./store";
import { uploadPublic } from "./supabase";
import { errorMessage } from "./errors";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Tenant config keys.
export const VOICE_KEYS = {
  mode: "voice_reply_mode",       // off | mirror | always
  openaiKey: "voice_openai_key",  // optional dedicated OpenAI key for STT/TTS
} as const;

export type VoiceReplyMode = "off" | "mirror" | "always";
const TRANSCRIBE_MODEL_GEMINI = "gemini-2.5-flash";   // audio-capable + cheap
const TTS_MODEL = "tts-1";
const TTS_VOICE = "alloy";

export interface InboundAudio { data: Buffer; mimeType: string }

// Pure: should this reply be spoken? "always" = every reply; "mirror" = only when
// the customer themselves sent a voice note. Exported for unit tests.
export function shouldSpeak(mode: VoiceReplyMode, inboundWasVoice: boolean): boolean {
  return mode === "always" || (mode === "mirror" && inboundWasVoice);
}

export async function getVoiceReplyMode(tenantId: string = DEFAULT_TENANT_ID): Promise<VoiceReplyMode> {
  const v = (await getTenantSetting<string | null>(tenantId, VOICE_KEYS.mode, null)) ?? "off";
  return v === "always" || v === "mirror" ? v : "off";
}

// mime "audio/ogg; codecs=opus" → "audio/ogg"; pick a filename extension for the
// OpenAI upload (Whisper infers the format from the name).
function baseMime(m: string): string { return (m || "").split(";")[0].trim().toLowerCase(); }
function extFor(mime: string): string {
  const m = baseMime(mime);
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("amr")) return "amr";
  if (m.includes("webm")) return "webm";
  if (m.includes("aac")) return "aac";
  return "ogg";
}

// Transcribe an inbound voice note to text. Returns null when the tenant's
// provider can't do audio and no voice key is set, or on any failure.
export async function transcribeAudio(audio: InboundAudio, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  try {
    const ai = await resolveTenantAi(tenantId).catch(() => null);

    // Gemini — native audio understanding (default path).
    if (ai?.provider === "gemini") {
      const res = await new GoogleGenAI({ apiKey: ai.apiKey }).models.generateContent({
        model: TRANSCRIBE_MODEL_GEMINI,
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType: baseMime(audio.mimeType), data: audio.data.toString("base64") } },
          { text: "Transcribe this voice message verbatim. Return ONLY the transcript text, no quotes or commentary. If there is no intelligible speech, return an empty string." },
        ] }],
        config: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      });
      return ((res.text ?? "").trim()) || null;
    }

    // OpenAI — Whisper. Use the tenant's chat key, or the dedicated voice key.
    const openaiKey = ai?.provider === "openai" ? ai.apiKey : await getTenantSecret(tenantId, VOICE_KEYS.openaiKey);
    if (!openaiKey) return null;   // anthropic / no key → can't transcribe
    const file = new File([new Uint8Array(audio.data)], `voice.${extFor(audio.mimeType)}`, { type: baseMime(audio.mimeType) });
    const r = await new OpenAI({ apiKey: openaiKey }).audio.transcriptions.create({ file, model: "whisper-1" });
    return (r.text ?? "").trim() || null;
  } catch (err) {
    console.error("[voice] transcription failed:", errorMessage(err));
    return null;
  }
}

// Transcribe a remote audio file by URL (Instagram delivers a CDN URL rather
// than a media id). Fetches the bytes, then transcribes. Never throws.
export async function transcribeRemoteAudio(url: string, tenantId: string = DEFAULT_TENANT_ID): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 25 * 1024 * 1024) return null;
    return transcribeAudio({ data, mimeType: res.headers.get("content-type") || "audio/mp4" }, tenantId);
  } catch (err) {
    console.error("[voice] remote transcription failed:", errorMessage(err));
    return null;
  }
}

// Synthesize speech for a reply and host it (public mp3 URL). Returns null when
// no usable OpenAI key is configured, or on failure — caller falls back to text.
export async function synthesizeSpeech(text: string, tenantId: string = DEFAULT_TENANT_ID): Promise<{ url: string } | null> {
  const clean = (text || "").trim();
  if (!clean) return null;
  try {
    const ai = await resolveTenantAi(tenantId).catch(() => null);
    const key = ai?.provider === "openai" ? ai.apiKey : await getTenantSecret(tenantId, VOICE_KEYS.openaiKey);
    if (!key) return null;
    const speech = await new OpenAI({ apiKey: key }).audio.speech.create({
      model: TTS_MODEL, voice: TTS_VOICE, input: clean.slice(0, 4000), response_format: "mp3",
    });
    const buf = Buffer.from(await speech.arrayBuffer());
    const file = new File([new Uint8Array(buf)], `reply_${Date.now()}.mp3`, { type: "audio/mpeg" });
    return { url: await uploadPublic(file) };
  } catch (err) {
    console.error("[voice] synthesis failed:", errorMessage(err));
    return null;
  }
}

// Does this tenant have voice replies usable at all (a key to synthesize with)?
export async function voiceReplyAvailable(tenantId: string = DEFAULT_TENANT_ID): Promise<boolean> {
  const ai = await resolveTenantAi(tenantId).catch(() => null);
  if (ai?.provider === "openai") return true;
  return !!(await getTenantSecret(tenantId, VOICE_KEYS.openaiKey));
}
