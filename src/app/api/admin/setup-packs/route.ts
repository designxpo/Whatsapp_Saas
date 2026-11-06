import { NextResponse } from "next/server";
import { aiGate } from "@/lib/ai-gate";
import { currentUser } from "@/lib/auth";
import { PACKS, packById, previewPack, applyPack, suggestedPack } from "@/lib/industry-packs";
import { getTenantSetting } from "@/lib/store";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET [?pack=id] — the packs, the one that suits this workspace, and (with
// ?pack) exactly what applying it would create or leave alone. Reads only.
export async function GET(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  try {
    const industry = await getTenantSetting<string | null>(g.tid, "vocab_industry", null).catch(() => null);
    const id = new URL(req.url).searchParams.get("pack");
    const pack = id ? packById(id) : null;
    if (id && !pack) return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
    return NextResponse.json({
      packs: PACKS.map(p => ({ id: p.id, label: p.label, summary: p.summary, notIncluded: p.notIncluded })),
      suggested: suggestedPack(industry)?.id ?? null,
      applied: await getTenantSetting(g.tid, "setup_pack", null).catch(() => null),
      plan: pack ? await previewPack(g.tid, pack) : null,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { pack } — create what the preview listed; nothing existing is changed.
export async function POST(req: Request) {
  const g = await aiGate("admin"); if (!g.ok) return g.res;
  let b: { pack?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const pack = typeof b.pack === "string" ? packById(b.pack) : undefined;
  if (!pack) return NextResponse.json({ error: "Unknown pack" }, { status: 404 });
  try {
    const user = await currentUser();
    const r = await applyPack(g.tid, pack, user?.email ?? "");
    logActivity(user ? { email: user.email, name: user.name, tenantId: g.tid } : null, "setup.pack", `${pack.id}: ${r.done.length} added, ${r.failed.length} failed`);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
