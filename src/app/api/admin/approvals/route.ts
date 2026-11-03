import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { aiGate } from "@/lib/ai-gate";
import { listApprovals, decideApproval, defaultMessage, getApprovalPolicy, type ApprovalStatus } from "@/lib/approvals";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?conversationId= &status=pending — the discount and refund requests the
// AI filed, for Live Chat's approval card. Each comes with the message the
// customer would get by default for either decision.
export async function GET(req: Request) {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ApprovalStatus | null;
  try {
    const r = await listApprovals(g.tid, { conversationId: url.searchParams.get("conversationId") ?? undefined, status: status ?? undefined });
    const policy = await getApprovalPolicy(g.tid);
    return NextResponse.json({
      ...r,
      maxPercent: policy.discounts.maxPercent,
      requests: r.requests.map(x => ({ ...x, approveMessage: defaultMessage(x, "approve"), rejectMessage: defaultMessage(x, "reject") })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { id, decision: "approve" | "reject" | "cancel", message? } — a person
// decides; the customer is told (except on cancel). Admins: this is money.
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({})) as { id?: unknown; decision?: unknown; message?: unknown };
  const decision = body.decision === "approve" || body.decision === "reject" || body.decision === "cancel" ? body.decision : null;
  if (typeof body.id !== "string" || !decision) return NextResponse.json({ error: "id and decision required" }, { status: 400 });
  try {
    const user = await currentUser();
    const actor = user?.name || user?.email || "Team";
    const r = await decideApproval(g.tid, body.id, decision, typeof body.message === "string" ? body.message.slice(0, 2000) : undefined, actor);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    logActivity(user, `approval.${decision}`, `${r.request?.kind} ${r.request?.percent ?? ""}`.trim());
    return NextResponse.json({ ok: true, request: r.request, warning: r.warning });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
