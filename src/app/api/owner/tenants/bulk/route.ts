import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { updateTenant, ownerAudit, type TenantStatus, type PaymentStatus } from "@/lib/tenants";
import { db } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — apply one change to many tenants.
//
// At fleet scale the alternative is worse: an operator facing 400 accounts with
// the same problem either does nothing or clicks 400 times. But a bulk write is
// also the easiest way to damage a lot of customers at once, so the shape here is
// deliberate:
//
//   1. dryRun is the DEFAULT. You have to ask for the write.
//   2. A dry run answers "how many, and which ones" — the operator sees a sample
//      before committing.
//   3. Ids are explicit. There is no "apply to everything matching this filter",
//      because a filter that shifts between preview and apply is exactly how you
//      suspend the wrong accounts.
//   4. Every tenant gets its own audit row, so the change is reversible by
//      inspection rather than by memory.
//   5. Hard cap per call — a runaway loop can't take the whole fleet down.

const MAX_BULK = 500;

type BulkPatch = { status?: TenantStatus; plan?: string; paymentStatus?: PaymentStatus; grandfathered?: boolean };

export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { ids?: string[]; patch?: BulkPatch; dryRun?: boolean; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const ids = [...new Set((body.ids ?? []).filter(x => typeof x === "string" && x))];
  const patch = body.patch ?? {};
  if (!ids.length) return NextResponse.json({ error: "Select at least one tenant." }, { status: 400 });
  if (ids.length > MAX_BULK) return NextResponse.json({ error: `Too many at once — ${MAX_BULK} is the limit per action.` }, { status: 400 });
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  try {
    // Resolve names either way: the preview needs them, and the audit detail
    // should say who was changed, not just how many.
    const { data } = await db().from("tenants").select("id,name,company,status,plan,payment_status").in("id", ids);
    const rows = (data ?? []) as { id: string; name: string; company: string | null; status: string; plan: string; payment_status: string }[];
    const label = (r: typeof rows[number]) => r.company || r.name;

    // Anything the operator selected that no longer exists — worth surfacing
    // rather than silently applying to a smaller set than they think.
    const found = new Set(rows.map(r => r.id));
    const missing = ids.filter(i => !found.has(i));

    if (body.dryRun !== false) {
      return NextResponse.json({
        dryRun: true,
        affected: rows.length,
        missing: missing.length,
        // Enough to recognise a mistake, not so much that it's a second list view.
        sample: rows.slice(0, 10).map(r => ({ id: r.id, name: label(r), status: r.status, plan: r.plan, paymentStatus: r.payment_status })),
      });
    }

    const actor = (await currentUser())?.email ?? "owner";
    const what = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(" ");
    const reason = (body.reason ?? "").trim().slice(0, 120);

    let ok = 0;
    const failed: { id: string; name: string; error: string }[] = [];
    // Sequential on purpose: updateTenant does a read-modify-write for features,
    // and a bulk write is not worth racing.
    for (const r of rows) {
      try {
        await updateTenant(r.id, patch);
        await ownerAudit(actor, "tenant.bulk", r.id, `${what}${reason ? ` — ${reason}` : ""}`);
        ok++;
      } catch (err) {
        failed.push({ id: r.id, name: label(r), error: errorMessage(err) });
      }
    }
    // One summary row too, so the audit log shows the action as a single event
    // as well as its per-tenant effects.
    await ownerAudit(actor, "tenant.bulk.summary", null, `${what} → ${ok}/${rows.length}${reason ? ` — ${reason}` : ""}`);

    return NextResponse.json({ dryRun: false, applied: ok, failed, missing: missing.length });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
