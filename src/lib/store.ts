import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { encryptSecret, readSecret } from "./crypto";
import { DEFAULT_TENANT_ID } from "./tenant";
import { safeFilterValue, escapeLike, safeAttrKey } from "./filters";
import { logError } from "./errors";

// ── Types ────────────────────────────────────────────────────────────────────
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "partial" | "failed";
export type AutoTrigger = "contact_added" | "tag_added" | "api_event";

export interface Contact {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  tags: string[];
  attributes: Record<string, string>;
  status: "active" | "optedout";
  source: string | null;
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string | null;
  templateName: string;
  languageCode: string;
  variables: string[];
  headerImageUrl: string | null;
  audience: { mode: "all" | "tag" | "recipients" | "attribute"; tag?: string; key?: string; value?: string } | null;
  status: CampaignStatus;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  errorSummary: string | null;
  scheduledFor: string | null;
  autoSendEnabled: boolean;
  autoSendTrigger: AutoTrigger | null;
  triggerKey: string | null;
  delayValue: number;
  delayUnit: "minutes" | "hours" | "days";
  createdAt: string;
  sentAt: string | null;
  channelId: string | null;     // which WhatsApp number this campaign sends from
  replyFlowId: string | null;   // flow to start when a recipient replies ("bot on broadcast")
  tenantId: string;             // owning tenant — sends use this tenant's channel/limits
}

const digits = (p: string) => (p || "").replace(/\D/g, "");
const last10 = (p: string) => digits(p).slice(-10);
// Two numbers are the same person if one is a suffix of the other (a local
// "8368904146" vs its country-coded "918368904146"). Numbers that merely share
// 10 trailing digits but neither is a suffix of the other are kept separate.
const samePerson = (a: string, b: string) => a === b || a.endsWith(b) || b.endsWith(a);

function mapCampaign(r: Record<string, unknown>): Campaign {
  return {
    id: r.id as string,
    name: (r.name as string | null) ?? null,
    templateName: r.template_name as string,
    languageCode: r.language_code as string,
    variables: (r.variables as string[]) ?? [],
    headerImageUrl: (r.header_image_url as string | null) ?? null,
    audience: (r.audience as Campaign["audience"]) ?? null,
    status: r.status as CampaignStatus,
    totalRecipients: (r.total_recipients as number) ?? 0,
    sentCount: (r.sent_count as number) ?? 0,
    failedCount: (r.failed_count as number) ?? 0,
    errorSummary: (r.error_summary as string | null) ?? null,
    scheduledFor: (r.scheduled_for as string | null) ?? null,
    autoSendEnabled: (r.auto_send_enabled as boolean) ?? false,
    autoSendTrigger: (r.auto_send_trigger as AutoTrigger | null) ?? null,
    triggerKey: (r.trigger_key as string | null) ?? null,
    delayValue: (r.delay_value as number) ?? 0,
    delayUnit: (r.delay_unit as Campaign["delayUnit"]) ?? "minutes",
    createdAt: r.created_at as string,
    sentAt: (r.sent_at as string | null) ?? null,
    channelId: (r.channel_id as string | null) ?? null,
    replyFlowId: (r.reply_flow_id as string | null) ?? null,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
  };
}

function mapContact(r: Record<string, unknown>): Contact {
  return {
    id: r.id as string,
    phone: r.phone as string,
    name: (r.name as string) ?? "",
    email: (r.email as string | null) ?? null,
    tags: (r.tags as string[]) ?? [],
    attributes: (r.attributes as Record<string, string>) ?? {},
    status: r.status as Contact["status"],
    source: (r.source as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

// ── Contacts ──────────────────────────────────────────────────────────────────
// optIn captures proof-of-consent. Inbound messages / growth opt-ins are real
// consent (optIn.consented=true). Un-attested CSV/API imports default to
// consented=false so they're excluded from MARKETING audiences until the tenant
// attests consent. New rows only — onConflict ignoreDuplicates means an existing
// contact's opt-in state is never downgraded by a re-import.
export async function upsertContacts(
  rows: { phone: string; name?: string; email?: string; tags?: string[]; attributes?: Record<string, string> }[],
  source = "import",
  tenantId = DEFAULT_TENANT_ID,
  optIn?: { consented: boolean; proof?: string },
): Promise<{ inserted: number; skipped: number }> {
  const consented = optIn?.consented ?? false;
  const nowIso = new Date().toISOString();
  const clean = rows
    .map(r => ({
      tenant_id: tenantId, phone: digits(r.phone), name: (r.name ?? "").trim(),
      email: r.email?.trim() || null, tags: r.tags ?? [], attributes: r.attributes ?? {},
      status: "active", source,
      opted_in: consented,
      opt_in_source: source,
      opt_in_at: consented ? nowIso : null,
      opt_in_proof: optIn?.proof ?? null,
    }))
    .filter(r => r.phone.length >= 10);
  if (clean.length === 0) return { inserted: 0, skipped: rows.length };

  // Collapse country-code variants of the SAME person within this batch — the
  // longest (country-coded) number wins so sends/conversations stay consistent.
  const batch: typeof clean = [];
  for (const r of clean) {
    const hit = batch.find(b => samePerson(b.phone, r.phone));
    if (hit) {
      if (r.phone.length > hit.phone.length) hit.phone = r.phone;
      hit.tags = [...new Set([...hit.tags, ...r.tags])];
      hit.attributes = { ...r.attributes, ...hit.attributes };
      hit.name = hit.name || r.name; hit.email = hit.email || r.email;
      if (r.opted_in && !hit.opted_in) { hit.opted_in = true; hit.opt_in_source = r.opt_in_source; hit.opt_in_at = r.opt_in_at; hit.opt_in_proof = r.opt_in_proof; }
    } else batch.push({ ...r });
  }

  try {
    // Reconcile against existing contacts in this tenant that share a last-10
    // (country code may differ). Merge same-person variants into one contact.
    const keys = [...new Set(batch.map(r => r.phone.slice(-10)))];
    const { data: ex, error: exErr } = await db().from("contacts").select("id,phone,name,email,tags,attributes")
      .eq("tenant_id", tenantId).or(keys.map(k => `phone.like.*${k}`).join(","));
    if (exErr) throw exErr;
    type Row = { id: string; phone: string; name: string | null; email: string | null; tags: string[] | null; attributes: Record<string, string> | null };
    const byKey = new Map<string, Row[]>();
    for (const e of (ex ?? []) as Row[]) { const k = digits(e.phone).slice(-10); const a = byKey.get(k) ?? []; a.push(e); byKey.set(k, a); }

    let inserted = 0;
    const toInsert: typeof clean = [];
    const dupIdsToDelete: string[] = [];
    for (const r of batch) {
      const candidates = (byKey.get(r.phone.slice(-10)) ?? []).filter(e => samePerson(digits(e.phone), r.phone));
      if (!candidates.length) { toInsert.push(r); continue; }
      const primary = [...candidates].sort((a, b) => digits(b.phone).length - digits(a.phone).length)[0];
      const cluster = candidates.filter(c => samePerson(digits(c.phone), digits(primary.phone)));
      const phone = [r.phone, ...cluster.map(c => digits(c.phone))].sort((a, b) => b.length - a.length)[0];
      const tags = [...new Set([...cluster.flatMap(c => c.tags ?? []), ...r.tags])];
      const attributes = Object.assign({}, r.attributes, ...cluster.map(c => c.attributes ?? {}));
      await db().from("contacts").update({ phone, tags, attributes, name: primary.name || r.name, email: primary.email || r.email }).eq("tenant_id", tenantId).eq("id", primary.id);
      // Repoint ALL of this person's duplicate conversations in one query and
      // defer the row deletes — avoids the per-duplicate N+1 (2 queries each) on
      // large re-imports; the deletes go out as a single batched call below.
      const dupIds = cluster.filter(c => c.id !== primary.id).map(c => c.id);
      if (dupIds.length) {
        try {
          await db().from("wa_conversations").update({ contact_id: primary.id }).eq("tenant_id", tenantId).in("contact_id", dupIds);
          dupIdsToDelete.push(...dupIds);
        } catch { /* leave the duplicate rows if the repoint fails */ }
      }
    }
    if (dupIdsToDelete.length) {
      await db().from("contacts").delete().eq("tenant_id", tenantId).in("id", dupIdsToDelete).then(undefined, () => undefined);
    }
    if (toInsert.length) {
      const { data, error } = await db().from("contacts").upsert(toInsert, { onConflict: "tenant_id,phone", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      inserted = data?.length ?? 0;
    }
    return { inserted, skipped: rows.length - inserted };
  } catch (err) {
    // Dedup failed (e.g. an oversized lookup) — fall back to a plain upsert so
    // the import still lands; the unique (tenant_id, phone) constraint dedups.
    logError("contacts.dedup", err, { tenantId });
    const { data, error } = await db().from("contacts").upsert(batch, { onConflict: "tenant_id,phone", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    return { inserted: data?.length ?? 0, skipped: rows.length - (data?.length ?? 0) };
  }
}

// Record explicit opt-in for an existing contact (inbound message, growth keyword,
// website form, manual attestation). Idempotent; only ever upgrades to opted-in.
export async function markOptedIn(phone: string, source: string, proof: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  try {
    await db().from("contacts")
      .update({ opted_in: true, opt_in_source: source, opt_in_at: new Date().toISOString(), opt_in_proof: proof })
      .eq("tenant_id", tenantId).eq("phone", digits(phone));
  } catch (e) { logError("store.markOptedIn", e, { tenantId }); }
}

export interface ContactAttrFilter { key: string; op: "is" | "is_not" | "contains"; value: string }

export async function listContacts(opts: {
  tag?: string | null; search?: string | null; limit?: number; offset?: number;
  createdFrom?: string | null; createdTo?: string | null;
  seenFrom?: string | null; seenTo?: string | null;     // last inbound message window
  attrs?: ContactAttrFilter[]; tenantId?: string;
} = {}): Promise<{ data: Contact[]; total: number }> {
  const tid = opts.tenantId ?? DEFAULT_TENANT_ID;
  let q = db().from("contacts").select("*", { count: "exact" }).eq("tenant_id", tid).order("created_at", { ascending: false });
  if (opts.tag) q = q.contains("tags", [opts.tag]);
  if (opts.search) {
    // Escape LIKE wildcards and neutralize .or() grammar so a search for "%" or
    // "a,b" can't bypass the filter or inject extra conditions (filter bypass).
    const s = safeFilterValue(opts.search);
    if (s) q = q.or(`name.ilike.%${s}%,phone.ilike.%${s}%`);
  }
  if (opts.createdFrom) q = q.gte("created_at", opts.createdFrom);
  if (opts.createdTo) q = q.lte("created_at", opts.createdTo);
  for (const a of opts.attrs ?? []) {
    const key = a.key.trim();
    if (!key) continue;
    if (a.op === "is") q = q.contains("attributes", { [key]: a.value });
    else if (a.op === "is_not") q = q.not("attributes", "cs", JSON.stringify({ [key]: a.value }));
    else {
      // "contains" interpolates the key into a column path and the value into a
      // LIKE pattern — sanitize both so neither can break/inject the filter.
      const safeKey = safeAttrKey(key);
      if (safeKey) q = q.ilike(`attributes->>${safeKey}`, `%${escapeLike(a.value)}%`);
    }
  }
  // "Last seen" lives on conversations (last inbound message), so resolve the
  // matching phones first and narrow contacts to them.
  if (opts.seenFrom || opts.seenTo) {
    // Resolve the phones with inbound activity in the window, MOST-RECENT FIRST
    // so that when the cap is hit we keep the relevant (recently-seen) numbers
    // rather than an arbitrary slice. The cap bounds the IN(...) list — a very
    // large list would overflow the request URL. If we hit it we log it (no
    // longer a SILENT drop); the complete fix is a server-side join (RPC).
    const SEEN_PHONE_CAP = 1000;
    let cq = db().from("wa_conversations").select("phone").eq("tenant_id", tid).not("last_inbound_at", "is", null)
      .order("last_inbound_at", { ascending: false });
    if (opts.seenFrom) cq = cq.gte("last_inbound_at", opts.seenFrom);
    if (opts.seenTo) cq = cq.lte("last_inbound_at", opts.seenTo);
    const { data: convs } = await cq.limit(SEEN_PHONE_CAP);
    if ((convs?.length ?? 0) >= SEEN_PHONE_CAP) {
      console.warn(JSON.stringify({ tag: "seen_filter_truncated", tenantId: tid, cap: SEEN_PHONE_CAP }));
    }
    const phones = [...new Set((convs ?? []).map(c => digits(c.phone as string)))];
    if (phones.length === 0) return { data: [], total: 0 };
    q = q.in("phone", phones);
  }
  const limit = Math.min(500, opts.limit ?? 100);
  q = q.range(opts.offset ?? 0, (opts.offset ?? 0) + limit - 1);
  const { data, error, count } = await q;
  if (error) throw error;
  return { data: (data ?? []).map(mapContact), total: count ?? 0 };
}

// Recipients for a broadcast audience (active contacts only). When onlyOptedIn
// is set (the default for marketing broadcasts) non-consented contacts are
// excluded — the proof-of-opt-in gate that keeps numbers off Meta's ban radar.
export async function recipientsForAudience(audience: { mode: "all" | "tag" | "attribute"; tag?: string; key?: string; value?: string }, tenantId = DEFAULT_TENANT_ID, onlyOptedIn = false): Promise<{ phone: string; fullName: string }[]> {
  let q = db().from("contacts").select("phone, name").eq("tenant_id", tenantId).eq("status", "active");
  if (onlyOptedIn) q = q.eq("opted_in", true);
  if (audience.mode === "tag" && audience.tag) q = q.contains("tags", [audience.tag]);
  if (audience.mode === "attribute" && audience.key) q = q.contains("attributes", { [audience.key]: audience.value ?? "" });
  const AUDIENCE_LIMIT = 50000;
  const { data, error } = await q.limit(AUDIENCE_LIMIT);
  if (error) throw error;
  // Surface silent truncation: a larger audience is capped here, so the caller
  // would under-send without any signal. Log it (and it can be alerted on).
  if ((data?.length ?? 0) >= AUDIENCE_LIMIT) {
    console.warn(JSON.stringify({ tag: "audience_truncated", tenantId, limit: AUDIENCE_LIMIT, mode: audience.mode }));
  }
  return (data ?? []).map(r => ({ phone: r.phone as string, fullName: (r.name as string) ?? "" }));
}

// Add one tag to a contact (no-op when missing or already tagged).
export async function addContactTag(phone: string, tag: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const t = tag.trim();
  if (!t) return;
  const c = await getContactByPhone(phone, tenantId);
  if (!c || c.tags.includes(t)) return;
  await db().from("contacts").update({ tags: [...c.tags, t] }).eq("tenant_id", tenantId).eq("id", c.id);
}

// Merge attributes into an existing contact (does not overwrite unrelated keys).
export async function setContactAttributes(phone: string, attributes: Record<string, string>, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const c = await getContactByPhone(phone, tenantId);
  if (!c) return;
  await db().from("contacts").update({ attributes: { ...c.attributes, ...attributes } }).eq("tenant_id", tenantId).eq("id", c.id);
}

// Partial profile edit from the contact drawer — only the provided fields change.
export async function updateContactProfile(phone: string, patch: { name?: string; email?: string | null; tags?: string[]; attributes?: Record<string, string> }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const c = await getContactByPhone(phone, tenantId);
  if (!c) return;
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.attributes !== undefined) row.attributes = patch.attributes;
  if (Object.keys(row).length) await db().from("contacts").update(row).eq("tenant_id", tenantId).eq("id", c.id);
}

export async function getContactByPhone(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<Contact | null> {
  const { data } = await db().from("contacts").select("*").eq("tenant_id", tenantId).eq("phone", digits(phone)).maybeSingle();
  return data ? mapContact(data as Record<string, unknown>) : null;
}

export async function countContacts(tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const { count } = await db().from("contacts").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active");
  return count ?? 0;
}

// ── Opt-outs ──────────────────────────────────────────────────────────────────
export async function addOptout(phone: string, reason?: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_optouts").upsert({ tenant_id: tenantId, phone: last10(phone), reason: reason ?? null }, { onConflict: "tenant_id,phone" });
  await db().from("contacts").update({ status: "optedout" }).eq("tenant_id", tenantId).eq("phone", digits(phone));
}

export async function removeOptout(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_optouts").delete().eq("tenant_id", tenantId).eq("phone", last10(phone));
  await db().from("contacts").update({ status: "active" }).eq("tenant_id", tenantId).eq("phone", digits(phone));
}

export async function listOptouts(tenantId = DEFAULT_TENANT_ID): Promise<{ phone: string; reason: string | null; createdAt: string }[]> {
  const { data } = await db().from("wa_optouts").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => ({ phone: r.phone as string, reason: (r.reason as string | null) ?? null, createdAt: r.created_at as string }));
}

// Opt-outs are per-tenant — a STOP for one business never suppresses sends for
// another (separate WhatsApp numbers, separate consent).
export async function optoutSet(tenantId = DEFAULT_TENANT_ID): Promise<Set<string>> {
  const { data } = await db().from("wa_optouts").select("phone").eq("tenant_id", tenantId);
  return new Set((data ?? []).map(r => last10(r.phone as string)));
}

// Single-number opt-out check (indexed on tenant_id, phone). Use this on the
// per-message hot paths (inbound webhooks, single CRM send) instead of loading
// the tenant's entire opt-out set into memory for one lookup. optoutSet() is
// still the right tool for bulk send paths that check many numbers at once.
export async function isOptedOut(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  const { count } = await db().from("wa_optouts").select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("phone", last10(phone));
  return (count ?? 0) > 0;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export async function createCampaign(p: Partial<Campaign> & { templateName: string }, tenantId = DEFAULT_TENANT_ID): Promise<Campaign> {
  const { data, error } = await db().from("wa_campaigns").insert({
    tenant_id: tenantId,
    name: p.name ?? null,
    template_name: p.templateName,
    language_code: p.languageCode ?? "en_US",
    variables: p.variables ?? [],
    header_image_url: p.headerImageUrl ?? null,
    audience: p.audience ?? null,
    status: p.status ?? "draft",
    total_recipients: p.totalRecipients ?? 0,
    scheduled_for: p.scheduledFor ?? null,
    auto_send_enabled: p.autoSendEnabled ?? false,
    auto_send_trigger: p.autoSendTrigger ?? null,
    trigger_key: p.triggerKey ?? null,
    delay_value: p.delayValue ?? 0,
    delay_unit: p.delayUnit ?? "minutes",
    ...(p.channelId ? { channel_id: p.channelId } : {}),
    ...(p.replyFlowId ? { reply_flow_id: p.replyFlowId } : {}),
  }).select().single();
  if (error) throw error;
  return mapCampaign(data as Record<string, unknown>);
}

// tenantId optional: cron resolves campaigns by id (tenant-agnostic) and reads
// the owner from the row; admin routes pass the session tenant to scope access.
export async function getCampaign(id: string, tenantId?: string): Promise<Campaign | null> {
  let q = db().from("wa_campaigns").select("*").eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

export async function listCampaigns(tenantId = DEFAULT_TENANT_ID): Promise<Campaign[]> {
  const { data, error } = await db().from("wa_campaigns").select("*").eq("tenant_id", tenantId).eq("auto_send_enabled", false).order("created_at", { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

export async function updateCampaign(id: string, p: Partial<{ status: CampaignStatus; sentCount: number; failedCount: number; errorSummary: string | null; sentAt: string | null; totalRecipients: number; scheduledFor: string | null }>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (p.status !== undefined) row.status = p.status;
  if (p.sentCount !== undefined) row.sent_count = p.sentCount;
  if (p.failedCount !== undefined) row.failed_count = p.failedCount;
  if (p.errorSummary !== undefined) row.error_summary = p.errorSummary;
  if (p.sentAt !== undefined) row.sent_at = p.sentAt;
  if (p.totalRecipients !== undefined) row.total_recipients = p.totalRecipients;
  if (p.scheduledFor !== undefined) row.scheduled_for = p.scheduledFor;
  const { error } = await db().from("wa_campaigns").update(row).eq("id", id);
  if (error) throw error;
}

export async function getDueScheduledCampaigns(limit = 25): Promise<Campaign[]> {
  const { data } = await db().from("wa_campaigns").select("*").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).limit(limit);
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

// ── Auto-send configs ───────────────────────────────────────────────────────
export async function getAutoSend(trigger: AutoTrigger, triggerKey: string | null, tenantId = DEFAULT_TENANT_ID): Promise<Campaign | null> {
  let q = db().from("wa_campaigns").select("*").eq("tenant_id", tenantId).eq("auto_send_enabled", true).eq("auto_send_trigger", trigger);
  if (triggerKey) q = q.eq("trigger_key", triggerKey);
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data ? mapCampaign(data as Record<string, unknown>) : null;
}

export async function listAutomations(tenantId = DEFAULT_TENANT_ID): Promise<Campaign[]> {
  const { data } = await db().from("wa_campaigns").select("*").eq("tenant_id", tenantId).eq("auto_send_enabled", true).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapCampaign(r as Record<string, unknown>));
}

export async function disableAutomation(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_campaigns").update({ auto_send_enabled: false }).eq("tenant_id", tenantId).eq("id", id);
}

// ── Queue ─────────────────────────────────────────────────────────────────────
export async function enqueue(campaignId: string, recipients: { phone: string; fullName: string }[], tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const seen = new Set<string>();
  const rows = recipients
    .filter(r => { const k = last10(r.phone); if (!k || seen.has(k)) return false; seen.add(k); return digits(r.phone).length >= 10; })
    .map(r => ({ tenant_id: tenantId, campaign_id: campaignId, phone: digits(r.phone), recipient_name: r.fullName ?? "", status: "pending" }));
  if (rows.length === 0) return 0;
  const { data, error } = await db().from("wa_send_queue").upsert(rows, { onConflict: "campaign_id,phone", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function claimPending(campaignId: string, limit: number): Promise<{ id: string; phone: string; fullName: string }[]> {
  // Atomic claim (migration 0044): FOR UPDATE SKIP LOCKED so concurrent
  // workers/cron runs never grab the same rows. Falls back to a plain select if
  // the RPC isn't deployed yet, so a missing migration never bricks sending.
  const { data, error } = await db().rpc("claim_send_queue", { p_campaign: campaignId, p_limit: limit });
  if (!error && data) {
    return (data as Record<string, unknown>[]).map(r => ({ id: r.id as string, phone: r.phone as string, fullName: (r.recipient_name as string) ?? "" }));
  }
  const { data: fb } = await db().from("wa_send_queue").select("id, phone, recipient_name").eq("campaign_id", campaignId).eq("status", "pending").order("created_at").limit(limit);
  return (fb ?? []).map(r => ({ id: r.id as string, phone: r.phone as string, fullName: (r.recipient_name as string) ?? "" }));
}

export async function markQueue(ids: string[], status: "sent" | "failed" | "skipped"): Promise<void> {
  if (ids.length === 0) return;
  await db().from("wa_send_queue").update({ status, processed_at: new Date().toISOString() }).in("id", ids);
}

// Release a claim WITHOUT completing it — used when a send aborted before reaching
// these recipients. Clearing claimed_at lets the next drain re-claim them
// immediately (status stays 'pending') instead of waiting out the 10-min stale
// window. No-ops gracefully on a pre-0044 schema (no claimed_at column).
export async function releaseQueueClaims(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db().from("wa_send_queue").update({ claimed_at: null }).in("id", ids).then(undefined, () => undefined);
}

export async function countPending(campaignId: string): Promise<number> {
  const { count } = await db().from("wa_send_queue").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending");
  return count ?? 0;
}

export async function countQueueTotal(campaignId: string): Promise<number> {
  const { count } = await db().from("wa_send_queue").select("*", { count: "exact", head: true }).eq("campaign_id", campaignId).neq("status", "cancelled");
  return count ?? 0;
}

export async function campaignsWithPending(): Promise<string[]> {
  const { data } = await db().from("wa_send_queue").select("campaign_id").eq("status", "pending").limit(1000);
  return [...new Set((data ?? []).map(r => r.campaign_id as string))];
}

// ── Broadcast → flow arming ("bot on broadcast") ────────────────────────────────
// When a broadcast names a reply flow, each delivered recipient is "armed": their
// next inbound starts that flow. Keyed by (tenant, last-10 digits) so country-code
// variants of the same number match. Best-effort — silently no-ops if the table is
// absent (migration 0048 not applied yet).
export async function armFlow(phones: string[], flowId: string, campaignId: string | null, tenantId = DEFAULT_TENANT_ID, hours = 168): Promise<void> {
  const seen = new Set<string>();
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const rows = phones
    .map(p => last10(p))
    .filter(k => { if (!k || k.length < 10 || seen.has(k)) return false; seen.add(k); return true; })
    .map(phone => ({ tenant_id: tenantId, phone, flow_id: flowId, campaign_id: campaignId, expires_at: expiresAt }));
  if (rows.length === 0) return;
  await db().from("wa_flow_arms").upsert(rows, { onConflict: "tenant_id,phone" }).then(undefined, () => undefined);
}

// Returns the armed flow id for this number (if any, unexpired) and consumes it
// so the flow starts only once. Returns null when nothing is armed.
export async function takeArmedFlow(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<string | null> {
  const key = last10(phone);
  if (!key || key.length < 10) return null;
  try {
    const { data } = await db().from("wa_flow_arms").select("flow_id, expires_at").eq("tenant_id", tenantId).eq("phone", key).maybeSingle();
    if (!data) return null;
    await db().from("wa_flow_arms").delete().eq("tenant_id", tenantId).eq("phone", key);
    if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
    return (data.flow_id as string) ?? null;
  } catch { return null; }
}

export async function clearArmedFlow(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const key = last10(phone);
  if (!key) return;
  await db().from("wa_flow_arms").delete().eq("tenant_id", tenantId).eq("phone", key).then(undefined, () => undefined);
}

// ── Send log ──────────────────────────────────────────────────────────────────
export async function insertLog(entries: { campaignId: string; phone: string; recipientName: string; status: "sent" | "failed" | "skipped"; errorDetail?: string; metaMessageId?: string }[], tenantId = DEFAULT_TENANT_ID): Promise<void> {
  if (entries.length === 0) return;
  await db().from("wa_send_log").insert(entries.map(e => ({
    tenant_id: tenantId,
    campaign_id: e.campaignId, phone: e.phone, recipient_name: e.recipientName,
    status: e.status, error_detail: e.errorDetail ?? null, meta_message_id: e.metaMessageId ?? null,
  })));
}

export async function logCounts(campaignId: string): Promise<{ sent: number; failed: number; delivered: number; read: number }> {
  const { data } = await db().from("wa_send_log").select("phone, status").eq("campaign_id", campaignId);
  const rank: Record<string, number> = { read: 4, delivered: 3, sent: 2, failed: 1, skipped: 0 };
  const best = new Map<string, string>();
  for (const r of data ?? []) {
    const k = last10(r.phone as string), s = r.status as string;
    const cur = best.get(k);
    if (cur === undefined || (rank[s] ?? -1) > (rank[cur] ?? -1)) best.set(k, s);
  }
  let sent = 0, failed = 0, delivered = 0, read = 0;
  for (const s of best.values()) {
    if (s === "read") { read++; delivered++; sent++; }
    else if (s === "delivered") { delivered++; sent++; }
    else if (s === "sent") sent++;
    else if (s === "failed") failed++;
  }
  return { sent, failed, delivered, read };
}

export async function updateLogByMessageId(metaMessageId: string, status: "delivered" | "read", at: string): Promise<void> {
  const row: Record<string, unknown> = { status };
  if (status === "delivered") row.delivered_at = at;
  if (status === "read") { row.read_at = at; row.delivered_at = at; }
  // Only ever move a receipt FORWARD (sent → delivered → read). Meta can deliver
  // a "delivered" webhook after "read" (or duplicates); without this guard a late
  // event would downgrade the row and the read count would silently shrink.
  const allowedFrom = status === "read" ? ["sent", "delivered"] : ["sent"];
  await db().from("wa_send_log").update(row).eq("meta_message_id", metaMessageId).in("status", allowedFrom);
}

// Per-tenant daily sent count — each tenant's volume counts against its own cap
// so one tenant can never consume another's daily headroom.
export async function dailySentCount(tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const { count } = await db().from("wa_send_log").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("sent_at", since.toISOString()).in("status", ["sent", "delivered", "read"]);
  return count ?? 0;
}

// Trailing 24-HOUR sent count — matches Meta's messaging-tier limit, which is a
// rolling 24h window (NOT a calendar day). Use this when gating against the
// number's real tier so a number can't overshoot its per-24h allowance.
export async function sentLast24h(tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db().from("wa_send_log").select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("sent_at", since).in("status", ["sent", "delivered", "read"]);
  return count ?? 0;
}

// ── Scheduled (auto-send) ─────────────────────────────────────────────────────
export async function scheduleSend(p: { campaignId: string; contactId: string | null; phone: string; recipientName: string; trigger: string; sendAfter: string }, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("wa_scheduled_sends").insert({
    tenant_id: tenantId,
    campaign_id: p.campaignId, contact_id: p.contactId, phone: digits(p.phone),
    recipient_name: p.recipientName, trigger: p.trigger, send_after: p.sendAfter, status: "pending",
  });
}

export async function getDueScheduledSends(limit = 150): Promise<{ id: string; campaignId: string; phone: string; recipientName: string }[]> {
  const { data } = await db().from("wa_scheduled_sends").select("id, campaign_id, phone, recipient_name").eq("status", "pending").lte("send_after", new Date().toISOString()).order("send_after").limit(limit);
  return (data ?? []).map(r => ({ id: r.id as string, campaignId: r.campaign_id as string, phone: r.phone as string, recipientName: (r.recipient_name as string) ?? "" }));
}

export async function markScheduled(id: string, status: "sent" | "skipped" | "failed", error?: string): Promise<void> {
  await db().from("wa_scheduled_sends").update({ status, error: error ?? null, processed_at: new Date().toISOString() }).eq("id", id);
}

// ── Conversations (two-way / AI assistant) ────────────────────────────────────
export type ConvStatus = "active" | "paused" | "escalated";

export interface Conversation {
  id: string;
  phone: string;
  contactId: string | null;
  name: string;
  status: ConvStatus;
  botEnabled: boolean;
  lastMessage: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  needsReply: boolean;
  labels: string[];
  assignedTo: string | null;
  welcomed: boolean;
  agentId: string | null;
  primaryKbTag: string | null;  // scope AI knowledge to a flow's tagged docs (masterclass etc.)
  aiReplyCount: number;         // AI auto-replies sent so far (capped before human handoff)
  platform: "whatsapp" | "instagram";   // which channel this chat arrived on
  avatarUrl: string | null;     // profile image (Instagram); null for WhatsApp
  isComment: boolean;           // originated from an IG comment (AI reply flow), not a DM
  channelId: string | null;     // which WhatsApp number this chat lives on
  leadPhone: string | null;     // a real phone the lead shared (IG has no phone) — for CRM matching
  tenantId: string;             // owning tenant
  createdAt: string;
}

export interface ConvMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  source: "inbound" | "bot" | "agent";
  createdAt: string;
  mediaUrl?: string | null;    // e.g. an inbound voice note, playable in Live Chat
  mediaType?: string | null;   // its MIME type, e.g. "audio/ogg"
}

function mapConversation(r: Record<string, unknown>): Conversation {
  return {
    id: r.id as string,
    phone: r.phone as string,
    contactId: (r.contact_id as string | null) ?? null,
    name: (r.name as string) ?? "",
    status: (r.status as ConvStatus) ?? "active",
    botEnabled: (r.bot_enabled as boolean) ?? true,
    lastMessage: (r.last_message as string | null) ?? null,
    lastInboundAt: (r.last_inbound_at as string | null) ?? null,
    lastOutboundAt: (r.last_outbound_at as string | null) ?? null,
    needsReply: (r.needs_reply as boolean) ?? false,
    labels: (r.labels as string[]) ?? [],
    assignedTo: (r.assigned_to as string | null) ?? null,
    welcomed: (r.welcomed as boolean) ?? false,
    agentId: (r.agent_id as string | null) ?? null,
    primaryKbTag: (r.primary_kb_tag as string | null) ?? null,
    aiReplyCount: (r.ai_reply_count as number) ?? 0,
    platform: (r.platform as "whatsapp" | "instagram") ?? "whatsapp",
    avatarUrl: (r.avatar_url as string | null) ?? null,
    isComment: (r.is_comment as boolean) ?? false,
    channelId: (r.channel_id as string | null) ?? null,
    leadPhone: (r.lead_phone as string | null) ?? null,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    createdAt: r.created_at as string,
  };
}

// Store a conversation's profile image (Instagram). Keyed by id (globally-unique).
export async function setConversationAvatar(conversationId: string, url: string): Promise<void> {
  await db().from("wa_conversations").update({ avatar_url: url }).eq("id", conversationId).then(() => {}, () => {});
}

// Flag whether a conversation is an IG comment thread (vs a DM chat). Tolerant
// of a missing column (pre-0039) so it never breaks the webhook.
export async function setConversationComment(conversationId: string, isComment: boolean): Promise<void> {
  await db().from("wa_conversations").update({ is_comment: isComment }).eq("id", conversationId).then(() => {}, () => {});
}

// Agent opened the chat → mark it read (no longer awaiting our reply).
export async function markConversationRead(conversationId: string): Promise<void> {
  await db().from("wa_conversations").update({ needs_reply: false }).eq("id", conversationId).then(() => {}, () => {});
}

// Bump the AI auto-reply counter (used to cap before handing off to a human).
// Keyed by conversation id (a globally-unique uuid), like touchInbound.
export async function incAiReplies(conversationId: string, current: number): Promise<void> {
  await db().from("wa_conversations").update({ ai_reply_count: current + 1 }).eq("id", conversationId).then(() => {}, () => {});
}

// Hand a conversation off to a human: escalate, flag for reply, stop the bot.
export async function escalateConversation(conversationId: string): Promise<void> {
  await db().from("wa_conversations").update({ status: "escalated", needs_reply: true, bot_enabled: false }).eq("id", conversationId).then(() => {}, () => {});
}

// Find-or-create by phone. Keeps the latest name if provided; stamps the
// channel (receiving number) on create or when it was unknown.
export async function getOrCreateConversation(phone: string, name?: string, channelId?: string | null, platform: "whatsapp" | "instagram" = "whatsapp", tenantId = DEFAULT_TENANT_ID): Promise<Conversation> {
  // IG uses non-numeric IGSIDs, so only digit-normalize WhatsApp identifiers.
  const p = platform === "instagram" ? phone.trim() : digits(phone);
  const existing = await db().from("wa_conversations").select("*").eq("tenant_id", tenantId).eq("phone", p).maybeSingle();
  if (existing.data) {
    const row = existing.data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (name && name.trim() && !row.name) patch.name = name.trim();
    if (channelId && !row.channel_id) patch.channel_id = channelId;
    if (Object.keys(patch).length) {
      const { error } = await db().from("wa_conversations").update(patch).eq("tenant_id", tenantId).eq("phone", p);
      if (!error) Object.assign(row, patch);
    }
    return mapConversation(row);
  }
  const contact = platform === "instagram" ? null : await getContactByPhone(p, tenantId);
  const base: Record<string, unknown> = { tenant_id: tenantId, phone: p, name: (name ?? contact?.name ?? "").trim(), contact_id: contact?.id ?? null, platform };
  let ins = await db().from("wa_conversations").insert(channelId ? { ...base, channel_id: channelId } : base).select().single();
  // channel_id / platform column missing (migration not applied) — retry minimal.
  if (ins.error) ins = await db().from("wa_conversations").insert({ tenant_id: tenantId, phone: p, name: (name ?? "").trim() }).select().single();
  if (ins.error) {
    // Race: another inbound created it first — re-read.
    const retry = await db().from("wa_conversations").select("*").eq("tenant_id", tenantId).eq("phone", p).single();
    return mapConversation(retry.data as Record<string, unknown>);
  }
  return mapConversation(ins.data as Record<string, unknown>);
}

// Read-only lookup by phone — used by the CRM panel, which must not create
// empty conversations just because an agent opened the tab.
export async function getConversationByPhone(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<Conversation | null> {
  const { data } = await db().from("wa_conversations").select("*").eq("tenant_id", tenantId).eq("phone", digits(phone)).maybeSingle();
  return data ? mapConversation(data as Record<string, unknown>) : null;
}

// An Instagram conversation linked to a real phone the lead shared (lead_phone).
// Lets the CRM panel show the IG thread for a lead identified by phone.
export async function getIgConversationByLeadPhone(phone: string, tenantId = DEFAULT_TENANT_ID): Promise<Conversation | null> {
  const { data } = await db().from("wa_conversations").select("*")
    .eq("tenant_id", tenantId).eq("platform", "instagram").eq("lead_phone", digits(phone))
    .order("last_inbound_at", { ascending: false }).limit(1).maybeSingle();
  return data ? mapConversation(data as Record<string, unknown>) : null;
}

// When tenantId is supplied the lookup is tenant-scoped — pass it from any
// caller that takes a client-supplied conversation id (prevents cross-tenant
// IDOR; a foreign id returns null → 404).
export async function getConversation(id: string, tenantId?: string): Promise<Conversation | null> {
  let q = db().from("wa_conversations").select("*").eq("id", id);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  return data ? mapConversation(data as Record<string, unknown>) : null;
}

export async function listConversations(opts: { status?: ConvStatus | null; limit?: number; tenantId?: string } = {}): Promise<Conversation[]> {
  let q = db().from("wa_conversations").select("*").eq("tenant_id", opts.tenantId ?? DEFAULT_TENANT_ID).order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(Math.min(200, opts.limit ?? 100));
  if (opts.status) q = q.eq("status", opts.status);
  const { data } = await q;
  return (data ?? []).map(r => mapConversation(r as Record<string, unknown>));
}

export async function appendConvMessage(p: { conversationId: string; role: "user" | "assistant"; body: string; metaId?: string | null; source: "inbound" | "bot" | "agent"; tenantId?: string; mediaUrl?: string | null; mediaType?: string | null }): Promise<void> {
  const row: Record<string, unknown> = {
    tenant_id: p.tenantId ?? DEFAULT_TENANT_ID, conversation_id: p.conversationId, role: p.role, body: p.body,
    meta_message_id: p.metaId ?? null, source: p.source,
  };
  if (p.mediaUrl) { row.media_url = p.mediaUrl; row.media_type = p.mediaType ?? null; }
  let { error } = await db().from("wa_conv_messages").insert(row);
  // Pre-migration safety: if the media columns aren't present yet (0052), retry
  // without them so a voice note still logs as text instead of being dropped.
  if (error && error.code === "42703" && p.mediaUrl) {
    delete row.media_url; delete row.media_type;
    ({ error } = await db().from("wa_conv_messages").insert(row));
  }
  // Duplicate meta_message_id (webhook retry) is expected — swallow unique violations.
  if (error && error.code !== "23505") throw error;
}

export async function getConvHistory(conversationId: string, limit = 20, tenantId?: string): Promise<ConvMessage[]> {
  const fetchRows = async (cols: string) => {
    let q = db().from("wa_conv_messages").select(cols).eq("conversation_id", conversationId);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    return { data: (data ?? []) as unknown as Record<string, unknown>[], error };
  };
  let { data, error } = await fetchRows("id, role, body, source, created_at, media_url, media_type");
  // Pre-migration safety: fall back to the columns that always exist (0052).
  if (error && (error as { code?: string }).code === "42703") ({ data } = await fetchRows("id, role, body, source, created_at"));
  const rows = data.reverse();
  return rows.map(r => ({
    id: r.id as string, role: r.role as "user" | "assistant", body: r.body as string,
    source: (r.source as ConvMessage["source"]) ?? "bot", createdAt: r.created_at as string,
    mediaUrl: (r.media_url as string | null) ?? null, mediaType: (r.media_type as string | null) ?? null,
  }));
}

// Already-logged check (idempotency before doing LLM work on a retried webhook).
export async function messageLogged(metaId: string): Promise<boolean> {
  const { count } = await db().from("wa_conv_messages").select("*", { count: "exact", head: true }).eq("meta_message_id", metaId);
  return (count ?? 0) > 0;
}

// Atomically claim a webhook event by a unique key. Returns true only for the
// FIRST caller to see this key; concurrent/duplicate deliveries get false and
// must skip all side effects (AI reply, sends, orders, enrollment). Degrades to
// true (process) if the dedup table is missing, so an unapplied migration never
// drops live messages.
export async function claimWebhookEvent(key: string): Promise<boolean> {
  const { error } = await db().from("wa_webhook_dedup").insert({ key });
  if (!error) return true;
  if (error.code === "23505") return false;   // already claimed (unique violation)
  return true;                                 // table missing / other → don't drop
}

// Housekeeping: the dedup + login-throttle tables only need rows for their short
// windows (Meta retries within ~hours; the login window is 15 min). Prune from
// the cron so they don't grow unbounded. Best-effort; returns rows removed.
export async function pruneEphemeral(): Promise<{ dedup: number; loginAttempts: number }> {
  const out = { dedup: 0, loginAttempts: 0 };
  try {
    const cutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
    const { data } = await db().from("wa_webhook_dedup").delete().lt("created_at", cutoff).select("key");
    out.dedup = data?.length ?? 0;
  } catch { /* table missing */ }
  try {
    const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { data } = await db().from("wa_login_attempts").delete().lt("created_at", cutoff).select("id");
    out.loginAttempts = data?.length ?? 0;
  } catch { /* table missing */ }
  return out;
}

export async function setConversationStatus(id: string, status: ConvStatus): Promise<void> {
  await db().from("wa_conversations").update({ status }).eq("id", id);
}

export async function setBotEnabled(id: string, enabled: boolean): Promise<void> {
  await db().from("wa_conversations").update({ bot_enabled: enabled }).eq("id", id);
}

export async function touchInbound(id: string, lastMessage: string): Promise<void> {
  await db().from("wa_conversations").update({
    last_inbound_at: new Date().toISOString(), last_message: lastMessage.slice(0, 280), needs_reply: true,
  }).eq("id", id);
}

export async function touchOutbound(id: string, lastMessage: string): Promise<void> {
  await db().from("wa_conversations").update({
    last_outbound_at: new Date().toISOString(), last_message: lastMessage.slice(0, 280), needs_reply: false,
  }).eq("id", id);
}

// Atomically claim a conversation for replying: flips needs_reply true→false and
// returns true only to the caller that won. Prevents the worker + cron sweep from
// both replying to the same inbound message.
export async function claimReply(id: string): Promise<boolean> {
  const { data } = await db().from("wa_conversations")
    .update({ needs_reply: false }).eq("id", id).eq("needs_reply", true).select("id");
  return (data?.length ?? 0) > 0;
}

// Re-flag a conversation for reply (e.g. when a claimed reply attempt failed).
export async function reflagReply(id: string): Promise<void> {
  await db().from("wa_conversations").update({ needs_reply: true }).eq("id", id);
}

// Conversations with an unanswered inbound (cron fallback for dropped reply jobs).
export async function conversationsNeedingReply(limit = 20): Promise<Conversation[]> {
  const { data } = await db().from("wa_conversations").select("*")
    .eq("needs_reply", true).eq("status", "active").eq("bot_enabled", true)
    .order("last_inbound_at", { ascending: true }).limit(limit);
  return (data ?? []).map(r => mapConversation(r as Record<string, unknown>));
}

// ── Knowledge base (RAG) ──────────────────────────────────────────────────────
export type KbStatus = "processing" | "ready" | "failed";
export type KbSourceType = "pdf" | "docx" | "text" | "url";

export interface KbDocument {
  id: string;
  title: string;
  sourceType: KbSourceType;
  sourceRef: string | null;
  status: KbStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
  contentHash: string | null;
  lastSyncedAt: string | null;
  tenantId: string;
  tag: string | null;
}

function mapDocument(r: Record<string, unknown>): KbDocument {
  return {
    id: r.id as string,
    title: r.title as string,
    sourceType: r.source_type as KbSourceType,
    sourceRef: (r.source_ref as string | null) ?? null,
    status: r.status as KbStatus,
    error: (r.error as string | null) ?? null,
    chunkCount: (r.chunk_count as number) ?? 0,
    createdAt: r.created_at as string,
    contentHash: (r.content_hash as string | null) ?? null,
    lastSyncedAt: (r.last_synced_at as string | null) ?? null,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    tag: (r.tag as string | null) ?? null,
  };
}

export async function createDocument(p: { title: string; sourceType: KbSourceType; sourceRef?: string | null; tag?: string | null }, tenantId = DEFAULT_TENANT_ID): Promise<KbDocument> {
  const row: Record<string, unknown> = { tenant_id: tenantId, title: p.title, source_type: p.sourceType, source_ref: p.sourceRef ?? null, status: "processing" };
  if (p.tag?.trim()) row.tag = p.tag.trim();   // optional; column added in 0047
  const { data, error } = await db().from("kb_documents").insert(row).select().single();
  if (error) throw error;
  return mapDocument(data as Record<string, unknown>);
}

export async function setDocStatus(id: string, status: KbStatus, extra: { chunkCount?: number; error?: string | null } = {}, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const row: Record<string, unknown> = { status };
  if (extra.chunkCount !== undefined) row.chunk_count = extra.chunkCount;
  if (extra.error !== undefined) row.error = extra.error;
  await db().from("kb_documents").update(row).eq("tenant_id", tenantId).eq("id", id);
}

export async function listDocuments(tenantId = DEFAULT_TENANT_ID): Promise<KbDocument[]> {
  const { data } = await db().from("kb_documents").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  return (data ?? []).map(r => mapDocument(r as Record<string, unknown>));
}

export async function deleteDocument(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("kb_documents").delete().eq("tenant_id", tenantId).eq("id", id);   // chunks cascade
}

// Record a document's content hash + sync time after a (re-)crawl. Best-effort:
// if the 0032 columns aren't migrated yet the update simply errors out unused.
export async function setDocSync(id: string, contentHash: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  await db().from("kb_documents").update({ content_hash: contentHash, last_synced_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("id", id);
}

// Set/clear a document's topic tag (used as a flow's primary knowledge).
export async function setDocTag(id: string, tag: string | null, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("kb_documents").update({ tag }).eq("tenant_id", tenantId).eq("id", id);
  if (error) throw error;
}

// URL documents due for a re-crawl across ALL tenants (the cron is a system job):
// never synced, or last synced before the cutoff. Returns [] if the auto-sync
// columns aren't migrated yet (feature simply dormant). Each doc carries tenantId.
export async function listSyncableUrlDocs(olderThanMs: number, max: number): Promise<KbDocument[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await db().from("kb_documents")
    .select("*").eq("source_type", "url")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .order("created_at", { ascending: true }).limit(max);
  if (error) return [];
  return (data ?? []).map(r => mapDocument(r as Record<string, unknown>));
}

// Replace a document's chunks (delete-then-insert) so re-ingest doesn't duplicate.
export async function replaceChunks(documentId: string, chunks: { content: string; embedding: number[] }[], tenantId = DEFAULT_TENANT_ID): Promise<number> {
  await db().from("kb_chunks").delete().eq("tenant_id", tenantId).eq("document_id", documentId);
  if (chunks.length === 0) return 0;
  const rows = chunks.map((c, i) => ({ tenant_id: tenantId, document_id: documentId, chunk_index: i, content: c.content, embedding: c.embedding }));
  // Insert in batches to stay under request-size limits.
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await db().from("kb_chunks").insert(rows.slice(i, i + 100));
    if (error) throw error;
  }
  return rows.length;
}

export async function matchChunks(queryEmbedding: number[], k = 6, tenantId = DEFAULT_TENANT_ID): Promise<{ content: string; documentId: string; similarity: number }[]> {
  const { data, error } = await db().rpc("match_kb_chunks", { query_embedding: queryEmbedding, match_count: k, p_tenant_id: tenantId });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({ content: r.content as string, documentId: r.document_id as string, similarity: r.similarity as number }));
}

// Tenant-scoped vector search restricted to documents with a given tag (a flow's
// primary topic). Returns [] if the 0047 function isn't applied (degrades to global).
export async function matchChunksByTag(queryEmbedding: number[], k: number, tag: string, tenantId = DEFAULT_TENANT_ID): Promise<{ content: string; documentId: string; similarity: number }[]> {
  const { data, error } = await db().rpc("match_kb_chunks_by_tag", { query_embedding: queryEmbedding, match_count: k, p_tenant_id: tenantId, doc_tag: tag });
  if (error) return [];
  return (data ?? []).map((r: Record<string, unknown>) => ({ content: r.content as string, documentId: r.document_id as string, similarity: r.similarity as number }));
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export interface Analytics {
  contacts: { active: number; optedOut: number; new14d: number };
  campaigns: { total: number; automations: number };
  conversations: { total: number; active: number; escalated: number; needsReply: number; botOn: number; whatsapp: number; instagram: number };
  kb: { documents: number; ready: number };
  messaging: { sentToday: number; totals: { sent: number; delivered: number; read: number; failed: number }; replied14d: number; aiReplies14d: number };
  automation: { flows: number; flowsActive: number; sequences: number; sequencesActive: number; activeEnrollments: number };
  recentCampaigns: { name: string; sent: number; total: number; status: string }[];
  daily: { date: string; sent: number; delivered: number; read: number; failed: number }[];
}

async function countWhere(table: string, filters: Record<string, unknown> = {}): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
  const { count } = await q;
  return count ?? 0;
}

export async function getAnalytics(tenantId = DEFAULT_TENANT_ID): Promise<Analytics> {
  const since = new Date(); since.setDate(since.getDate() - 13); since.setHours(0, 0, 0, 0);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const t = { tenant_id: tenantId };

  const [active, optedOut, campaignsTotal, automations, convTotal, convActive, convEscalated, convNeedsReply, kbTotal, kbReady] = await Promise.all([
    countWhere("contacts", { ...t, status: "active" }),
    countWhere("wa_optouts", t),
    countWhere("wa_campaigns", { ...t, auto_send_enabled: false }),
    countWhere("wa_campaigns", { ...t, auto_send_enabled: true }),
    countWhere("wa_conversations", t),
    countWhere("wa_conversations", { ...t, status: "active" }),
    countWhere("wa_conversations", { ...t, status: "escalated" }),
    countWhere("wa_conversations", { ...t, needs_reply: true }),
    countWhere("kb_documents", t),
    countWhere("kb_documents", { ...t, status: "ready" }),
  ]);

  // Last 14 days of send-log rows, aggregated per day in JS (internal-tool scale).
  const ANALYTICS_LIMIT = 20000;
  const { data: logRows } = await db().from("wa_send_log")
    .select("status, sent_at").eq("tenant_id", tenantId).gte("sent_at", since.toISOString())
    .order("sent_at", { ascending: false }).limit(ANALYTICS_LIMIT);
  // Past this cap the 14-day chart under-counts silently — flag the scale cliff
  // (move aggregation into a Postgres function when this starts firing).
  if ((logRows?.length ?? 0) >= ANALYTICS_LIMIT) {
    console.warn(JSON.stringify({ tag: "analytics_truncated", tenantId, limit: ANALYTICS_LIMIT }));
  }

  const byDay = new Map<string, { sent: number; delivered: number; read: number; failed: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since); d.setDate(since.getDate() + i);
    byDay.set(d.toISOString().slice(0, 10), { sent: 0, delivered: 0, read: 0, failed: 0 });
  }
  const totals = { sent: 0, delivered: 0, read: 0, failed: 0 };
  let sentToday = 0;
  for (const r of logRows ?? []) {
    const day = (r.sent_at as string).slice(0, 10);
    const bucket = byDay.get(day);
    const s = r.status as string;
    // read implies delivered implies sent
    const inc = (k: "sent" | "delivered" | "read" | "failed") => { if (bucket) bucket[k]++; totals[k]++; };
    if (s === "read") { inc("sent"); inc("delivered"); inc("read"); }
    else if (s === "delivered") { inc("sent"); inc("delivered"); }
    else if (s === "sent") inc("sent");
    else if (s === "failed") inc("failed");
    if (s !== "failed" && s !== "skipped" && new Date(r.sent_at as string) >= todayStart) sentToday++;
  }

  // Storyline metrics: engagement, conversation health, automation, growth.
  const countSince = async (table: string, eq: Record<string, unknown> = {}): Promise<number> => {
    let q = db().from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("created_at", since.toISOString());
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    const { count } = await q; return count ?? 0;
  };
  const [botOn, igConv, flows, flowsActive, sequences, sequencesActive, activeEnrollments, replied14d, aiReplies14d, new14d] = await Promise.all([
    countWhere("wa_conversations", { ...t, bot_enabled: true }),
    countWhere("wa_conversations", { ...t, platform: "instagram" }),
    countWhere("wa_flows", t),
    countWhere("wa_flows", { ...t, active: true }),
    countWhere("wa_sequences", t),
    countWhere("wa_sequences", { ...t, active: true }),
    countWhere("wa_sequence_enrollments", { ...t, status: "active" }),
    countSince("wa_conv_messages", { role: "user" }),
    countSince("wa_conv_messages", { source: "bot" }),
    countSince("contacts"),
  ]);
  const { data: campRows } = await db().from("wa_campaigns")
    .select("name, template_name, sent_count, total_recipients, status")
    .eq("tenant_id", tenantId).eq("auto_send_enabled", false).order("created_at", { ascending: false }).limit(5);
  const recentCampaigns = (campRows ?? []).map(c => ({
    name: (c.name as string) || (c.template_name as string) || "Campaign",
    sent: (c.sent_count as number) ?? 0, total: (c.total_recipients as number) ?? 0, status: c.status as string,
  }));

  return {
    contacts: { active, optedOut, new14d },
    campaigns: { total: campaignsTotal, automations },
    conversations: { total: convTotal, active: convActive, escalated: convEscalated, needsReply: convNeedsReply, botOn, whatsapp: Math.max(0, convTotal - igConv), instagram: igConv },
    kb: { documents: kbTotal, ready: kbReady },
    messaging: { sentToday, totals, replied14d, aiReplies14d },
    automation: { flows, flowsActive, sequences, sequencesActive, activeEnrollments },
    recentCampaigns,
    daily: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
  };
}

// ── Quick replies (canned responses) ─────────────────────────────────────────
export interface QuickReply { id: string; shortcut: string; body: string; createdAt: string }

export async function listQuickReplies(tenantId = DEFAULT_TENANT_ID): Promise<QuickReply[]> {
  const { data } = await db().from("wa_quick_replies").select("*").eq("tenant_id", tenantId).order("shortcut");
  return (data ?? []).map(r => ({ id: r.id as string, shortcut: r.shortcut as string, body: r.body as string, createdAt: r.created_at as string }));
}

export async function createQuickReply(shortcut: string, body: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_quick_replies").upsert({ tenant_id: tenantId, shortcut: shortcut.trim().toLowerCase(), body: body.trim() }, { onConflict: "tenant_id,shortcut" });
  if (error) throw error;
}

export async function deleteQuickReply(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_quick_replies").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) throw error;
}

// ── Settings (welcome message, working hours, away message) ──────────────────
// Global helpers resolve to the default tenant; they delegate to the tenant
// accessors below so the composite (tenant_id, key) conflict target is used.
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  return getTenantSetting(DEFAULT_TENANT_ID, key, fallback);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  return setTenantSetting(DEFAULT_TENANT_ID, key, value);
}

// ── Tenant-scoped settings + secret vault (SaaS) ─────────────────────────────
// Per-tenant config and secrets. Secrets (Meta access tokens, API keys) are
// encrypted at rest via crypto.ts before they ever reach the DB. The wa_settings
// uniqueness must be (tenant_id, key) — see 0020 constraint migration (pending).
export async function getTenantSetting<T>(tenantId: string, key: string, fallback: T): Promise<T> {
  const { data } = await tdb(tenantId).from("wa_settings").select("value").eq("key", key).maybeSingle();
  return ((data as { value?: T } | null)?.value as T) ?? fallback;
}

export async function setTenantSetting(tenantId: string, key: string, value: unknown): Promise<void> {
  const { error } = await tdb(tenantId)
    .from("wa_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,key" });
  if (error) throw error;
}

// Store an encrypted secret under a settings key. Never persists plaintext.
export async function setTenantSecret(tenantId: string, key: string, plaintext: string): Promise<void> {
  await setTenantSetting(tenantId, key, { enc: encryptSecret(plaintext) });
}

// Read + decrypt a secret. Returns null if unset; tolerates legacy plaintext.
export async function getTenantSecret(tenantId: string, key: string): Promise<string | null> {
  const v = await getTenantSetting<{ enc?: string } | string | null>(tenantId, key, null);
  if (!v) return null;
  if (typeof v === "string") return readSecret(v);          // legacy plaintext
  return v.enc ? readSecret(v.enc) : null;
}

// ── Conversation labels / assignment / welcome tracking ──────────────────────
export async function setConvLabels(id: string, labels: string[]): Promise<void> {
  const clean = [...new Set(labels.map(l => l.trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  const { error } = await db().from("wa_conversations").update({ labels: clean }).eq("id", id);
  if (error) throw error;
}

export async function assignConversation(id: string, assignedTo: string | null): Promise<void> {
  const { error } = await db().from("wa_conversations").update({ assigned_to: assignedTo?.trim() || null }).eq("id", id);
  if (error) throw error;
}

// Pin a conversation to a specific AI agent (null → globally active agent).
export async function setConversationAgent(id: string, agentId: string | null): Promise<void> {
  const { error } = await db().from("wa_conversations").update({ agent_id: agentId }).eq("id", id);
  if (error) throw error;
}

// Scope this conversation's AI knowledge to a flow's primary tag (null = global).
// Best-effort: errors (e.g. column missing pre-0047) are ignored, never thrown.
export async function setConversationKbTag(id: string, tag: string | null): Promise<void> {
  await db().from("wa_conversations").update({ primary_kb_tag: tag }).eq("id", id);
}

// Remembers a real phone the lead shared (mainly Instagram, whose id isn't a
// phone) so the chat can be matched to a CRM lead. No-ops if the column is
// missing (migration 0049 not applied).
export async function setConversationLeadPhone(id: string, phone: string): Promise<void> {
  await db().from("wa_conversations").update({ lead_phone: phone }).eq("id", id).then(undefined, () => undefined);
}

// Atomically claims the welcome send: only the first caller gets true.
export async function claimWelcome(id: string): Promise<boolean> {
  const { data } = await db().from("wa_conversations").update({ welcomed: true }).eq("id", id).eq("welcomed", false).select("id");
  return (data?.length ?? 0) > 0;
}

// ── Campaign funnel + smart retargeting ──────────────────────────────────────
export interface CampaignFunnel {
  total: number;
  sent: number;        // reached Meta but no delivery receipt yet
  delivered: number;   // delivered, not read
  read: number;
  failed: number;
  skipped: number;
}

export type RetargetSegment = "delivered_not_read" | "sent_not_delivered" | "read" | "failed";
const SEGMENT_STATUS: Record<RetargetSegment, string> = {
  delivered_not_read: "delivered", sent_not_delivered: "sent", read: "read", failed: "failed",
};

export async function campaignFunnel(campaignId: string): Promise<CampaignFunnel> {
  const f: CampaignFunnel = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 };
  // status column progresses sent → delivered → read, so each row counts once.
  for (const s of ["sent", "delivered", "read", "failed", "skipped"] as const) {
    const { count } = await db().from("wa_send_log").select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId).eq("status", s);
    f[s] = count ?? 0;
  }
  f.total = f.sent + f.delivered + f.read + f.failed + f.skipped;
  return f;
}

// Recipients for a behavioral retarget — excludes anyone who has opted out since.
export async function retargetRecipients(campaignId: string, segment: RetargetSegment, tenantId = DEFAULT_TENANT_ID): Promise<{ phone: string; fullName: string }[]> {
  const { data, error } = await db().from("wa_send_log").select("phone, recipient_name")
    .eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", SEGMENT_STATUS[segment]).limit(10000);
  if (error) throw error;
  const optedOut = await optoutSet(tenantId);
  const seen = new Set<string>();
  const out: { phone: string; fullName: string }[] = [];
  for (const r of data ?? []) {
    const phone = (r.phone as string) ?? "";
    if (seen.has(phone) || optedOut.has(last10(phone))) continue;
    seen.add(phone);
    out.push({ phone, fullName: (r.recipient_name as string) ?? "" });
  }
  return out;
}
