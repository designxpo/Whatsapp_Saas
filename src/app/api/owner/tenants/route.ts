import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { updateTenant, deleteTenant, getTenant, ownerAudit, type TenantStatus, type PaymentStatus, type TenantFeatures } from "@/lib/tenants";
import { db } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";
import {
  isQueueKey, queueFilters, queueNeedsMetrics, searchExpr,
  decodeCursor, encodeCursor, cursorExpr, clampLimit, type Filter,
} from "@/lib/ownerqueues";

export const dynamic = "force-dynamic";

// GET — one page of the fleet.
//
// This route used to return EVERY tenant, and for each one resolve entitlements
// (which re-read the tenant and re-read the plan, uncached) — roughly 1 + 5N
// round-trips, with the response silently truncated by PostgREST's max_rows once
// the fleet outgrew it. It now returns a bounded, keyset-paginated page and
// resolves nothing per row; entitlements and usage are the drawer's job
// (/api/owner/tenants/[id]), fetched only when an operator actually opens one.
//
// Query: ?q= &queue= &status= &plan= &payment= &health= &sort= &cursor= &limit=
// The derived columns come from tenant_metrics (0106), refreshed on a rotation —
// the response carries `stale` so the UI can say "as of" rather than implying
// these are live.

const SORTS: Record<string, { col: string; asc: boolean }> = {
  newest: { col: "created_at", asc: false },
  oldest: { col: "created_at", asc: true },
  name: { col: "company", asc: true },
  mrr: { col: "amount_cents", asc: false },
  trial: { col: "trial_ends_at", asc: true },
};

// Everything the list renders. Explicit, because `select("*")` on a wide table is
// pure payload at fleet scale.
const COLS =
  "id,name,slug,status,plan,company,owner_name,owner_email,owner_phone," +
  "payment_status,trial_ends_at,current_period_end,amount_cents,currency," +
  "grandfathered,notes,created_at";

/** Walk a queue's filter descriptors onto a supabase-js query. */
function applyFilters<T extends { eq: (c: string, v: unknown) => T }>(q: T, filters: Filter[]): T {
  let out = q;
  for (const f of filters) {
    const b = out as unknown as Record<string, (...a: unknown[]) => T>;
    switch (f.op) {
      case "eq": case "neq": case "lt": case "lte": case "gt": case "gte":
        out = b[f.op](f.col, f.val); break;
      case "in": out = b.in(f.col, f.val); break;
      case "notIn": out = b.not(f.col, "in", `(${f.val.join(",")})`); break;
      case "isNull": out = b.is(f.col, null); break;
      case "or": out = f.referencedTable ? b.or(f.expr, { referencedTable: f.referencedTable }) : b.or(f.expr); break;
    }
  }
  return out;
}

export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const url = new URL(req.url);
  const p = url.searchParams;
  const now = new Date();

  try {
    const queue = p.get("queue");
    const health = p.get("health");
    // An inner join is required whenever a filter touches the embedded row —
    // otherwise PostgREST filters the embed and still returns the parent.
    const needsInner = (queue && isQueueKey(queue) && queueNeedsMetrics(queue)) || !!health;
    const embed = needsInner ? "tenant_metrics!inner(*)" : "tenant_metrics(*)";

    let q = db().from("tenants").select(`${COLS},${embed}`);

    if (queue && isQueueKey(queue)) q = applyFilters(q, queueFilters(queue, now));
    for (const [param, col] of [["status", "status"], ["plan", "plan"], ["payment", "payment_status"]] as const) {
      const v = p.get(param);
      if (v) q = q.eq(col, v);
    }
    if (health) q = q.eq("tenant_metrics.health", health);

    const search = searchExpr(p.get("q") ?? "");
    if (search) q = q.or(search);

    // Keyset beats offset here: page 500 of an offset scan makes Postgres walk
    // and discard 25,000 rows. Only the default (newest-first) ordering is
    // keyset-able, so the other sorts fall back to a bounded first page.
    const sortKey = p.get("sort") ?? "newest";
    const sort = SORTS[sortKey] ?? SORTS.newest;
    const limit = clampLimit(p.get("limit"));
    const cursor = sortKey === "newest" ? decodeCursor(p.get("cursor")) : null;
    if (cursor) q = q.or(cursorExpr(cursor));

    q = q.order(sort.col, { ascending: sort.asc, nullsFirst: false });
    if (sort.col !== "id") q = q.order("id", { ascending: false });   // stable tiebreaker
    // One extra row is the cheapest possible "is there a next page?".
    q = q.limit(limit + 1);

    const { data, error } = await q;
    if (error) throw error;

    // The select string is built at runtime, so supabase-js's literal-type parser
    // can't infer a row shape from it — `shape()` below is the real contract.
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return NextResponse.json({
      tenants: page.map(shape),
      hasMore,
      nextCursor: hasMore && last && sortKey === "newest"
        ? encodeCursor({ createdAt: last.created_at as string, id: last.id as string })
        : null,
    });
  } catch (err) {
    // A missing tenant_metrics table (0106 not applied) lands here — say so
    // plainly rather than rendering an empty fleet as if it were the truth.
    const msg = errorMessage(err);
    return NextResponse.json({
      error: /tenant_metrics|relation|column/i.test(msg)
        ? `${msg} — apply migration 0106_owner_console.sql`
        : msg,
    }, { status: 500 });
  }
}

// Flatten the embedded metrics row and drop snake_case at the boundary.
function shape(r: Record<string, unknown>) {
  const m = (Array.isArray(r.tenant_metrics) ? r.tenant_metrics[0] : r.tenant_metrics) as Record<string, unknown> | null;
  return {
    id: r.id, name: r.name, slug: r.slug, status: r.status, plan: r.plan,
    company: r.company, ownerName: r.owner_name, ownerEmail: r.owner_email, ownerPhone: r.owner_phone,
    paymentStatus: r.payment_status, trialEndsAt: r.trial_ends_at, currentPeriodEnd: r.current_period_end,
    amountCents: r.amount_cents ?? 0, currency: r.currency ?? "INR",
    grandfathered: !!r.grandfathered, notes: r.notes, createdAt: r.created_at,
    metrics: m ? {
      contacts: m.contacts ?? 0, conversations: m.conversations_30d ?? 0, messages: m.messages_30d ?? 0,
      channels: m.channels ?? 0, lastInboundAt: m.last_inbound_at ?? null,
      waQuality: m.wa_quality ?? null, waHealth: m.wa_health ?? null, marketingPaused: !!m.marketing_paused,
      aiConfigured: !!m.ai_configured, integrationsErrored: m.integrations_errored ?? 0,
      health: m.health ?? "ok", usagePctMax: m.usage_pct_max ?? 0, refreshedAt: m.refreshed_at ?? null,
    } : null,
  };
}

// PATCH — update one tenant's subscription / features / grandfathering.
export async function PATCH(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string; status?: TenantStatus; plan?: string; paymentStatus?: PaymentStatus; trialEndsAt?: string | null; amountCents?: number; currency?: string; notes?: string; features?: Partial<TenantFeatures>; grandfathered?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await updateTenant(body.id, body);
    const actor = (await currentUser())?.email ?? "owner";
    const what = body.status ? `status=${body.status}` : body.plan ? `plan=${body.plan}` : body.paymentStatus ? `payment=${body.paymentStatus}` : body.features ? "features" : "update";
    await ownerAudit(actor, "tenant.update", body.id, what);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0024 is applied` }, { status: 500 });
  }
}

// DELETE — permanently remove a tenant (requires exact name confirmation).
export async function DELETE(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string; confirmName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const t = await getTenant(body.id);
    if (!t) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    if ((body.confirmName ?? "").trim() !== (t.company || t.name)) return NextResponse.json({ error: "Type the tenant name exactly to confirm deletion" }, { status: 400 });
    await deleteTenant(body.id);
    await ownerAudit((await currentUser())?.email ?? "owner", "tenant.delete", null, t.company || t.name);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
