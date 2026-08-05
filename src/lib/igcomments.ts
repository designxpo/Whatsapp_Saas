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
import { assertTextsAllowed } from "./moderation";

// A link button on the DM. Meta's button template caps at 3 per message.
export interface RuleButton {
  label: string;
  url: string;
}
export const MAX_RULE_BUTTONS = 3;
// Rotating public-reply variants — vary the reply so IG doesn't see identical
// automated replies (an account-ban signal). Cap keeps the editor manageable.
export const MAX_PUBLIC_REPLIES = 5;

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

// Coerce raw jsonb into a clean, de-duped, capped list of public-reply variants.
export function normalizePublicReplies(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    const s = String(v ?? "").trim().slice(0, 280);
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out.slice(0, MAX_PUBLIC_REPLIES);
}

// A rule's keyword field holds one OR MANY trigger words, comma-separated
// (e.g. "guide, link, free"). Split into a clean lowercase token list.
export function parseKeywords(keyword: string | null | undefined): string[] {
  return (keyword ?? "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
}

// True if the comment text matches the rule's keyword(s): no keyword → matches
// any comment; otherwise matches if the text contains ANY one of the words.
export function matchesKeywords(text: string, keyword: string | null | undefined): boolean {
  const words = parseKeywords(keyword);
  if (!words.length) return true;
  const lc = text.toLowerCase();
  return words.some(w => lc.includes(w));
}

// Pick one public reply at random from a rule's variants (falls back to the
// legacy single reply). Empty when the rule has no public reply configured.
export function pickPublicReply(rule: Pick<IgCommentRule, "publicReplies" | "publicReply">): string {
  const list = rule.publicReplies?.length ? rule.publicReplies : (rule.publicReply ? [rule.publicReply] : []);
  if (!list.length) return "";
  return list[Math.floor(Math.random() * list.length)];
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
  publicReplies: string[];      // rotating public-reply variants (picked at random)
  publicReply: string | null;   // legacy mirror of publicReplies[0]
  replyOnly: boolean;           // true → post a public reply only, never DM
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
  dmMessage?: string;            // optional when replyOnly
  buttons?: RuleButton[];
  buttonLabel?: string | null;   // legacy single-button input (still accepted)
  buttonUrl?: string | null;
  publicReplies?: string[];
  publicReply?: string | null;   // legacy single-reply input (still accepted)
  replyOnly?: boolean;
  requireFollow?: boolean;
  followPrompt?: string | null;
}

export async function saveCommentRule(input: CommentRuleInput, tenantId: string): Promise<IgCommentRule> {
  // Rule text fires automatically onto PUBLIC comment threads and into DMs with
  // nobody watching, so it's screened when authored — the send-time check in
  // instagram.ts stays as the backstop, not the only line of defense.
  await assertTextsAllowed(
    [input.dmMessage, input.followPrompt, input.publicReply, ...(input.publicReplies ?? []), ...(input.buttons ?? []).map(b => b.label)],
    { tenantId, surface: "comment_rule" },
  );
  // Accept either the new `buttons` array or the legacy single button; the
  // legacy columns always mirror buttons[0] so old readers keep working.
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
    // Reply-only rules carry no DM; keep the column non-null with "".
    dm_message: replyOnly ? "" : (input.dmMessage ?? "").trim(),
    buttons: replyOnly ? [] : buttons,
    button_label: replyOnly ? null : (buttons[0]?.label || null),
    button_url: replyOnly ? null : (buttons[0]?.url || null),
    public_replies: publicReplies,
    public_reply: publicReplies[0] || null,
    reply_only: replyOnly,
    require_follow: replyOnly ? false : (input.requireFollow ?? false),
    follow_prompt: replyOnly ? null : (input.followPrompt?.trim() || null),
  };
  const runSave = (r: Record<string, unknown>) => (input.id
    ? db().from("wa_ig_comment_rules").update(r).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_ig_comment_rules").insert(r).select().single());
  let { data, error } = await runSave(row);
  // Tolerant fallback: if a newer column (0086 `buttons` / 0087 `public_replies`
  // / 0088 `reply_only`) isn't applied yet, retry without the offending column —
  // the legacy columns still persist variant[0], so rules keep working until the
  // migration lands. Loop so every missing column can be stripped in turn.
  const attempt = { ...row };
  for (let i = 0; i < 3 && error && /\b(buttons|public_replies|reply_only)\b/i.test(error.message ?? ""); i++) {
    if (/buttons/i.test(error.message ?? "")) delete attempt.buttons;
    if (/public_replies/i.test(error.message ?? "")) delete attempt.public_replies;
    if (/reply_only/i.test(error.message ?? "")) delete attempt.reply_only;
    ({ data, error } = await runSave(attempt));
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
  // A rule is actionable if it can either send a DM, or (reply-only) post a
  // public reply. Reply-only rules carry no dmMessage but must have a reply.
  const rules = (await listCommentRules(tenantId)).filter(r => r.enabled && (r.replyOnly ? r.publicReplies.length > 0 : !!r.dmMessage));
  const keywordOk = (r: IgCommentRule) => matchesKeywords(text, r.keyword);
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
