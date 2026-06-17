import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { verifyAiLive, getSetupStatus } from "@/lib/setupstatus";
import { verifyLsq } from "@/lib/leadsquared";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST { target: "ai" | "whatsapp" | "instagram" } — re-run a live check for one
// integration and return a plain-English pass/fail. "ai" does a real generation;
// whatsapp/instagram re-verify the channel against Meta via the status sweep.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { target?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  try {
    if (body.target === "ai") {
      const r = await verifyAiLive(tid);
      return NextResponse.json({ ok: r.ok, detail: r.detail });
    }
    if (body.target === "crm") {
      const r = await verifyLsq(tid);
      return NextResponse.json({ ok: r.ok, detail: r.detail });
    }
    if (body.target === "whatsapp" || body.target === "instagram") {
      const step = (await getSetupStatus(tid)).find(s => s.key === body.target);
      if (!step) return NextResponse.json({ ok: false, detail: "Nothing to verify yet." });
      return NextResponse.json({ ok: step.status === "ok", detail: step.detail });
    }
    return NextResponse.json({ error: "Unknown verify target" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, detail: errorMessage(err) }, { status: 500 });
  }
}
