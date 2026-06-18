import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { getTenantSetting, setTenantSetting, getTenantSecret, setTenantSecret } from "@/lib/store";
import { getTenantAiStatus } from "@/lib/ai/keys";
import { VOICE_KEYS } from "@/lib/voice";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const MODES = ["off", "mirror", "always"];

// GET — this tenant's voice-reply config (never returns the raw key).
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const mode = (await getTenantSetting<string | null>(tid, VOICE_KEYS.mode, null)) ?? "off";
    const ai = await getTenantAiStatus(tid).catch(() => ({ provider: "gemini" as const }));
    return NextResponse.json({
      mode: MODES.includes(mode) ? mode : "off",
      keySet: !!(await getTenantSecret(tid, VOICE_KEYS.openaiKey)),
      providerIsOpenai: ai.provider === "openai",   // then no separate voice key is needed
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — save the voice-reply mode and (optionally) a dedicated OpenAI voice key.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let b: { mode?: string; openaiKey?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const mode = MODES.includes(b.mode ?? "") ? b.mode! : "off";
  try {
    await setTenantSetting(tid, VOICE_KEYS.mode, mode);
    if (b.openaiKey?.trim()) await setTenantSecret(tid, VOICE_KEYS.openaiKey, b.openaiKey.trim());
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
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
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
