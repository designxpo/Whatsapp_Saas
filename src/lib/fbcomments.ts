// Facebook comment-to-DM rules — ManyChat-style automation (multi-tenant).
//
// Each rule watches Page-post comments (optionally on ONE post, optionally
// keyword-gated) and on a match sends the commenter a single private reply / DM
// (the comment is the opt-in — Meta allows one private reply per comment), with
// a link button and/or a public reply. Mirrors igcomments.ts, minus the
// follow-gate (Facebook Pages have no is_user_follow_business comment flow).
//
// Tenancy: db() uses the service role (RLS bypassed), so EVERY read filters by
// tenant_id and EVERY write stamps it — app-layer scoping is the real guard.

import { db } from "./supabase";
import { normalizeButtons, normalizePublicReplies, matchesKeywords, type RuleButton } from "./igcomments";

export interface FbCommentRule {
  id: string;
  tenantId: string;
  channelId: string | null;
  name: string;
  enabled: boolean;
  postId: string | null;
  postCaption: string | null;
  postPermalink: string | null;
  postThumbnail: string | null;
  keyword: string | null;
  dmMessage: string;
  buttons: RuleButton[];
  buttonLabel: string | null;   // legacy mirror of buttons[0]
  buttonUrl: string | null;     // legacy mirror of buttons[0]
  publicReplies: string[];      // rotating public-reply variants
  publicReply: string | null;   // legacy mirror of publicReplies[0]
  replyOnly: boolean;           // true → public reply only, never DM
  likeComment: boolean;         // like the comment (as the Page) when the rule fires
  matchCount: number;
  createdAt: string;
}

function mapRule(r: Record<string, unknown>): FbCommentRule {
  const legacyUrl = (r.button_url as string | null) ?? null;
  const legacyLabel = (r.button_label as string | null) ?? null;
  let buttons = normalizeButtons(r.buttons);
  if (!buttons.length && legacyUrl) buttons = normalizeButtons([{ label: legacyLabel ?? "", url: legacyUrl }]);
  const legacyReply = (r.public_reply as string | null) ?? null;
  let publicReplies = normalizePublicReplies(r.public_replies);
  if (!publicReplies.length && legacyReply) publicReplies = normalizePublicReplies([legacyReply]);
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    channelId: (r.channel_id as string | null) ?? null,
    name: (r.name as string) ?? "",
    enabled: (r.enabled as boolean) ?? true,
    postId: (r.post_id as string | null) ?? null,
    postCaption: (r.post_caption as string | null) ?? null,
    postPermalink: (r.post_permalink as string | null) ?? null,
    postThumbnail: (r.post_thumbnail as string | null) ?? null,
    keyword: (r.keyword as string | null) ?? null,
    dmMessage: (r.dm_message as string) ?? "",
    buttons,
    buttonLabel: buttons[0]?.label ?? legacyLabel,
    buttonUrl: buttons[0]?.url ?? legacyUrl,
    publicReplies,
    publicReply: publicReplies[0] ?? legacyReply,
    replyOnly: (r.reply_only as boolean) ?? false,
    likeComment: (r.like_comment as boolean) ?? false,
    matchCount: (r.match_count as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export async function listCommentRules(tenantId: string): Promise<FbCommentRule[]> {
  const { data } = await db().from("wa_fb_comment_rules").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  return (data ?? []).map(r => mapRule(r as Record<string, unknown>));
}

export interface CommentRuleInput {
  id?: string;
  channelId?: string | null;
  name?: string;
  enabled?: boolean;
  postId?: string | null;
  postCaption?: string | null;
  postPermalink?: string | null;
  postThumbnail?: string | null;
  keyword?: string | null;
  dmMessage?: string;            // optional when replyOnly
  buttons?: RuleButton[];
  buttonLabel?: string | null;   // legacy single-button input
  buttonUrl?: string | null;
  publicReplies?: string[];
  publicReply?: string | null;   // legacy single-reply input
  replyOnly?: boolean;
  likeComment?: boolean;
}

export async function saveCommentRule(input: CommentRuleInput, tenantId: string): Promise<FbCommentRule> {
  let buttons = normalizeButtons(input.buttons);
  if (!buttons.length && input.buttonUrl) buttons = normalizeButtons([{ label: input.buttonLabel ?? "", url: input.buttonUrl }]);
  let publicReplies = normalizePublicReplies(input.publicReplies);
  if (!publicReplies.length && input.publicReply) publicReplies = normalizePublicReplies([input.publicReply]);
  const replyOnly = !!input.replyOnly;
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    channel_id: input.channelId ?? null,
    name: (input.name ?? "").trim(),
    enabled: input.enabled ?? true,
    post_id: input.postId || null,
    post_caption: input.postCaption ?? null,
    post_permalink: input.postPermalink ?? null,
    post_thumbnail: input.postThumbnail ?? null,
    keyword: input.keyword?.trim() || null,
    dm_message: replyOnly ? "" : (input.dmMessage ?? "").trim(),
    buttons: replyOnly ? [] : buttons,
    button_label: replyOnly ? null : (buttons[0]?.label || null),
    button_url: replyOnly ? null : (buttons[0]?.url || null),
    public_replies: publicReplies,
    public_reply: publicReplies[0] || null,
    reply_only: replyOnly,
    like_comment: !!input.likeComment,
  };
  const runSave = (r: Record<string, unknown>) => (input.id
    ? db().from("wa_fb_comment_rules").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_fb_comment_rules").insert(r).select().single());
  let { data, error } = await runSave(row);
  // Tolerant fallback until migration 0089 lands — strip any not-yet-present
  // column; the legacy columns still persist variant[0].
  const attempt = { ...row };
  for (let i = 0; i < 4 && error && /\b(buttons|public_replies|reply_only|like_comment)\b/i.test(error.message ?? ""); i++) {
    if (/buttons/i.test(error.message ?? "")) delete attempt.buttons;
    if (/public_replies/i.test(error.message ?? "")) delete attempt.public_replies;
    if (/reply_only/i.test(error.message ?? "")) delete attempt.reply_only;
    if (/like_comment/i.test(error.message ?? "")) delete attempt.like_comment;
    ({ data, error } = await runSave(attempt));
  }
  if (error) throw error;
  return mapRule(data as Record<string, unknown>);
}

export async function deleteCommentRule(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from("wa_fb_comment_rules").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

export async function getCommentRule(id: string, tenantId: string): Promise<FbCommentRule | null> {
  const { data } = await db().from("wa_fb_comment_rules").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data ? mapRule(data as Record<string, unknown>) : null;
}

// Find the best rule for an incoming comment within a tenant. Page-bound rules
// win over any-Page; specific-post over all-posts; keyword over catch-all.
// Returns null when nothing matches (anti-spam default).
export async function matchCommentRule(text: string, postId: string | null, tenantId: string, channelId?: string | null): Promise<FbCommentRule | null> {
  const rules = (await listCommentRules(tenantId)).filter(r => r.enabled && (r.replyOnly ? r.publicReplies.length > 0 : !!r.dmMessage));
  const keywordOk = (r: FbCommentRule) => matchesKeywords(text, r.keyword);
  const postOk = (r: FbCommentRule) => !r.postId || r.postId === postId;
  const channelOk = (r: FbCommentRule) => !r.channelId || !channelId || r.channelId === channelId;
  const candidates = rules.filter(r => channelOk(r) && postOk(r) && keywordOk(r));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const ac = a.channelId ? 0 : 1, bc = b.channelId ? 0 : 1;
    if (ac !== bc) return ac - bc;
    const ap = a.postId ? 0 : 1, bp = b.postId ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ak = a.keyword ? 0 : 1, bk = b.keyword ? 0 : 1;
    if (ak !== bk) return ak - bk;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
  return candidates[0];
}

// Idempotency guard: true the first time a comment is seen, false on redeliveries.
export async function claimComment(commentId: string, ruleId: string | null, tenantId: string): Promise<boolean> {
  const { error } = await db().from("wa_fb_comment_log").insert({ comment_id: commentId, rule_id: ruleId, tenant_id: tenantId });
  if (error) return false;
  return true;
}

export async function bumpRuleMatch(id: string, current: number, tenantId: string): Promise<void> {
  await db().from("wa_fb_comment_rules").update({ match_count: current + 1 }).eq("id", id).eq("tenant_id", tenantId).then(() => {}, () => {});
}
