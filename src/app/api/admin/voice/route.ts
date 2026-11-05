import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { getTenantSetting, setTenantSetting, getTenantSecret, setTenantSecret } from "@/lib/store";
import { getTenantAiStatus } from "@/lib/ai/keys";
import { VOICE_KEYS } from "@/lib/voice";

export const dynamic = "force-dynamic";

const MODES = ["off", "mirror", "always"];

// GET — this tenant's voice-reply config (never returns the raw key).
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const mode = (await getTenantSetting<string | null>(tid, VOICE_KEYS.mode, null)) ?? "off";
    const ai = await getTenantAiStatus(tid);
    const keySet = !!(await getTenantSecret(tid, VOICE_KEYS.openaiKey));
    const providerIsOpenai = ai.configured && ai.provider === "openai";
    return NextResponse.json({
      mode: MODES.includes(mode) ? mode : "off",
      keySet,
      providerIsOpenai,
      transcriptionAvailable: keySet || (ai.configured && (ai.provider === "gemini" || ai.provider === "openai")),
      speechAvailable: keySet || providerIsOpenai,
    });
  } catch {
    return NextResponse.json({ error: "Unable to load voice settings" }, { status: 500 });
  }
}

// POST — save the voice-reply mode and (optionally) a dedicated OpenAI voice key.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: unknown;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return NextResponse.json({ error: "Expected a settings object" }, { status: 400 });
  const { mode, openaiKey } = b as Record<string, unknown>;
  if (mode !== undefined && (typeof mode !== "string" || !MODES.includes(mode))) {
    return NextResponse.json({ error: "Choose off, mirror or always for voice replies" }, { status: 400 });
  }
  if (openaiKey !== undefined && (typeof openaiKey !== "string" || openaiKey.trim().length > 1024)) {
    return NextResponse.json({ error: "Voice key must be a string of at most 1024 characters" }, { status: 400 });
  }
  try {
    // A key-only update must not reset the existing reply mode. Blank means
    // keep the key; DELETE is the explicit removal operation.
    if (typeof openaiKey === "string" && openaiKey.trim()) await setTenantSecret(tid, VOICE_KEYS.openaiKey, openaiKey.trim());
    if (mode !== undefined) await setTenantSetting(tid, VOICE_KEYS.mode, mode);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to save voice settings" }, { status: 500 });
  }
}

// DELETE — clear the dedicated voice key.
export async function DELETE() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await setTenantSecret(tid, VOICE_KEYS.openaiKey, "");
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to remove voice key" }, { status: 500 });
  }
}
