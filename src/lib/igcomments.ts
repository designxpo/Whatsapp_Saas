// Instagram comment-to-DM rules — ManyChat-style automation (multi-tenant).
//
// Each rule watches comments (optionally on ONE post, optionally keyword-gated)
// and on a match sends the commenter a single private DM (the comment is the
// opt-in — Meta allows one private reply per comment), optionally behind a
// follow gate, with a link button and/or a public reply.
//
// Tenancy: db() uses the service role (RLS bypassed), so EVERY read filters by
// tenant_id and EVERY write stamps it — app-layer scoping is the real guard.

import { db } from "./supabase";

// A link button on the DM. Meta's button template caps at 3 per message.
export interface RuleButton {
  label: string;
  url: string;
}
export const MAX_RULE_BUTTONS = 3;

// Coerce raw jsonb / legacy fields into a clean, capped button list.
export function normalizeButtons(raw: unknown): RuleButton[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map(b => {
      const o = (b ?? {}) as Record<string, unknown>;
      return { label: String(o.label ?? "").trim().slice(0, 20), url: String(o.url ?? "").trim() };
    })
    .filter(b => /^https?:\/\//i.test(b.url))
    .slice(0, MAX_RULE_BUTTONS);
}

export interface IgCommentRule {
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
  buttonLabel: string | null;   // legacy mirror of buttons[0] — kept for old readers
  buttonUrl: string | null;     // legacy mirror of buttons[0]
  publicReply: string | null;
  requireFollow: boolean;
  followPrompt: string | null;
  matchCount: number;
  createdAt: string;
}

function mapRule(r: Record<string, unknown>): IgCommentRule {
  // Prefer the jsonb `buttons` array; fall back to the legacy single button so
  // rules created before migration 0086 still surface their button.
  const legacyUrl = (r.button_url as string | null) ?? null;
  const legacyLabel = (r.button_label as string | null) ?? null;
  let buttons = normalizeButtons(r.buttons);
  if (!buttons.length && legacyUrl) buttons = normalizeButtons([{ label: legacyLabel ?? "", url: legacyUrl }]);
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
    publicReply: (r.public_reply as string | null) ?? null,
    requireFollow: (r.require_follow as boolean) ?? false,
    followPrompt: (r.follow_prompt as string | null) ?? null,
    matchCount: (r.match_count as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export async function listCommentRules(tenantId: string): Promise<IgCommentRule[]> {
  const { data } = await db().from("wa_ig_comment_rules").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
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
  dmMessage: string;
  buttons?: RuleButton[];
  buttonLabel?: string | null;   // legacy single-button input (still accepted)
  buttonUrl?: string | null;
  publicReply?: string | null;
  requireFollow?: boolean;
  followPrompt?: string | null;
}

export async function saveCommentRule(input: CommentRuleInput, tenantId: string): Promise<IgCommentRule> {
  // Accept either the new `buttons` array or the legacy single button; the
  // legacy columns always mirror buttons[0] so old readers keep working.
  let buttons = normalizeButtons(input.buttons);
  if (!buttons.length && input.buttonUrl) buttons = normalizeButtons([{ label: input.buttonLabel ?? "", url: input.buttonUrl }]);
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
    dm_message: input.dmMessage.trim(),
    buttons,
    button_label: buttons[0]?.label || null,
    button_url: buttons[0]?.url || null,
    public_reply: input.publicReply?.trim() || null,
    require_follow: input.requireFollow ?? false,
    follow_prompt: input.followPrompt?.trim() || null,
  };
  const runSave = (r: Record<string, unknown>) => (input.id
    ? db().from("wa_ig_comment_rules").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_ig_comment_rules").insert(r).select().single());
  let { data, error } = await runSave(row);
  // Tolerant fallback: if migration 0086 (the `buttons` column) isn't applied
  // yet, retry without it — the legacy button_label/button_url still persist
  // buttons[0], so single-button rules keep working until the migration lands.
  if (error && /buttons/i.test(error.message ?? "") && "buttons" in row) {
    const rest = { ...row }; delete rest.buttons;
    ({ data, error } = await runSave(rest));
  }
  if (error) throw error;
  return mapRule(data as Record<string, unknown>);
}

export async function deleteCommentRule(id: string, tenantId: string): Promise<void> {
  const { error } = await db().from("wa_ig_comment_rules").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

export async function getCommentRule(id: string, tenantId: string): Promise<IgCommentRule | null> {
  const { data } = await db().from("wa_ig_comment_rules").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data ? mapRule(data as Record<string, unknown>) : null;
}

// Find the best rule for an incoming comment within a tenant. Account-bound
// rules win over any-account; specific-post over all-posts; keyword over
// catch-all. Returns null when nothing matches (anti-spam default).
export async function matchCommentRule(text: string, mediaId: string | null, tenantId: string, channelId?: string | null): Promise<IgCommentRule | null> {
  const rules = (await listCommentRules(tenantId)).filter(r => r.enabled && r.dmMessage);
  const lc = text.toLowerCase();
  const keywordOk = (r: IgCommentRule) => !r.keyword || lc.includes(r.keyword.toLowerCase());
  const postOk = (r: IgCommentRule) => !r.postId || r.postId === mediaId;
  const channelOk = (r: IgCommentRule) => !r.channelId || !channelId || r.channelId === channelId;
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
  const { error } = await db().from("wa_ig_comment_log").insert({ comment_id: commentId, rule_id: ruleId, tenant_id: tenantId });
  if (error) return false;
  return true;
}

export async function bumpRuleMatch(id: string, current: number, tenantId: string): Promise<void> {
  await db().from("wa_ig_comment_rules").update({ match_count: current + 1 }).eq("id", id).eq("tenant_id", tenantId).then(() => {}, () => {});
}

// ── Follow gates ──────────────────────────────────────────────────────────────
export async function setFollowGate(igsid: string, ruleId: string, channelId: string | null, tenantId: string): Promise<void> {
  await db().from("wa_ig_follow_gates").upsert({ igsid, rule_id: ruleId, channel_id: channelId, tenant_id: tenantId }, { onConflict: "tenant_id,igsid" }).then(() => {}, () => {});
}
export async function getFollowGate(igsid: string, tenantId: string): Promise<{ ruleId: string; channelId: string | null } | null> {
  const { data } = await db().from("wa_ig_follow_gates").select("rule_id, channel_id").eq("igsid", igsid).eq("tenant_id", tenantId).maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return { ruleId: d.rule_id as string, channelId: (d.channel_id as string | null) ?? null };
}
export async function clearFollowGate(igsid: string, tenantId: string): Promise<void> {
  await db().from("wa_ig_follow_gates").delete().eq("igsid", igsid).eq("tenant_id", tenantId).then(() => {}, () => {});
}
