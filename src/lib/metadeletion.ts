// Meta data-deletion requests. When Meta POSTs a data-deletion callback (a user
// removed the app / asked for deletion), we record the request, carry it out,
// and the public status page confirms it by code.
//
// Stored in `meta_deletion_requests` (migration 0061; `detail` from
// 20261101210000). Fully resilient: if that table isn't applied yet, we fall
// back to the owner audit log so the callback still works and the request is
// never lost.
//
// ── What the callback's user_id can be matched to ──────────────────────────
// Meta sends an APP-scoped id of the person who removed the app. The people we
// hold data about are mostly a business's customers, and Meta identifies those
// to us by PAGE-scoped ids (PSID on Messenger) and Instagram-scoped ids (IGSID)
// — different numbers for the same human, and Meta offers no way to translate
// one into the other. So the id only finds data where it is stored verbatim:
//   • an Instagram/Messenger conversation whose id is exactly this id,
//   • an Instagram follow-gate record for exactly this id.
// Each match is erased with the same erasure as a manual request (gdpr.ts),
// workspace by workspace. A connected Instagram account stored under this id
// (the account owner removed the app) is NOT changed automatically — that is a
// business's channel, not a customer's data — it is written to the owner audit
// log instead. A request that matches nothing is still completed: we hold
// nothing under that id.

import { randomUUID } from "crypto";
import { db } from "./supabase";
import { ownerAudit } from "./tenants";
import { eraseContact } from "./gdpr";

export interface DeletionStatus {
  code: string;
  status: string;            // received | processing | completed
  createdAt: string | null;
  completedAt: string | null;
}

function newCode(): string {
  return "del_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

// Record a deletion request and return its confirmation code.
export async function recordDeletionRequest(metaUserId: string): Promise<string> {
  const code = newCode();
  try {
    const { error } = await db().from("meta_deletion_requests")
      .insert({ confirmation_code: code, meta_user_id: metaUserId, status: "received" });
    if (error) throw error;
  } catch {
    // Table not present yet (0061) or insert failed — keep a durable trail.
    await ownerAudit("meta", "data_deletion.request", null, `meta_user=${metaUserId} code=${code}`).catch(() => {});
  }
  return code;
}

// Look up a request by its confirmation code (for the public status page).
export async function getDeletionStatus(code: string): Promise<DeletionStatus | null> {
  if (!code) return null;
  try {
    const { data } = await db().from("meta_deletion_requests")
      .select("confirmation_code, status, created_at, completed_at")
      .eq("confirmation_code", code).maybeSingle();
    if (!data) return null;
    return {
      code: data.confirmation_code as string,
      status: (data.status as string) ?? "received",
      createdAt: (data.created_at as string) ?? null,
      completedAt: (data.completed_at as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

// One request touches at most this many workspaces per run; the rest is
// picked up by the next run (drainDeletionRequests), so a callback can't turn
// into an unbounded job.
export const MAX_WORKSPACES_PER_RUN = 25;

export interface DeletionOutcome {
  status: "completed" | "processing" | "skipped";
  workspaces: number;        // workspaces where the person was found and erased
  rowsDeleted: number;
  channelsMatched: number;   // connected accounts stored under this id (audited, not changed)
  errors: string[];
}

// Carry out one request. Safe to run again and again: erasure of something
// already erased deletes nothing, and a completed request is left alone.
export async function processDeletionRequest(code: string, metaUserId: string): Promise<DeletionOutcome> {
  const out: DeletionOutcome = { status: "processing", workspaces: 0, rowsDeleted: 0, channelsMatched: 0, errors: [] };
  const id = String(metaUserId ?? "").trim();

  const { data: req } = await db().from("meta_deletion_requests").select("status").eq("confirmation_code", code).maybeSingle();
  if ((req as { status?: string } | null)?.status === "completed") return { ...out, status: "skipped" };
  await db().from("meta_deletion_requests").update({ status: "processing" }).eq("confirmation_code", code).then(() => {}, () => {});

  if (id && id !== "unknown") {
    // Every workspace where this id is stored as an end customer's id.
    const tenants = new Set<string>();
    const add = (rows: unknown) => { for (const r of (rows ?? []) as { tenant_id?: string }[]) if (r.tenant_id) tenants.add(r.tenant_id); };
    const conv = await db().from("wa_conversations").select("tenant_id").eq("phone", id).in("platform", ["instagram", "messenger"]).limit(500);
    if (conv.error) out.errors.push(`wa_conversations: ${conv.error.message}`); else add(conv.data);
    const gates = await db().from("wa_ig_follow_gates").select("tenant_id").eq("igsid", id).limit(500);
    if (!gates.error) add(gates.data);   // table may not exist; nothing to find then

    const batch = [...tenants].slice(0, MAX_WORKSPACES_PER_RUN);
    for (const tid of batch) {
      try {
        const r = await eraseContact(tid, id, { exactId: true });
        out.workspaces++;
        out.rowsDeleted += Object.values(r.deleted).reduce((a, b) => a + b, 0);
        out.errors.push(...r.errors.map(e => `${tid}: ${e}`));
      } catch (e) { out.errors.push(`${tid}: ${e instanceof Error ? e.message : e}`); }
    }
    const more = tenants.size > batch.length;

    // The account owner removed the app: say so to the platform owner, change nothing.
    const ch = await db().from("wa_channels").select("id, tenant_id").eq("ig_user_id", id).limit(50);
    if (!ch.error && ch.data?.length) {
      out.channelsMatched = ch.data.length;
      for (const c of ch.data as { id: string; tenant_id: string }[]) {
        await ownerAudit("meta", "data_deletion.channel_owner", c.tenant_id ?? null,
          `code=${code}: the owner of connected Instagram account (channel ${c.id}) removed the app — its token no longer works; reconnect or remove the channel`).catch(() => {});
      }
    }
    if (more) { out.errors.push(`${tenants.size - batch.length} more workspaces left for the next run`); }
  }

  out.status = out.errors.length ? "processing" : "completed";
  const detail = `workspaces=${out.workspaces} rows=${out.rowsDeleted} channels=${out.channelsMatched}${out.errors.length ? ` errors=${out.errors.length}` : ""}`;
  const patch: Record<string, unknown> = out.status === "completed"
    ? { status: "completed", completed_at: new Date().toISOString(), detail }
    : { status: "processing", detail };
  let { error } = await db().from("meta_deletion_requests").update(patch).eq("confirmation_code", code);
  // Before 20261101210000 there is no detail column — record the status anyway.
  if (error && (error.code === "42703" || error.code === "PGRST204")) {
    const { detail: _d, ...bare } = patch;
    ({ error } = await db().from("meta_deletion_requests").update(bare).eq("confirmation_code", code));
  }
  if (error) await ownerAudit("meta", "data_deletion.result", null, `code=${code} ${out.status} ${detail}`).catch(() => {});
  if (out.errors.length) console.error("[meta-deletion]", code, out.errors.slice(0, 5));
  return out;
}

// Requests that weren't finished — the callback's own run failed, timed out or
// left workspaces over — retried a few per engine tick.
export async function drainDeletionRequests(max = 3): Promise<{ processed: number; completed: number }> {
  const res = { processed: 0, completed: 0 };
  const settled = new Date(Date.now() - 10 * 60_000).toISOString();   // leave the callback's own run 10 minutes
  // One that still fails after 30 days needs a person, not another retry —
  // it stays "processing" with its errors in `detail` (and the server log).
  const giveUp = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await db().from("meta_deletion_requests")
    .select("confirmation_code, meta_user_id")
    .in("status", ["received", "processing"]).lt("created_at", settled).gt("created_at", giveUp)
    .order("created_at", { ascending: true }).limit(max);
  if (error) return res;   // table not applied yet
  for (const r of (data ?? []) as { confirmation_code: string; meta_user_id: string }[]) {
    const o = await processDeletionRequest(r.confirmation_code, r.meta_user_id).catch(() => null);
    res.processed++;
    if (o?.status === "completed") res.completed++;
  }
  return res;
}
