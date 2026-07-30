// Review reply system — store business reviews + their AI-drafted / posted
// replies, plus per-tenant reply settings. Phase 1 is source-agnostic (reviews
// are added manually / pasted); Phase 2 will import from Google Business Profile.
//
// Tenancy: db() uses the service role (RLS bypassed), so EVERY read filters by
// tenant_id and EVERY write stamps it — app-layer scoping is the real guard.

import { db } from "./supabase";
import { getTenantSetting, setTenantSetting } from "./store";

export type ReviewSource = "manual" | "google";
export type ReplyStatus = "none" | "draft" | "posted";

export interface Review {
  id: string;
  tenantId: string;
  source: ReviewSource;
  externalId: string | null;
  locationName: string | null;
  author: string;
  rating: number;              // 1..5
  text: string;
  reviewCreatedAt: string | null;
  replyText: string | null;
  replyStatus: ReplyStatus;
  auto: boolean;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSettings {
  autoMinStars: number;        // reviews with rating >= this are meant to auto-post (phase 2)
  signature: string;           // appended to replies, e.g. "— Team Talko"
  tone: string;                // freeform tone/brand guidance for the AI
}

const DEFAULT_SETTINGS: ReviewSettings = { autoMinStars: 4, signature: "", tone: "" };

function clampStars(n: unknown, fallback = 5): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : fallback;
}

function mapReview(r: Record<string, unknown>): Review {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    source: ((r.source as ReviewSource) ?? "manual"),
    externalId: (r.external_id as string | null) ?? null,
    locationName: (r.location_name as string | null) ?? null,
    author: (r.author as string) ?? "",
    rating: clampStars(r.rating),
    text: (r.text as string) ?? "",
    reviewCreatedAt: (r.review_created_at as string | null) ?? null,
    replyText: (r.reply_text as string | null) ?? null,
    replyStatus: ((r.reply_status as ReplyStatus) ?? "none"),
    auto: (r.auto as boolean) ?? false,
    postedAt: (r.posted_at as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: (r.updated_at as string) ?? (r.created_at as string),
  };
}

export async function listReviews(tenantId: string): Promise<Review[]> {
  const { data } = await db().from("wa_reviews").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(500);
  return (data ?? []).map(r => mapReview(r as Record<string, unknown>));
}

export async function getReview(id: string, tenantId: string): Promise<Review | null> {
  const { data } = await db().from("wa_reviews").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data ? mapReview(data as Record<string, unknown>) : null;
}

// Direct lookup (not the capped 500-row list) — the poller's idempotency check:
// has this external review already been imported for this tenant?
export async function getReviewByExternalId(tenantId: string, source: ReviewSource, externalId: string): Promise<Review | null> {
  const { data } = await db().from("wa_reviews").select("*").eq("tenant_id", tenantId).eq("source", source).eq("external_id", externalId).maybeSingle();
  return data ? mapReview(data as Record<string, unknown>) : null;
}

export interface ReviewInput {
  id?: string;
  source?: ReviewSource;
  externalId?: string | null;
  locationName?: string | null;
  author?: string;
  rating?: number;
  text?: string;
  reviewCreatedAt?: string | null;
}

export async function saveReview(input: ReviewInput, tenantId: string): Promise<Review> {
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    source: input.source ?? "manual",
    external_id: input.externalId ?? null,
    location_name: input.locationName?.trim() || null,
    author: (input.author ?? "").trim().slice(0, 120),
    rating: clampStars(input.rating),
    text: (input.text ?? "").trim().slice(0, 4000),
    review_created_at: input.reviewCreatedAt ?? null,
    updated_at: new Date().toISOString(),
  };
  const q = input.id
    ? db().from("wa_reviews").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_reviews").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapReview(data as Record<string, unknown>);
}

// Save/replace a review's reply. `status` reflects where it is in the flow;
// `auto` records whether this rating is meant to auto-post (phase-2 signal).
export async function setReviewReply(id: string, tenantId: string, replyText: string, status: ReplyStatus, auto: boolean): Promise<Review> {
  const row: Record<string, unknown> = {
    reply_text: replyText.trim() || null,
    reply_status: status,
    auto,
    posted_at: status === "posted" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db().from("wa_reviews").update(row).eq("id", id).eq("tenant_id", tenantId).select().single();
  if (error) throw error;
  return mapReview(data as Record<string, unknown>);
}

export async function deleteReview(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from("wa_reviews").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

// ── Settings (one small wa_settings row, JSON-encoded) ────────────────────────
const SETTINGS_KEY = "review_settings";

export async function getReviewSettings(tenantId: string): Promise<ReviewSettings> {
  const raw = await getTenantSetting(tenantId, SETTINGS_KEY, "").catch(() => "");
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const p = JSON.parse(raw) as Partial<ReviewSettings>;
    return {
      autoMinStars: clampStars(p.autoMinStars, DEFAULT_SETTINGS.autoMinStars),
      signature: (p.signature ?? "").toString().slice(0, 120),
      tone: (p.tone ?? "").toString().slice(0, 600),
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export async function setReviewSettings(tenantId: string, input: Partial<ReviewSettings>): Promise<ReviewSettings> {
  const current = await getReviewSettings(tenantId);
  const next: ReviewSettings = {
    autoMinStars: input.autoMinStars !== undefined ? clampStars(input.autoMinStars, current.autoMinStars) : current.autoMinStars,
    signature: input.signature !== undefined ? String(input.signature).slice(0, 120) : current.signature,
    tone: input.tone !== undefined ? String(input.tone).slice(0, 600) : current.tone,
  };
  await setTenantSetting(tenantId, SETTINGS_KEY, JSON.stringify(next));
  return next;
}
