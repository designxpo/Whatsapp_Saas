import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { sanitizeSearch, clampLimit } from "@/lib/ownerqueues";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the owner audit log, actually searchable.
//
// Previously the only reader was listOwnerAudit(40): the newest 40 rows globally,
// with the UI filtering them in JS. That quietly lost information — a plan-change
// request disappeared from the portal the moment 40 newer audit rows existed. It
// also meant "what did we do to this tenant?" had no answer at all.
//
// 0106 adds the (tenant_id | action | actor_email, created_at desc) indexes these
// filters need. Offset paging is fine here: an operator reads the first page or
// two of a filtered slice, never page 500 of the raw firehose.
export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const p = new URL(req.url).searchParams;
  try {
    const limit = clampLimit(p.get("limit"));
    const offset = Math.max(0, Number(p.get("offset")) || 0);

    let q = db().from("wa_owner_audit")
      .select("id,actor_email,action,tenant_id,detail,created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const tenantId = p.get("tenantId");
    const action = p.get("action");
    const actor = p.get("actor");
    if (tenantId) q = q.eq("tenant_id", tenantId);
    if (action) q = q.eq("action", action);
    if (actor) q = q.eq("actor_email", actor);

    // Free-text falls back to the detail column, which is where the human-readable
    // part of every entry lives.
    const term = sanitizeSearch(p.get("q") ?? "");
    if (term.length >= 2) q = q.ilike("detail", `%${term}%`);

    const { data, error, count } = await q;
    if (error) throw error;

    return NextResponse.json({
      entries: ((data ?? []) as Record<string, unknown>[]).map(a => ({
        id: a.id, actorEmail: a.actor_email, action: a.action,
        tenantId: a.tenant_id, detail: a.detail, at: a.created_at,
      })),
      total: count ?? 0,
      offset, limit,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
