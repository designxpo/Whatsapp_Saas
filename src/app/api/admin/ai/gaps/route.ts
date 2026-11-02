import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { aiGate } from "@/lib/ai-gate";
import { listGaps, answerGap, dismissGap } from "@/lib/ai-gaps";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?days=7|30|90 — questions the AI couldn't answer, grouped, most-asked first.
export async function GET(req: Request) {
  const g = await aiGate("member"); if (!g.ok) return g.res;
  if (!(await currentUser())) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const tid = g.tid;
    return NextResponse.json(await listGaps(tid, Number(new URL(req.url).searchParams.get("days")) || 30));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { key, answer, tag? } — add the answer to the knowledge base and resolve
// the question; { key, dismiss: true } — hide it. Admins.
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({})) as { key?: unknown; answer?: unknown; tag?: unknown; dismiss?: unknown };
  if (typeof body.key !== "string" || !body.key) return NextResponse.json({ error: "key required" }, { status: 400 });
  try {
    const tid = g.tid;
    const user = await currentUser();
    if (body.dismiss) {
      await dismissGap(tid, body.key, user?.email ?? "admin");
      return NextResponse.json({ ok: true });
    }
    const r = await answerGap(tid, body.key, String(body.answer ?? "").slice(0, 4000), user?.email ?? "admin", typeof body.tag === "string" ? body.tag : null);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    logActivity(user, "kb.gap_answered", body.key.slice(0, 80));
    return NextResponse.json({ ok: true, docId: r.docId });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
