// GDPR / India DPDP helpers — tenant-scoped export, data-subject access and
// right-to-erasure.
//
//   exportTenantStream  — a tenant admin downloads their workspace's personal
//                         data (contacts, conversations, message bodies, notes,
//                         form answers, opt-outs, orders), paged and streamed.
//   exportContactData   — everything held about ONE person: what a data-subject
//                         access request needs.
//   eraseContact        — remove one person and their personal data (right to
//                         be forgotten). Orders are anonymised, not deleted.
//
// All three are strictly scoped to the caller's tenant.
//
// "The person" is the identifier as the conversation stores it: a phone number
// for WhatsApp, the IGSID / PSID for Instagram / Messenger, `web:<uuid>` for web
// chat, `wa:<handle>` for a WhatsApp @username — or a conversation id, which is
// resolved to whichever of those its conversation carries.

import { db } from "./supabase";
import { tdb } from "./tenantdb";

const digits = (p: string) => (p || "").replace(/\D/g, "");
const uniq = <T,>(a: T[]) => [...new Set(a)];
const chunk = <T,>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A table or column that isn't migrated yet holds nothing of this person's, so
// it is skipped rather than failing the whole request.
const MISSING = new Set(["PGRST205", "42P01", "PGRST106", "PGRST204", "42703"]);
type DbErr = { code?: string; message?: string } | null | undefined;
const isMissing = (e: DbErr) => !!e && MISSING.has(String(e.code ?? ""));

// PostgREST returns at most 1000 rows per request, so everything here pages.
export const PAGE_SIZE = 1000;
// What erasure writes into an anonymised order's phone (the column is NOT NULL).
export const ERASED = "erased";

// ── Who is the person? ────────────────────────────────────────────────────────
export interface Subject { input: string; kind: "phone" | "id"; ids: string[] }

// A phone number is digits and the usual punctuation, 7–15 digits (E.164's
// maximum); it matches both as stored in full and as its last 10 digits, which
// some tables keep. Anything else — an IGSID/PSID (16+ digits), `web:<uuid>`,
// `wa:<handle>` — is an opaque id and matches only exactly, so erasing one
// person's Instagram id can never sweep up a WhatsApp number ending in the
// same ten digits.
export function subjectOf(identifier: string): Subject {
  const raw = (identifier || "").trim();
  const d = digits(raw);
  if (/^\+?[\d\s\-().]+$/.test(raw) && d.length >= 7 && d.length <= 15) {
    return { input: raw, kind: "phone", ids: uniq([d, d.slice(-10)]) };
  }
  return { input: raw, kind: "id", ids: raw ? [raw] : [] };
}

export interface ResolvedSubject {
  subject: Subject;
  convIds: string[];        // this person's conversations in the tenant
  identifiers: string[];    // every identifier they appear under (phone, IGSID, …)
  igNames: string[];        // their Instagram @username, which comment records carry
}

interface ConvRow { id: string; phone: string; platform?: string | null; name?: string | null }

export async function resolveSubject(tenantId: string, identifier: string): Promise<ResolvedSubject> {
  const t = tdb(tenantId);
  let raw = (identifier || "").trim();
  let forceId = false;
  // A conversation id stands for the person in that conversation.
  if (UUID_RE.test(raw)) {
    const { data } = await t.from("wa_conversations").select("phone, platform").eq("id", raw).maybeSingle();
    const row = data as { phone?: string; platform?: string } | null;
    if (row?.phone) { raw = row.phone; forceId = (row.platform ?? "whatsapp") !== "whatsapp"; }
  }
  let subject = forceId ? { input: raw, kind: "id" as const, ids: [raw] } : subjectOf(raw);
  if (!subject.ids.length) throw new Error("An identifier is required");

  const convs: ConvRow[] = [];
  const { data: byPhone } = await t.from("wa_conversations").select("id, phone, platform, name").in("phone", subject.ids);
  convs.push(...((byPhone ?? []) as unknown as ConvRow[]));
  // A numeric id that is stored on an Instagram/Messenger conversation is that
  // platform's id, not a phone number: match it exactly from here on.
  if (subject.kind === "phone" && convs.some(c => c.phone === subject.ids[0] && (c.platform ?? "whatsapp") !== "whatsapp")) {
    subject = { input: subject.input, kind: "id", ids: [subject.ids[0]] };
    convs.splice(0, convs.length, ...convs.filter(c => c.phone === subject.ids[0]));
  }
  // A phone number the person shared inside an Instagram/Messenger chat
  // (lead_phone) ties that conversation to them too.
  if (subject.kind === "phone") {
    const { data, error } = await t.from("wa_conversations").select("id, phone, platform, name").in("lead_phone", subject.ids);
    if (!error) convs.push(...((data ?? []) as unknown as ConvRow[]));
  }
  const unique = [...new Map(convs.map(c => [c.id, c])).values()];
  const igNames = uniq(unique
    .filter(c => c.platform === "instagram" && (c.name ?? "").startsWith("@"))
    .flatMap(c => [c.name as string, (c.name as string).slice(1)]));
  return {
    subject,
    convIds: unique.map(c => c.id),
    identifiers: uniq([...subject.ids, ...unique.map(c => c.phone).filter(Boolean)]),
    igNames,
  };
}

// ── Paging ────────────────────────────────────────────────────────────────────
// Keyset paging (key > last, ordered by key) rather than offsets, so a large
// table costs the same per page from the first page to the last.
// A PostgREST query builder mid-chain. Its real generic type can't follow a
// table name chosen at run time, so the helpers below chain it untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;
interface PageSpec { table: string; cols: string; key: string; filter?: (q: Builder) => Builder }

async function* pages(tenantId: string, spec: PageSpec, pageSize = PAGE_SIZE): AsyncGenerator<Record<string, unknown>[]> {
  const size = Math.min(PAGE_SIZE, Math.max(1, pageSize));
  let cols = spec.cols;
  let last: unknown = null;
  for (;;) {
    let q: Builder = tdb(tenantId).from(spec.table).select(cols);
    if (spec.filter) q = spec.filter(q);
    if (last !== null) q = q.gt(spec.key, last);
    const { data, error } = await q.order(spec.key, { ascending: true }).limit(size);
    if (error) {
      // A column this list names that the database doesn't have yet: take all
      // columns instead. A missing table: nothing to export.
      if ((error.code === "42703" || error.code === "PGRST204") && cols !== "*") { cols = "*"; continue; }
      if (isMissing(error)) return;
      throw new Error(`${spec.table}: ${error.message}`);
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length) yield rows;
    if (rows.length < size) return;
    last = rows[rows.length - 1][spec.key];
    if (last == null) return;
  }
}

export interface TableSummary { rows: number; truncated: boolean }

async function collect(tenantId: string, spec: PageSpec, maxRows: number, pageSize = PAGE_SIZE): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for await (const page of pages(tenantId, spec, pageSize)) {
    for (const r of page) {
      if (rows.length >= maxRows) return { rows, truncated: true };
      rows.push(r);
    }
  }
  return { rows, truncated: false };
}

// ── Workspace export ──────────────────────────────────────────────────────────
// Exactly what the download contains — the Settings copy and the file's own
// "included" list are both built from this, so they can't drift apart.
export const WORKSPACE_EXPORT: (PageSpec & { label: string })[] = [
  { label: "contacts", table: "contacts", key: "id", cols: "id,phone,name,email,tags,attributes,status,source,created_at" },
  { label: "conversations", table: "wa_conversations", key: "id", cols: "id,phone,platform,name,status,lead_phone,handle,last_inbound_at,last_outbound_at,created_at" },
  { label: "messages", table: "wa_conv_messages", key: "id", cols: "id,conversation_id,role,source,body,media_url,media_type,created_at" },
  { label: "notes", table: "wa_conversation_notes", key: "id", cols: "id,conversation_id,author_name,author_email,body,created_at" },
  { label: "form_responses", table: "wa_form_responses", key: "id", cols: "id,conversation_id,phone,form_id,status,data,sent_at,submitted_at" },
  { label: "optouts", table: "wa_optouts", key: "phone", cols: "phone,reason,created_at" },
  { label: "orders", table: "wa_orders", key: "id", cols: "id,phone,items,total_cents,currency,status,paid_at,created_at" },
];

export interface ExportOptions { maxRowsPerTable?: number; deadlineAt?: number; pageSize?: number }

// Streams the export as JSON text, one page at a time, so memory stays at one
// page however large the workspace is. Each table stops at maxRowsPerTable, and
// everything stops at deadlineAt; a table cut short is marked truncated in the
// closing "summary", so a partial file never passes for a complete one.
export async function* exportTenantStream(tenantId: string, opts: ExportOptions = {}): AsyncGenerator<string> {
  const maxRows = opts.maxRowsPerTable ?? 250_000;
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  let tenant: unknown = null;
  try { tenant = (await db().from("tenants").select("id,name,slug,company,owner_email,plan,created_at").eq("id", tenantId).maybeSingle()).data ?? null; }
  catch { /* the export still carries the workspace's data without its header */ }
  yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"tenant":${JSON.stringify(tenant ?? null)},`
    + `"included":${JSON.stringify(WORKSPACE_EXPORT.map(s => s.label))},`
    + `"notIncluded":${JSON.stringify(NOT_IN_EXPORT)},"tables":{`;
  const size = Math.min(PAGE_SIZE, Math.max(1, opts.pageSize ?? PAGE_SIZE));
  const summary: Record<string, TableSummary & { error?: string }> = {};
  let firstTable = true;
  for (const spec of WORKSPACE_EXPORT) {
    yield `${firstTable ? "" : ","}${JSON.stringify(spec.label)}:[`;
    firstTable = false;
    const s: TableSummary & { error?: string } = { rows: 0, truncated: false };
    summary[spec.label] = s;
    // Out of time before this table even started: say so rather than imply it's empty.
    if (Date.now() >= deadlineAt) { s.truncated = true; yield "]"; continue; }
    try {
      for await (const page of pages(tenantId, spec, size)) {
        const take = page.slice(0, Math.max(0, maxRows - s.rows));
        if (take.length) yield (s.rows ? "," : "") + take.map(r => JSON.stringify(r)).join(",");
        s.rows += take.length;
        // More rows than the cap, or out of time with a full page (so maybe more).
        if (take.length < page.length || (Date.now() >= deadlineAt && page.length >= size)) { s.truncated = true; break; }
      }
    } catch (e) { s.error = e instanceof Error ? e.message : String(e); }
    yield "]";
  }
  yield `},"summary":${JSON.stringify(summary)}}`;
}

// What the workspace export leaves out, said out loud in the file itself.
export const NOT_IN_EXPORT = [
  "media files (messages carry their media_url links instead)",
  "AI settings, knowledge base and flows (workspace configuration, not personal data)",
  "send queues and delivery logs",
];

// ── One person's data (data-subject access request) ──────────────────────────
export const CONTACT_EXPORT_MAX_ROWS = 20_000;

export async function exportContactData(tenantId: string, identifier: string, opts: { maxRowsPerTable?: number; pageSize?: number } = {}): Promise<Record<string, unknown>> {
  const who = await resolveSubject(tenantId, identifier);
  const max = opts.maxRowsPerTable ?? CONTACT_EXPORT_MAX_ROWS;
  const ids = who.identifiers, conv = who.convIds;
  const none = ["00000000-0000-0000-0000-000000000000"];   // `in ()` with no values matches nothing
  const convOr = conv.length ? conv : none;
  const specs: Record<string, PageSpec> = {
    contacts: { table: "contacts", key: "id", cols: "*", filter: q => q.in("phone", ids) },
    conversations: { table: "wa_conversations", key: "id", cols: "id,phone,platform,name,status,lead_phone,handle,labels,last_inbound_at,last_outbound_at,created_at", filter: q => q.in("id", convOr) },
    messages: { table: "wa_conv_messages", key: "id", cols: "id,conversation_id,role,source,body,media_url,media_type,created_at", filter: q => q.in("conversation_id", convOr) },
    notes: { table: "wa_conversation_notes", key: "id", cols: "id,conversation_id,author_name,body,created_at", filter: q => q.in("conversation_id", convOr) },
    form_responses: { table: "wa_form_responses", key: "id", cols: "*", filter: q => q.in("phone", ids) },
    optouts: { table: "wa_optouts", key: "phone", cols: "phone,reason,created_at", filter: q => q.in("phone", ids) },
    orders: { table: "wa_orders", key: "id", cols: "id,phone,items,total_cents,currency,status,paid_at,created_at", filter: q => q.in("phone", ids) },
    carts: { table: "wa_carts", key: "id", cols: "id,phone,platform,status,items,created_at,updated_at", filter: q => q.in("phone", ids) },
    messages_sent: { table: "wa_send_log", key: "id", cols: "*", filter: q => q.in("phone", ids) },
    scheduled_messages: { table: "wa_scheduled_sends", key: "id", cols: "*", filter: q => q.in("phone", ids) },
    sequence_enrollments: { table: "wa_sequence_enrollments", key: "id", cols: "*", filter: q => q.in("phone", ids) },
    questions_asked: { table: "wa_router_events", key: "id", cols: "id,event,question,created_at", filter: q => q.in("phone", ids) },
    unanswered_questions: { table: "wa_ai_gaps", key: "id", cols: "id,platform,question,reason,created_at,resolved_at", filter: q => q.in("phone", ids) },
    review_requests: { table: "wa_review_requests", key: "id", cols: "id,order_id,status,sent_at,clicked_at,clicks", filter: q => q.in("phone", ids) },
    link_clicks: { table: "wa_links", key: "id", cols: "id,target_url,clicks,first_clicked_at,created_at", filter: q => q.in("phone", ids) },
    visit_sources: { table: "wa_session_refs", key: "id", cols: "*", filter: q => q.in("matched_wa_id", ids) },
    whatsapp_handoffs: { table: "wa_handoffs", key: "id", cols: "id,platform,source_text,created_at,claimed_at", filter: q => q.in("claimed_phone", ids) },
  };
  // Comment replies are recorded against the commenter's Instagram @username.
  if (who.igNames.length) specs.comment_replies = { table: "wa_comment_replies", key: "id", cols: "id,platform,comment_text,comment_author,reply_text,created_at", filter: q => q.eq("platform", "instagram").in("comment_author", who.igNames) };

  const out: Record<string, unknown> = {};
  const summary: Record<string, TableSummary & { error?: string }> = {};
  for (const [label, spec] of Object.entries(specs)) {
    try {
      const r = await collect(tenantId, spec, max, opts.pageSize);
      out[label] = r.rows;
      summary[label] = { rows: r.rows.length, truncated: r.truncated };
    } catch (e) {
      out[label] = [];
      summary[label] = { rows: 0, truncated: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { exportedAt: new Date().toISOString(), subject: { identifiers: who.identifiers, conversations: who.convIds.length }, summary, ...out };
}

// ── Erasure (right to be forgotten) ───────────────────────────────────────────
export interface EraseResult {
  phone: string;                         // the identifier erased (kept as `phone` for older callers)
  identifiers: string[];
  deleted: Record<string, number>;       // table → rows deleted
  anonymised: Record<string, number>;    // table → rows kept with personal fields blanked
  skipped: string[];                     // tables/columns not in this database yet
  errors: string[];
}

export async function eraseContact(tenantId: string, identifier: string, opts: { exactId?: boolean } = {}): Promise<EraseResult> {
  const who = opts.exactId
    ? await resolveExact(tenantId, identifier)
    : await resolveSubject(tenantId, identifier);
  const r: EraseResult = { phone: who.subject.ids[0] ?? "", identifiers: who.identifiers, deleted: {}, anonymised: {}, skipped: [], errors: [] };
  const raw = tdb(tenantId).raw;
  const ids = who.identifiers;

  const del = async (table: string, col: string, values: string[], extra?: (q: Builder) => Builder) => {
    if (!values.length) return;
    for (const part of chunk(values, 100)) {
      try {
        let q: Builder = raw.from(table).delete({ count: "exact" }).eq("tenant_id", tenantId).in(col, part);
        if (extra) q = extra(q);
        const { count, error } = await q;
        if (error) {
          if (isMissing(error)) { r.skipped.push(`${table}.${col}`); return; }
          r.errors.push(`${table}: ${error.message}`); return;
        }
        r.deleted[table] = (r.deleted[table] ?? 0) + (count ?? 0);
      } catch (e) { r.errors.push(`${table}: ${e instanceof Error ? e.message : e}`); return; }
    }
  };

  // Media the person sent (photos, voice notes, documents) sits in the public
  // bucket under an unguessable name; the message row is its only link to
  // them, so collect the paths before the rows go.
  const mediaPaths = who.convIds.length ? await inboundMediaPaths(tenantId, who.convIds).catch(() => [] as string[]) : [];

  // 1. Everything hanging off their conversations.
  const conv = who.convIds;
  await del("wa_conv_messages", "conversation_id", conv);
  await del("wa_flow_sessions", "conversation_id", conv);
  await del("wa_conversation_notes", "conversation_id", conv);
  await del("wa_form_responses", "conversation_id", conv);
  await del("wa_router_events", "conversation_id", conv);         // on delete SET NULL — would otherwise survive
  await del("wa_grounding_audits", "conversation_id", conv);
  await del("wa_conversation_owner_history", "conversation_id", conv);
  await del("wa_carts", "conversation_id", conv);
  await del("wa_sequence_enrollments", "conversation_id", conv);
  await del("wa_handoffs", "claimed_conversation_id", conv);

  // 2. Everything keyed by the identifier itself (phone, IGSID, PSID, web id).
  for (const t of [
    "contacts", "wa_optouts", "wa_send_queue", "wa_send_log", "wa_scheduled_sends",
    "wa_sequence_enrollments", "wa_carts", "wa_links", "wa_form_responses", "wa_router_events",
    "wa_ai_gaps", "wa_review_requests", "wa_flow_arms", "wa_rule_sends", "wa_otp_codes",
  ]) await del(t, "phone", ids);
  // The CRM buffer keys a phone-less Instagram lead as "handle:<username>".
  await del("wa_crm_session", "phone", uniq([...ids, ...who.igNames.map(n => `handle:${n}`)]));
  await del("wa_handoffs", "claimed_phone", ids);
  await del("wa_session_refs", "matched_wa_id", ids);
  await del("wa_ig_follow_gates", "igsid", ids);
  // Public comment replies and handoffs record an Instagram commenter by
  // @username — unique on Instagram, so it is them. (Facebook and YouTube
  // record a display name, which isn't unique, so those are left alone.)
  await del("wa_comment_replies", "comment_author", who.igNames, q => q.eq("platform", "instagram"));
  await del("wa_handoffs", "source_author", who.igNames, q => q.eq("platform", "instagram"));

  // 3. Orders are ANONYMISED, not deleted. They are the business's sales
  // records: Indian GST law (CGST Act s.36, ~6 years) and the Companies Act
  // (s.128, 8 years of books) require them to be kept. Erasure unlinks the
  // person — the phone is blanked — and keeps the amounts, items and dates.
  for (const part of chunk(ids, 100)) {
    try {
      const { data, error } = await raw.from("wa_orders").update({ phone: ERASED }).eq("tenant_id", tenantId).in("phone", part).select("id");
      if (error) { if (isMissing(error)) r.skipped.push("wa_orders.phone"); else r.errors.push(`wa_orders: ${error.message}`); break; }
      r.anonymised.wa_orders = (r.anonymised.wa_orders ?? 0) + ((data as unknown[] | null)?.length ?? 0);
    } catch (e) { r.errors.push(`wa_orders: ${e instanceof Error ? e.message : e}`); break; }
  }

  // 4. The conversations themselves, last (their children are gone above).
  await del("wa_conversations", "id", conv);
  await del("wa_conversations", "phone", ids);

  // 5. The media files.
  if (mediaPaths.length) {
    const removed = await removeMedia(mediaPaths);
    if (removed.error) r.errors.push(`storage: ${removed.error}`);
    r.deleted["storage:wa-uploads"] = removed.count;
  }
  return r;
}

// Erase by an exact platform id (Meta's deletion callback) — never as a phone.
async function resolveExact(tenantId: string, id: string): Promise<ResolvedSubject> {
  const raw = (id || "").trim();
  if (!raw) throw new Error("An identifier is required");
  const { data } = await tdb(tenantId).from("wa_conversations").select("id, phone, platform, name").eq("phone", raw);
  const convs = (data ?? []) as unknown as ConvRow[];
  const igNames = uniq(convs.filter(c => c.platform === "instagram" && (c.name ?? "").startsWith("@")).flatMap(c => [c.name as string, (c.name as string).slice(1)]));
  return { subject: { input: raw, kind: "id", ids: [raw] }, convIds: convs.map(c => c.id), identifiers: [raw], igNames };
}

const BUCKET = "wa-uploads";
const PUBLIC_PREFIX = `/storage/v1/object/public/${BUCKET}/`;

// Only what the PERSON sent (role 'user'): our outbound media is often a
// shared broadcast attachment that other recipients' messages still link to.
async function inboundMediaPaths(tenantId: string, convIds: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const part of chunk(convIds, 100)) {
    for await (const page of pages(tenantId, { table: "wa_conv_messages", key: "id", cols: "id,media_url", filter: q => q.in("conversation_id", part).eq("role", "user").not("media_url", "is", null) })) {
      for (const m of page) {
        const url = String(m.media_url ?? "");
        const at = url.indexOf(PUBLIC_PREFIX);
        if (at >= 0) paths.push(decodeURIComponent(url.slice(at + PUBLIC_PREFIX.length).split("?")[0]));
      }
    }
  }
  return uniq(paths);
}

async function removeMedia(paths: string[]): Promise<{ count: number; error?: string }> {
  let count = 0;
  try {
    const storage = (db() as unknown as { storage?: { from: (b: string) => { remove: (p: string[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } }).storage;
    if (!storage) return { count };
    for (const part of chunk(paths, 100)) {
      const { data, error } = await storage.from(BUCKET).remove(part);
      if (error) return { count, error: error.message };
      count += data?.length ?? 0;
    }
  } catch (e) { return { count, error: e instanceof Error ? e.message : String(e) }; }
  return { count };
}
