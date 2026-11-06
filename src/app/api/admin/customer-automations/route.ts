import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { customerAutomations, stopAutomation } from "@/lib/automations";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?conversationId= — every automation running (or recently stopped) for this
// customer, with what happens next and why. Team-scoped like Live Chat.
export async function GET(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("conversationId");
  if (!id) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  try {
    const r = await customerAutomations(ctx.v, id);
    return r ? NextResponse.json(r, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Chat not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { conversationId, key } — stop one automation for this customer.
export async function POST(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let b: { conversationId?: unknown; key?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof b.conversationId !== "string" || typeof b.key !== "string") return NextResponse.json({ error: "conversationId and key required" }, { status: 400 });
  const r = await stopAutomation(ctx.v, b.conversationId, b.key);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });
  logActivity({ email: ctx.v.user.email, name: ctx.v.user.name, tenantId: ctx.v.tenantId }, "automation.stop", `${b.key} in chat ${b.conversationId}`);
  return NextResponse.json({ ok: true });
}
