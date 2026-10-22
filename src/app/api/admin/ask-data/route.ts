import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { askData } from "@/lib/askdata";
import { AiKeyMissingError } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // up to five model rounds, each with a count

// POST { question } → { answer, steps }
//
// Admins only, and always the CALLER's workspace. The counts span every number
// in it, and members are confined to their team's numbers everywhere else
// (teams.ts); a member-safe version would have to thread that scope through
// every tool.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = await currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { question?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    return NextResponse.json(await askData(body.question ?? "", tenantId));
  } catch (err) {
    const m = err instanceof Error ? err.message : "";
    const msg = err instanceof AiKeyMissingError ? "AI isn't configured for this workspace yet (add an API key in Settings)."
      : /AI_BUSY/.test(m) ? "AI is busy right now — try again in a moment."
      : m || "Could not answer that — try again.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
