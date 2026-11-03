// Review reply system — store business reviews + their AI-drafted / posted
// replies, plus per-tenant reply settings. Phase 1 is source-agnostic (reviews
// are added manually / pasted); Phase 2 will import from Google Business Profile.
//
// Tenancy: db() uses the service role (RLS bypassed), so EVERY read filters by
// tenant_id and EVERY write stamps it — app-layer scoping is the real guard.

import { db } from "./supabase";
import { getTenantSetting, setTenantSetting } from "./store";
import { tdb } from "./tenantdb";
import { DEFAULT_HOLD_FOR, normalizeHoldFor, type HoldFor } from "./review-policy";

export type ReviewSource = "manual" | "google";
export type ReplyStatus = "none" | "draft" | "posted";
/** Who wrote the public reply: Talko (AI or a teammate in Talko), someone directly on Google, or a manual review's "Mark posted". */
export type ReplySource = "talko" | "google" | "manual";

export interface Review {
  id: string;
  tenantId: string;
  source: ReviewSource;
  externalId: string | null;
  channelId: string | null;     // the connected Google location (null for manual reviews)
  locationName: string | null;
  author: string;
  rating: number;               // 1..5; 0 = Google didn't give one
  text: string;
  reviewCreatedAt: string | null;
  reviewUpdatedAt: string | null;
  replyText: string | null;
  replyStatus: ReplyStatus;
  replySource: ReplySource | null;
  auto: boolean;
  postedAt: string | null;
  /** Why the reply waits for a person (empty when nothing held it). */
  approvalReasons: string[];
  topics: string[];
  isComplaint: boolean;
  postError: string | null;
  postFailedAt: string | null;
  draftError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AlertKind = "new_review" | "needs_approval" | "complaint" | "post_failed" | "reauth" | "sync_failing" | "overdue";
export const ALERT_KINDS: AlertKind[] = ["new_review", "needs_approval", "complaint", "post_failed", "reauth", "sync_failing", "overdue"];

export interface AlertSettings {
  /** Email these alerts as well as showing them in the bell. */
  email: boolean;
  /** Who gets the emails; empty = every admin of the workspace. */
  recipients: string[];
  events: Record<AlertKind, boolean>;
  /** A review still without a public reply after this long raises "overdue". */
  unansweredHours: number;
}

export interface ReviewSettings {
  autoMinStars: number;        // ratings >= this auto-post; NEVER_AUTO_POST (6) means every reply waits for approval
  signature: string;           // appended to replies, e.g. "— Team Talko"
  tone: string;                // freeform tone/brand guidance for the AI
  /** Topics that hold an AI reply for approval whatever the rating. */
  holdFor: HoldFor;
  alerts: AlertSettings;
}

export const DEFAULT_ALERTS: AlertSettings = {
  email: true, recipients: [],
  events: { new_review: true, needs_approval: true, complaint: true, post_failed: true, reauth: true, sync_failing: true, overdue: true },
  unansweredHours: 48,
};
const DEFAULT_SETTINGS: ReviewSettings = { autoMinStars: 4, signature: "", tone: "", holdFor: DEFAULT_HOLD_FOR, alerts: DEFAULT_ALERTS };

function clampRating(n: unknown, fallback = 5): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(5, Math.max(0, v)) : fallback;
}

// The auto-post threshold has one more value than a rating: 6 is the settings
// screen's "Never auto-post". Clamping it like a rating turned that opt-out
// into "5★ only", so five-star reviews still got public AI replies.
export const NEVER_AUTO_POST = 6;
function clampThreshold(n: unknown, fallback: number): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(NEVER_AUTO_POST, Math.max(1, v)) : fallback;
}

/** Whether a reply to this rating may be posted publicly without a person approving it. */
export function autoPosts(rating: number, settings: Pick<ReviewSettings, "autoMinStars">): boolean {
  return settings.autoMinStars < NEVER_AUTO_POST && rating > 0 && rating >= settings.autoMinStars;
}

const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function mapReview(r: Record<string, unknown>): Review {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    source: ((r.source as ReviewSource) ?? "manual"),
    externalId: (r.external_id as string | null) ?? null,
    channelId: (r.channel_id as string | null) ?? null,
    locationName: (r.location_name as string | null) ?? null,
    author: (r.author as string) ?? "",
    rating: clampRating(r.rating),
    text: (r.text as string) ?? "",
    reviewCreatedAt: (r.review_created_at as string | null) ?? null,
    reviewUpdatedAt: (r.review_updated_at as string | null) ?? null,
    replyText: (r.reply_text as string | null) ?? null,
    replyStatus: ((r.reply_status as ReplyStatus) ?? "none"),
    replySource: (r.reply_source as ReplySource | null) ?? null,
    auto: (r.auto as boolean) ?? false,
    postedAt: (r.posted_at as string | null) ?? null,
    approvalReasons: strArr(r.approval_reasons),
    topics: strArr(r.topics),
    isComplaint: (r.is_complaint as boolean) ?? false,
    postError: (r.post_error as string | null) ?? null,
    postFailedAt: (r.post_failed_at as string | null) ?? null,
    draftError: (r.draft_error as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? (r.created_at as string),
  };
}

// Columns added by 20261104120000_reviews_inbox_alerts.sql. Until it is
// applied, writes drop them and retry, so imports and replies keep working.
const STAGE1_COLS = ["channel_id", "review_updated_at", "approval_reasons", "topics", "is_complaint", "reply_source", "post_error", "post_failed_at", "draft_error", "draft_claimed_at"];
const missingColumn = (e: { code?: string } | null | undefined) => !!e && (e.code === "42703" || e.code === "PGRST204");
function legacyRow(row: Record<string, unknown>) {
  const out = { ...row };
  for (const c of STAGE1_COLS) delete out[c];
  return out;
}

export async function listReviews(tenantId: string): Promise<Review[]> {
  const { data } = await db().from("wa_reviews").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1000);
  // Newest written first. A bulk import saves old reviews in one go, so import
  // order would put a three-year-old review above last week's.
  const when = (r: Review) => Date.parse(r.reviewCreatedAt ?? r.createdAt) || 0;
  return (data ?? []).map(r => mapReview(r as Record<string, unknown>)).sort((a, b) => when(b) - when(a));
}

// ── The review inbox ─────────────────────────────────────────────────────────
export type ReviewView = "all" | "approval" | "unanswered" | "complaints" | "replied" | "failed";
export const REVIEW_VIEWS: ReviewView[] = ["all", "approval", "unanswered", "complaints", "replied", "failed"];

export interface ReviewQuery {
  view?: ReviewView;
  /** A connected location's channel id, or "manual" for pasted reviews. */
  location?: string | null;
  rating?: number | null;
  status?: ReplyStatus | null;
  from?: string | null;           // ISO date, inclusive
  to?: string | null;             // ISO date, inclusive (whole day)
  q?: string | null;
  sort?: "newest" | "oldest_unanswered";
  /** A team member's visible locations (null = everything). Manual reviews belong to no location. */
  channelIds?: string[] | null;
  page?: number;
  pageSize?: number;
}

/** Search text safe to put inside a PostgREST or() filter. Pure. */
export function searchTerm(q: string | null | undefined): string {
  return (q ?? "").replace(/[,()"\\%*:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

// The PostgREST builder's generic type changes with every filter; this
// function only chains filters, so it works on the untyped builder.
type Builder = any;
function applyFilters(qb: Builder, tenantId: string, f: ReviewQuery, view: ReviewView): Builder {
  let b = qb.eq("tenant_id", tenantId);
  if (f.channelIds) b = b.in("channel_id", f.channelIds.length ? f.channelIds : ["00000000-0000-0000-0000-000000000000"]);
  if (f.location === "manual") b = b.eq("source", "manual");
  else if (f.location) b = b.eq("channel_id", f.location);
  if (f.rating) b = b.eq("rating", f.rating);
  if (f.status) b = b.eq("reply_status", f.status);
  if (f.from) b = b.gte("review_created_at", f.from);
  if (f.to) b = b.lte("review_created_at", f.to.length <= 10 ? `${f.to}T23:59:59.999Z` : f.to);
  const term = searchTerm(f.q);
  if (term) b = b.or(`text.ilike.%${term}%,author.ilike.%${term}%`);
  if (view === "approval") b = b.eq("reply_status", "draft");
  else if (view === "unanswered") b = b.neq("reply_status", "posted");
  else if (view === "complaints") b = b.eq("is_complaint", true);
  else if (view === "replied") b = b.eq("reply_status", "posted");
  else if (view === "failed") b = b.not("post_error", "is", null).neq("reply_status", "posted");
  if (f.sort === "oldest_unanswered" && view !== "unanswered") b = b.neq("reply_status", "posted");
  return b;
}

export interface ReviewPage {
  reviews: Review[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ReviewView, number>;
  /** The newer inbox columns aren't in the database yet; some views are empty. */
  setupPending: boolean;
}

export async function queryReviews(tenantId: string, f: ReviewQuery): Promise<ReviewPage> {
  const view = REVIEW_VIEWS.includes(f.view as ReviewView) ? (f.view as ReviewView) : "all";
  const pageSize = Math.min(100, Math.max(5, Math.round(f.pageSize ?? 25)));
  const page = Math.max(1, Math.round(f.page ?? 1));
  const asc = f.sort === "oldest_unanswered";
  let setupPending = false;

  const list = await applyFilters(db().from("wa_reviews").select("*", { count: "exact" }), tenantId, f, view)
    .order("review_created_at", { ascending: asc }).order("created_at", { ascending: asc })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (list.error) {
    if (!missingColumn(list.error)) throw new Error(list.error.message);
    setupPending = true;
  }
  const countsEntries = await Promise.all(REVIEW_VIEWS.map(async v => {
    const r = await applyFilters(db().from("wa_reviews").select("id", { count: "exact", head: true }), tenantId, { ...f, sort: "newest" }, v);
    if (r.error && missingColumn(r.error)) setupPending = true;
    return [v, r.error ? 0 : (r.count ?? 0)] as const;
  }));
  return {
    reviews: ((list.data ?? []) as Record<string, unknown>[]).map(mapReview),
    total: list.error ? 0 : (list.count ?? 0),
    page, pageSize,
    counts: Object.fromEntries(countsEntries) as Record<ReviewView, number>,
    setupPending,
  };
}

export async function getReview(id: string, tenantId: string): Promise<Review | null> {
  const { data } = await db().from("wa_reviews").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data ? mapReview(data as Record<string, unknown>) : null;
}

// Direct lookup (not the capped list) — the poller's idempotency check:
// has this external review already been imported for this tenant?
export async function getReviewByExternalId(tenantId: string, source: ReviewSource, externalId: string): Promise<Review | null> {
  const { data } = await db().from("wa_reviews").select("*").eq("tenant_id", tenantId).eq("source", source).eq("external_id", externalId).maybeSingle();
  return data ? mapReview(data as Record<string, unknown>) : null;
}

export interface ReviewInput {
  id?: string;
  source?: ReviewSource;
  externalId?: string | null;
  channelId?: string | null;
  locationName?: string | null;
  author?: string;
  rating?: number;
  text?: string;
  reviewCreatedAt?: string | null;
  reviewUpdatedAt?: string | null;
}

export async function saveReview(input: ReviewInput, tenantId: string): Promise<Review> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    source: input.source ?? "manual",
    external_id: input.externalId ?? null,
    location_name: input.locationName?.trim() || null,
    author: (input.author ?? "").trim().slice(0, 120),
    rating: clampRating(input.rating),
    text: (input.text ?? "").trim().slice(0, 4000),
    // A pasted review has no Google date; "when it reached Talko" keeps the inbox sortable.
    review_created_at: input.reviewCreatedAt ?? (input.id ? undefined : now),
    updated_at: now,
  };
  if (row.review_created_at === undefined) delete row.review_created_at;
  if (input.channelId !== undefined) row.channel_id = input.channelId;
  if (input.reviewUpdatedAt !== undefined) row.review_updated_at = input.reviewUpdatedAt;
  // A low rating is a complaint until the stage-1 classifier says more.
  if (!input.id) row.is_complaint = (row.rating as number) > 0 && (row.rating as number) <= 2;
  const run = (r: Record<string, unknown>) => (input.id
    ? db().from("wa_reviews").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_reviews").insert(r).select().single());
  let { data, error } = await run(row);
  if (missingColumn(error)) ({ data, error } = await run(legacyRow(row)));
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return mapReview(data as Record<string, unknown>);
}

/** Fields a reply update may set. Only what's given changes. */
export interface ReplyPatch {
  approvalReasons?: string[];
  topics?: string[];
  isComplaint?: boolean;
  replySource?: ReplySource | null;
  postError?: string | null;
  draftError?: string | null;
}

// Save/replace a review's reply. `status` reflects where it is in the flow;
// `auto` records whether this reply was meant to post without a person.
export async function setReviewReply(id: string, tenantId: string, replyText: string, status: ReplyStatus, auto: boolean, patch: ReplyPatch = {}): Promise<Review> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    reply_text: replyText.trim() || null,
    reply_status: status,
    auto,
    posted_at: status === "posted" ? now : null,
    updated_at: now,
  };
  if (patch.approvalReasons !== undefined) row.approval_reasons = patch.approvalReasons;
  if (patch.topics !== undefined) row.topics = patch.topics;
  if (patch.isComplaint !== undefined) row.is_complaint = patch.isComplaint;
  if (patch.replySource !== undefined) row.reply_source = patch.replySource;
  else if (status !== "posted") row.reply_source = null;
  if (patch.draftError !== undefined) row.draft_error = patch.draftError;
  if (patch.postError !== undefined) {
    row.post_error = patch.postError;
    row.post_failed_at = patch.postError ? now : null;
  } else if (status === "posted") { row.post_error = null; row.post_failed_at = null; }
  if (status === "posted") row.approval_reasons = [];
  const run = (r: Record<string, unknown>) => db().from("wa_reviews").update(r).eq("id", id).eq("tenant_id", tenantId).select().single();
  let { data, error } = await run(row);
  if (missingColumn(error)) ({ data, error } = await run(legacyRow(row)));
  if (error) throw error;
  return mapReview(data as Record<string, unknown>);
}

/** Record a failed post to Google without touching the reply text. */
export async function markPostFailed(id: string, tenantId: string, error: string): Promise<void> {
  const { error: e } = await db().from("wa_reviews")
    .update({ post_error: error.slice(0, 300), post_failed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).eq("tenant_id", tenantId);
  if (e && !missingColumn(e)) throw e;
}

/**
 * Claim a review for AI drafting, so two background runs never draft (and
 * post) the same reply at once. True only for the caller that won. A claim
 * older than five minutes is treated as abandoned.
 */
export async function claimDraft(id: string, tenantId: string, now = Date.now()): Promise<boolean> {
  const stale = new Date(now - 5 * 60_000).toISOString();
  const at = new Date(now).toISOString();
  const free = await db().from("wa_reviews").update({ draft_claimed_at: at }).eq("id", id).eq("tenant_id", tenantId).is("draft_claimed_at", null).select("id");
  if (missingColumn(free.error)) return true;   // pre-migration: no claim column, behave as before
  if ((free.data ?? []).length) return true;
  const old = await db().from("wa_reviews").update({ draft_claimed_at: at }).eq("id", id).eq("tenant_id", tenantId).lt("draft_claimed_at", stale).select("id");
  return (old.data ?? []).length > 0;
}

export async function releaseDraft(id: string, tenantId: string): Promise<void> {
  await db().from("wa_reviews").update({ draft_claimed_at: null }).eq("id", id).eq("tenant_id", tenantId).then(() => undefined, () => undefined);
}

export async function deleteReview(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from("wa_reviews").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

// ── Settings (one small wa_settings row, JSON-encoded) ────────────────────────
const SETTINGS_KEY = "review_settings";

function normalizeAlerts(v: unknown): AlertSettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<AlertSettings>;
  const ev = (o.events && typeof o.events === "object" ? o.events : {}) as Partial<Record<AlertKind, unknown>>;
  const hours = Math.round(Number(o.unansweredHours));
  return {
    email: typeof o.email === "boolean" ? o.email : DEFAULT_ALERTS.email,
    recipients: strArr(o.recipients).map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 10),
    events: Object.fromEntries(ALERT_KINDS.map(k => [k, typeof ev[k] === "boolean" ? ev[k] : true])) as Record<AlertKind, boolean>,
    unansweredHours: Number.isFinite(hours) ? Math.min(24 * 14, Math.max(1, hours)) : DEFAULT_ALERTS.unansweredHours,
  };
}

export async function getReviewSettings(tenantId: string): Promise<ReviewSettings> {
  const raw = await getTenantSetting(tenantId, SETTINGS_KEY, "").catch(() => "");
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const p = (typeof raw === "string" ? JSON.parse(raw) : raw) as Partial<ReviewSettings>;
    return {
      autoMinStars: clampThreshold(p.autoMinStars, DEFAULT_SETTINGS.autoMinStars),
      signature: (p.signature ?? "").toString().slice(0, 120),
      tone: (p.tone ?? "").toString().slice(0, 600),
      holdFor: normalizeHoldFor(p.holdFor),
      alerts: normalizeAlerts(p.alerts),
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export async function setReviewSettings(tenantId: string, input: Partial<ReviewSettings>): Promise<ReviewSettings> {
  const current = await getReviewSettings(tenantId);
  const next: ReviewSettings = {
    autoMinStars: input.autoMinStars !== undefined ? clampThreshold(input.autoMinStars, current.autoMinStars) : current.autoMinStars,
    signature: input.signature !== undefined ? String(input.signature).slice(0, 120) : current.signature,
    tone: input.tone !== undefined ? String(input.tone).slice(0, 600) : current.tone,
    holdFor: input.holdFor !== undefined ? normalizeHoldFor({ ...current.holdFor, ...input.holdFor }) : current.holdFor,
    alerts: input.alerts !== undefined ? normalizeAlerts({ ...current.alerts, ...input.alerts, events: { ...current.alerts.events, ...(input.alerts.events ?? {}) } }) : current.alerts,
  };
  await setTenantSetting(tenantId, SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ── Google sync status, one wa_settings row per connected location ───────────
// The poller writes each location's progress and last result here, so the
// Reviews tab can say "Google refused access — reconnect" instead of showing an
// empty list that looks exactly like a business with no reviews, and so a long
// review history is imported over several runs without starting again.
const SYNC_PREFIX = "google_reviews_sync:";
const LEGACY_SYNC_KEY = "google_reviews_sync";

export interface GoogleSyncStatus {
  ok: boolean;
  error: string | null;
  /** reauth | permission | rate_limit | transient | plan | other */
  kind: string | null;
  at: string;                         // last attempt
  lastSuccessAt: string | null;
  failures: number;                   // consecutive failed runs
  /** Newest Google "updated" time already processed — later runs stop there. */
  highWater: string | null;
  /** Where the import of older reviews continues; null once it has finished. */
  backfillToken: string | null;
  backfillDone: boolean;
  /** Google's own figures for the location (not Talko's imported count). */
  averageRating: number | null;
  totalReviewCount: number | null;
  ratingAt: string | null;
  mapsUri: string | null;
  reviewUri: string | null;
  linksAt: string | null;
}

export const EMPTY_SYNC: Omit<GoogleSyncStatus, "at"> = {
  ok: true, error: null, kind: null, lastSuccessAt: null, failures: 0, highWater: null,
  backfillToken: null, backfillDone: false, averageRating: null, totalReviewCount: null,
  ratingAt: null, mapsUri: null, reviewUri: null, linksAt: null,
};

function normalizeSync(v: unknown): GoogleSyncStatus | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<GoogleSyncStatus>;
  return { ...EMPTY_SYNC, ...o, at: o.at ?? new Date(0).toISOString(), lastSuccessAt: o.lastSuccessAt ?? (o.ok ? o.at ?? null : null), failures: Number(o.failures) || 0 } as GoogleSyncStatus;
}

export async function getGoogleSyncStatus(tenantId: string): Promise<Record<string, GoogleSyncStatus>> {
  const out: Record<string, GoogleSyncStatus> = {};
  const legacy = await getTenantSetting<Record<string, unknown> | null>(tenantId, LEGACY_SYNC_KEY, null).catch(() => null);
  if (legacy && typeof legacy === "object") for (const [id, v] of Object.entries(legacy)) { const n = normalizeSync(v); if (n) out[id] = n; }
  const { data } = await tdb(tenantId).from("wa_settings").select("key,value").like("key", `${SYNC_PREFIX}%`);
  for (const row of (data ?? []) as unknown as { key: string; value: unknown }[]) {
    const n = normalizeSync(row.value);
    if (n) out[row.key.slice(SYNC_PREFIX.length)] = n;
  }
  return out;
}

export async function getChannelSync(tenantId: string, channelId: string): Promise<GoogleSyncStatus> {
  const v = await getTenantSetting<unknown>(tenantId, SYNC_PREFIX + channelId, null).catch(() => null);
  return normalizeSync(v) ?? (await getGoogleSyncStatus(tenantId))[channelId] ?? { ...EMPTY_SYNC, at: new Date(0).toISOString() };
}

export async function saveChannelSync(tenantId: string, channelId: string, s: GoogleSyncStatus): Promise<void> {
  await setTenantSetting(tenantId, SYNC_PREFIX + channelId, { ...s, error: s.error ? s.error.slice(0, 300) : null })
    .catch(e => console.error("[reviews] sync status", tenantId, e));
}

/** Record one run's outcome for a location (error null = it worked). */
export async function recordGoogleSync(tenantId: string, channelId: string, error: string | null, at = new Date().toISOString(), kind: string | null = null): Promise<GoogleSyncStatus> {
  const cur = await getChannelSync(tenantId, channelId);
  const next: GoogleSyncStatus = error
    ? { ...cur, ok: false, error, kind: kind ?? "other", at, failures: cur.failures + 1 }
    : { ...cur, ok: true, error: null, kind: null, at, lastSuccessAt: at, failures: 0 };
  await saveChannelSync(tenantId, channelId, next);
  return next;
}
