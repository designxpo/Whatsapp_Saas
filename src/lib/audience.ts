// Broadcast audiences (batches), tenant-scoped.
//
// Batches exist because the send composer could not target a chosen group: it
// offered all / tag / attribute / pasted-list, and the only tags in practice are
// auto-stamped provenance labels, so "send to these people" was impossible.
//
// Consent is NOT redefined here. This schema already carries
// contacts.opted_in / opt_in_source / opt_in_at / opt_in_proof plus
// markOptedIn(), and every broadcast path resolves its audience with
// onlyOptedIn = true — so unconsented contacts are never even queued. Batches
// read that existing state to report a shortfall; they do not gate sends
// themselves. See migration 0112.
//
// Uses db() directly and re-declares its phone helpers rather than importing
// store.ts: store.ts delegates batch resolution here, and importing back would
// be a cycle.

import { db } from "./supabase";
import { DEFAULT_TENANT_ID } from "./tenant";

const digits = (p: string) => (p || "").replace(/\D/g, "");
const last10 = (p: string) => digits(p).slice(-10);

// Matches recipientsForAudience: a bigger audience is capped, and the cap is
// reported rather than silently under-sending.
const AUDIENCE_LIMIT = 50_000;

export type BatchKind = "static" | "dynamic";

// AND-combined optional criteria. Empty object on a dynamic batch means "every
// active contact", which is allowed but shown as such in the UI.
export interface BatchFilter {
  tag?: string;
  attributeKey?: string;
  attributeValue?: string;
  source?: string;
  stageId?: string;
}

export interface Batch {
  id: string;
  name: string;
  description: string | null;
  kind: BatchKind;
  filter: BatchFilter;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Recipient { phone: string; fullName: string }

function rowToBatch(r: Record<string, unknown>): Batch {
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    description: (r.description as string) ?? null,
    kind: ((r.kind as string) === "dynamic" ? "dynamic" : "static"),
    filter: (r.filter as BatchFilter) ?? {},
    createdBy: (r.created_by as string) ?? null,
    archivedAt: (r.archived_at as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

// ── Batch CRUD ───────────────────────────────────────────────────────────────

export async function listBatches(tenantId = DEFAULT_TENANT_ID, includeArchived = false): Promise<Batch[]> {
  let q = db().from("wa_batches").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToBatch);
}

export async function getBatch(id: string, tenantId = DEFAULT_TENANT_ID): Promise<Batch | null> {
  const { data, error } = await db().from("wa_batches").select("*")
    .eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToBatch(data) : null;
}

export async function createBatch(p: {
  name: string; description?: string | null; kind?: BatchKind;
  filter?: BatchFilter; createdBy?: string | null; tenantId?: string;
}): Promise<Batch> {
  const name = p.name.trim();
  if (!name) throw new Error("Batch name is required");
  const kind: BatchKind = p.kind === "dynamic" ? "dynamic" : "static";
  const { data, error } = await db().from("wa_batches").insert({
    tenant_id: p.tenantId ?? DEFAULT_TENANT_ID,
    name, description: p.description?.trim() || null, kind,
    filter: kind === "dynamic" ? (p.filter ?? {}) : {},
    created_by: p.createdBy ?? null,
  }).select("*").single();
  // The unique index is on lower(name) for live batches only — turn the raw
  // constraint error into something a person can act on.
  if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? `A batch named "${name}" already exists` : error.message);
  return rowToBatch(data);
}

export async function updateBatch(id: string, patch: {
  name?: string; description?: string | null; filter?: BatchFilter;
}, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error("Batch name is required");
    row.name = n;
  }
  if (patch.description !== undefined) row.description = patch.description?.trim() || null;
  if (patch.filter !== undefined) row.filter = patch.filter;
  const { error } = await db().from("wa_batches").update(row).eq("tenant_id", tenantId).eq("id", id);
  if (error) throw new Error(/duplicate key|unique/i.test(error.message) ? "Another batch already uses that name" : error.message);
}

// Archive rather than delete: a past broadcast should still be able to show the
// name of the audience it went to.
export async function archiveBatch(id: string, archived = true, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_batches")
    .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", id);
  if (error) throw error;
}

// ── Membership (static batches) ──────────────────────────────────────────────

export async function addBatchMembers(batchId: string, contactIds: string[], addedBy?: string | null, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return 0;
  // ignoreDuplicates so re-adding someone already in the batch is a no-op
  // instead of an error — the UI adds from multi-select and from filters, and
  // overlap between the two is normal.
  const { data, error } = await db().from("wa_batch_members")
    .upsert(ids.map(contact_id => ({ batch_id: batchId, contact_id, tenant_id: tenantId, added_by: addedBy ?? null })),
            { onConflict: "batch_id,contact_id", ignoreDuplicates: true })
    .select("contact_id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function removeBatchMembers(batchId: string, contactIds: string[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const ids = contactIds.filter(Boolean);
  if (!ids.length) return;
  const { error } = await db().from("wa_batch_members").delete()
    .eq("tenant_id", tenantId).eq("batch_id", batchId).in("contact_id", ids);
  if (error) throw error;
}

// Bulk "add everyone matching this filter" — the bridge between the two batch
// kinds: it materialises a dynamic-style query into static membership, so you
// get a filter's reach with a static batch's auditability.
export async function addBatchMembersFromFilter(batchId: string, filter: BatchFilter, addedBy?: string | null, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const rows = await contactsMatching(filter, ["id"], tenantId);
  return addBatchMembers(batchId, rows.map(r => r.id as string), addedBy, tenantId);
}

// ── Filter → contacts ────────────────────────────────────────────────────────

// One place that turns a BatchFilter into a contacts query, shared by dynamic
// resolution, add-from-filter and the count preview — so a batch can never
// preview one number and send to another.
async function contactsMatching(filter: BatchFilter, cols: string[], tenantId = DEFAULT_TENANT_ID): Promise<Record<string, unknown>[]> {
  let q = db().from("contacts").select(cols.join(",")).eq("tenant_id", tenantId).eq("status", "active");
  if (filter.tag) q = q.contains("tags", [filter.tag]);
  if (filter.attributeKey) q = q.contains("attributes", { [filter.attributeKey]: filter.attributeValue ?? "" });
  if (filter.source) q = q.eq("source", filter.source);
  if (filter.stageId) q = q.eq("pipeline_stage_id", filter.stageId);
  const { data, error } = await q.limit(AUDIENCE_LIMIT);
  if (error) throw error;
  if ((data?.length ?? 0) >= AUDIENCE_LIMIT) {
    console.warn(JSON.stringify({ tag: "audience_truncated", tenantId, limit: AUDIENCE_LIMIT, source: "batch_filter" }));
  }
  return (data ?? []) as unknown as Record<string, unknown>[];
}

// ── Resolution: batch → recipients ───────────────────────────────────────────

export async function resolveBatch(batchId: string, tenantId = DEFAULT_TENANT_ID): Promise<Recipient[]> {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) throw new Error("Batch not found");
  if (batch.kind === "dynamic") {
    const rows = await contactsMatching(batch.filter, ["phone", "name"], tenantId);
    return rows.map(r => ({ phone: r.phone as string, fullName: (r.name as string) ?? "" }));
  }
  // Static: read membership, then the contacts behind it. Members whose contact
  // has since been deactivated are dropped here rather than sent to.
  const { data, error } = await db().from("wa_batch_members")
    .select("contact_id, contacts!inner(phone, name, status)")
    .eq("tenant_id", tenantId).eq("batch_id", batchId)
    .limit(AUDIENCE_LIMIT);
  if (error) throw error;
  if ((data?.length ?? 0) >= AUDIENCE_LIMIT) {
    console.warn(JSON.stringify({ tag: "audience_truncated", tenantId, limit: AUDIENCE_LIMIT, source: "batch_members" }));
  }
  const out: Recipient[] = [];
  for (const row of (data ?? []) as unknown as { contacts?: { phone?: string; name?: string; status?: string } }[]) {
    const c = row.contacts;
    if (!c?.phone || c.status !== "active") continue;
    out.push({ phone: c.phone, fullName: c.name ?? "" });
  }
  return out;
}

export interface BatchMember {
  id: string;
  name: string;
  phone: string;
  optedIn: boolean;
  optInAt: string | null;
  addedAt: string | null;
}

// One page of a batch's people, for the detail view. Returns contact IDs —
// resolveBatch deliberately returns only what a SEND needs (phone + name), so
// a UI built on it could display members but never remove one.
//
// Static batches page in the database. Dynamic ones are resolved and sliced in
// memory: their membership is a query result, so there is no stable ordering to
// page against, and the AUDIENCE_LIMIT cap already bounds the work.
export async function batchMembers(
  batchId: string, offset = 0, limit = 50, tenantId = DEFAULT_TENANT_ID,
): Promise<{ members: BatchMember[]; total: number }> {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) return { members: [], total: 0 };

  if (batch.kind === "dynamic") {
    const rows = await contactsMatching(batch.filter, ["id", "name", "phone", "opted_in", "opt_in_at"], tenantId);
    return {
      total: rows.length,
      members: rows.slice(offset, offset + limit).map(r => ({
        id: r.id as string,
        name: (r.name as string) ?? "",
        phone: (r.phone as string) ?? "",
        optedIn: r.opted_in === true,
        optInAt: (r.opt_in_at as string) ?? null,
        addedAt: null,                     // membership is implied by the filter
      })),
    };
  }

  const { data, error, count } = await db().from("wa_batch_members")
    .select("added_at, contacts!inner(id, name, phone, opted_in, opt_in_at, status)", { count: "exact" })
    .eq("tenant_id", tenantId).eq("batch_id", batchId)
    .order("added_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const members = ((data ?? []) as unknown as {
    added_at: string; contacts?: { id: string; name?: string; phone?: string; opted_in?: boolean; opt_in_at?: string | null };
  }[]).flatMap(r => r.contacts ? [{
    id: r.contacts.id,
    name: r.contacts.name ?? "",
    phone: r.contacts.phone ?? "",
    optedIn: r.contacts.opted_in === true,
    optInAt: r.contacts.opt_in_at ?? null,
    addedAt: r.added_at ?? null,
  }] : []);
  return { members, total: count ?? members.length };
}

// Headline count for the picker. Cheap for static (a count query); for dynamic
// it resolves, because a filter's reach is only knowable by running it.
export async function batchSize(batchId: string, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const batch = await getBatch(batchId, tenantId);
  if (!batch) return 0;
  if (batch.kind === "dynamic") return (await resolveBatch(batchId, tenantId)).length;
  const { count, error } = await db().from("wa_batch_members")
    .select("contact_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("batch_id", batchId);
  if (error) throw error;
  return count ?? 0;
}


// ── Consent shortfall (reads the EXISTING opt-in state) ─────────────────────
// Not a second consent model: contacts.opted_in is already the record, and
// recipientsForAudience(onlyOptedIn = true) already stops unconsented people
// being queued. This only tells the UI how much of a batch that removes, so a
// 500-person batch that will really reach 200 says so before the send.
//
// Keyed on the last 10 digits, matching markOptedIn / isOptedOut: a contact
// imported without a country code must still match a webhook `from` that has one.
export async function consentMissing(phones: string[], tenantId = DEFAULT_TENANT_ID): Promise<Set<string>> {
  const wanted = new Map<string, string>();          // last10 -> full digits
  for (const p of phones) {
    const d = digits(p);
    if (d.length >= 10) wanted.set(last10(d), d);
  }
  if (!wanted.size) return new Set();

  const consented = new Set<string>();
  const all = [...wanted.values()];
  for (let i = 0; i < all.length; i += 500) {
    const { data, error } = await db().from("contacts")
      .select("phone, opted_in").eq("tenant_id", tenantId).in("phone", all.slice(i, i + 500));
    if (error) throw error;
    for (const r of data ?? []) if (r.opted_in === true) consented.add(last10(r.phone as string));
  }
  const missing = new Set<string>();
  // A number with no contact row counts as missing: no record is not consent.
  for (const key of wanted.keys()) if (!consented.has(key)) missing.add(key);
  return missing;
}

export async function consentStats(tenantId = DEFAULT_TENANT_ID): Promise<{ granted: number; missing: number }> {
  const base = () => db().from("contacts").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("status", "active");
  const [g, m] = await Promise.all([base().eq("opted_in", true), base().not("opted_in", "is", true)]);
  return { granted: g.count ?? 0, missing: m.count ?? 0 };
}

// ── Live Chat: this lead's batches ──────────────────────────────────────────

// Batches key on contacts.id but Live Chat keys on a conversation, so the phone
// is the join — and it must be country-code tolerant for the same reason
// markOptedIn is: a lead who typed "8368872108" has to resolve to the stored
// "918368872108" rather than looking like a different person.
export async function contactIdForPhone(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const d = digits(phone);
  if (d.length < 10) return null;
  const { data, error } = await db().from("contacts").select("id, phone")
    .eq("tenant_id", tenantId).like("phone", `%${d.slice(-10)}`);
  if (error) return null;
  // Longest match wins — the country-coded row is the one broadcasts send to.
  const hit = (data ?? [])
    .map(c => ({ id: c.id as string, phone: digits((c.phone as string) || "") }))
    .filter(c => last10(c.phone) === last10(d))
    .sort((a, b) => b.phone.length - a.phone.length)[0];
  return hit?.id ?? null;
}

// Static batches this contact belongs to. Dynamic ones are excluded on purpose:
// membership there is a filter result, so adding or removing one person is not
// something that can honestly be offered.
export async function batchesForContact(contactId: string, tenantId = DEFAULT_TENANT_ID): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db().from("wa_batch_members")
    .select("wa_batches!inner(id, name, kind, archived_at)")
    .eq("tenant_id", tenantId).eq("contact_id", contactId);
  if (error) return [];
  return ((data ?? []) as unknown as { wa_batches?: { id: string; name: string; kind: string; archived_at: string | null } }[])
    .flatMap(r => (r.wa_batches && r.wa_batches.kind === "static" && !r.wa_batches.archived_at)
      ? [{ id: r.wa_batches.id, name: r.wa_batches.name }] : []);
}
