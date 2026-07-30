// YouTube comment-reply rules (Module 1). YouTube has NO DMs, so a rule is
// ALWAYS reply-only: on a keyword match we post ONE public reply under the
// comment (rotating variants to stay natural), and optionally moderate it
// (hold-for-review / reject). Mirrors fbcomments.ts / igcomments.ts and reuses
// the shared keyword + rotating-reply helpers, minus buttons / DM / follow-gate.
//
// Tenancy: db() uses the service role (RLS bypassed), so EVERY read filters by
// tenant_id and EVERY write stamps it — app-layer scoping is the real guard.

import { db } from "./supabase";
import { normalizePublicReplies, matchesKeywords } from "./igcomments";

// What to do with a matched comment beyond replying. YouTube's moderation
// statuses: "heldForReview" (hides pending your approval) / "rejected" (hides).
export type YtModerate = "off" | "hold_spam" | "reject_spam";
export const YT_MODERATE_VALUES: YtModerate[] = ["off", "hold_spam", "reject_spam"];

export interface YtCommentRule {
  id: string;
  tenantId: string;
  channelId: string | null;
  name: string;
  enabled: boolean;
  videoId: string | null;        // null = all videos
  videoTitle: string | null;
  videoThumbnail: string | null;
  keyword: string | null;        // comma-separated trigger words (blank = any)
  publicReplies: string[];       // rotating reply variants
  moderate: YtModerate;
  matchCount: number;
  createdAt: string;
}

function normalizeModerate(v: unknown): YtModerate {
  const s = String(v ?? "off");
  return (YT_MODERATE_VALUES as string[]).includes(s) ? (s as YtModerate) : "off";
}

function mapRule(r: Record<string, unknown>): YtCommentRule {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    channelId: (r.channel_id as string | null) ?? null,
    name: (r.name as string) ?? "",
    enabled: (r.enabled as boolean) ?? true,
    videoId: (r.video_id as string | null) ?? null,
    videoTitle: (r.video_title as string | null) ?? null,
    videoThumbnail: (r.video_thumbnail as string | null) ?? null,
    keyword: (r.keyword as string | null) ?? null,
    publicReplies: normalizePublicReplies(r.public_replies),
    moderate: normalizeModerate(r.moderate),
    matchCount: (r.match_count as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export async function listYtCommentRules(tenantId: string): Promise<YtCommentRule[]> {
  const { data } = await db().from("wa_yt_comment_rules").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapRule(r as Record<string, unknown>));
}

export interface YtCommentRuleInput {
  id?: string;
  channelId?: string | null;
  name?: string;
  enabled?: boolean;
  videoId?: string | null;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  keyword?: string | null;
  publicReplies?: string[];
  moderate?: YtModerate;
}

export async function saveYtCommentRule(input: YtCommentRuleInput, tenantId: string): Promise<YtCommentRule> {
  const publicReplies = normalizePublicReplies(input.publicReplies);
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    channel_id: input.channelId ?? null,
    name: (input.name ?? "").trim(),
    enabled: input.enabled ?? true,
    video_id: input.videoId || null,
    video_title: input.videoTitle ?? null,
    video_thumbnail: input.videoThumbnail ?? null,
    keyword: input.keyword?.trim() || null,
    public_replies: publicReplies,
    moderate: normalizeModerate(input.moderate),
  };
  const runSave = (r: Record<string, unknown>) => (input.id
    ? db().from("wa_yt_comment_rules").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_yt_comment_rules").insert(r).select().single());
  const { data, error } = await runSave(row);
  if (error) throw error;
  return mapRule(data as Record<string, unknown>);
}

export async function deleteYtCommentRule(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from("wa_yt_comment_rules").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

// Find the best rule for an incoming comment within a tenant. Channel-bound rules
// win over any-channel; specific-video over all-videos; keyword over catch-all.
// A rule needs at least one public reply OR a moderation action to be actionable.
// Returns null when nothing matches (anti-spam default).
export async function matchYtCommentRule(text: string, videoId: string | null, tenantId: string, channelId?: string | null): Promise<YtCommentRule | null> {
  const rules = (await listYtCommentRules(tenantId)).filter(r => r.enabled && (r.publicReplies.length > 0 || r.moderate !== "off"));
  const keywordOk = (r: YtCommentRule) => matchesKeywords(text, r.keyword);
  const videoOk = (r: YtCommentRule) => !r.videoId || r.videoId === videoId;
  const channelOk = (r: YtCommentRule) => !r.channelId || !channelId || r.channelId === channelId;
  const candidates = rules.filter(r => channelOk(r) && videoOk(r) && keywordOk(r));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ac = a.channelId ? 0 : 1, bc = b.channelId ? 0 : 1;
    if (ac !== bc) return ac - bc;
    const av = a.videoId ? 0 : 1, bv = b.videoId ? 0 : 1;
    if (av !== bv) return av - bv;
    const ak = a.keyword ? 0 : 1, bk = b.keyword ? 0 : 1;
    if (ak !== bk) return ak - bk;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return candidates[0];
}

// Idempotency guard: true the first time a comment is seen, false on re-polls.
export async function claimYtComment(commentId: string, ruleId: string | null, tenantId: string): Promise<boolean> {
  const { error } = await db().from("wa_yt_comment_log").insert({ comment_id: commentId, rule_id: ruleId, tenant_id: tenantId });
  if (error) return false;
  return true;
}

export async function bumpYtRuleMatch(id: string, current: number, tenantId: string): Promise<void> {
  await db().from("wa_yt_comment_rules").update({ match_count: current + 1 }).eq("id", id).eq("tenant_id", tenantId).then(() => {}, () => {});
}
