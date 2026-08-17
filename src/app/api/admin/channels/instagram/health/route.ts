import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listChannels, getChannel, resolveIgAccountId, igWebhookFields, subscribeIgToApp, type Channel } from "@/lib/channels";
import { getTenantSetting, hasCommentConversation } from "@/lib/store";
import { IG_COMMENT_SCOPE, igScopesKey } from "@/lib/iglogin";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Is this Instagram account actually able to receive DMs and comments?
//
// Connecting an account has three separate outcomes that all look identical in
// the portal: fully subscribed, subscribed to messages only (Meta refused the
// `comments` field), and subscribed under an account id that no inbound webhook
// will ever match. The first is fine, the second silently kills every
// comment-to-DM rule, and the third silently kills everything. Until now the
// only record of which one happened was a log line written once at connect.
//
// GET  — read the live state back from Meta for each connected account.
// POST — re-run the subscription for one account and report what changed.

interface Report {
  id: string;
  name: string;
  igUserId: string | null;
  active: boolean;
  messages: boolean;
  comments: boolean;
  fields: string[];
  idMatches: boolean;
  liveId?: string;
  status: "ok" | "unverified" | "dms-only" | "wrong-id" | "error";
  detail: string;
  error?: string;
}

async function report(ch: Channel): Promise<Report> {
  const base = { id: ch.id, name: ch.name, igUserId: ch.igUserId, active: ch.active };
  if (!ch.token) {
    return { ...base, messages: false, comments: false, fields: [], idMatches: false, status: "error", detail: "No access token is stored for this account — reconnect it.", error: "no token" };
  }
  // Both reads are independent; a slow one shouldn't serialise the other.
  const [live, subs, scopes, commentsProven] = await Promise.all([
    resolveIgAccountId(ch.token),
    igWebhookFields(ch.igUserId ?? "", ch.token),
    getTenantSetting<string[] | null>(ch.tenantId, igScopesKey(ch.id), null).catch(() => null),
    hasCommentConversation(ch.id, ch.tenantId).catch(() => false),
  ]);
  // Recorded only for accounts connected through Business Login since we started
  // storing it; an account added by pasting a token has none, and absence must
  // read as "unknown", never as "not granted".
  const scopesKnown = Array.isArray(scopes) && scopes.length > 0;
  const commentScopeMissing = scopesKnown && !scopes.includes(IG_COMMENT_SCOPE);

  if (live.error && !subs.ok) {
    return { ...base, messages: false, comments: false, fields: [], idMatches: false, status: "error",
      detail: `Instagram rejected this account's token (${live.error}). Reconnect the account.`, error: live.error };
  }
  // resolveIgAccountId returns user_id when Meta gives one and falls back to the
  // APP-SCOPED id when it doesn't. Judging a stored id against that fallback
  // would tell a perfectly healthy tenant to reconnect, so only compare when we
  // really got the canonical id — which by construction differs from the
  // app-scoped one.
  const canonicalId = live.id && live.id !== live.appScopedId ? live.id : undefined;
  // A stored id Meta doesn't recognise is the failure that looks most like
  // success: sends keep working, every inbound event is dropped.
  const idMatches = !canonicalId || canonicalId === ch.igUserId;
  if (!idMatches) {
    return { ...base, messages: subs.messages, comments: subs.comments, fields: subs.fields, idMatches: false, liveId: canonicalId, status: "wrong-id",
      detail: `This account is stored under id ${ch.igUserId}, but Instagram calls it ${canonicalId}. Nothing inbound can match — reconnect the account to fix it.` };
  }
  if (!subs.ok) {
    return { ...base, messages: false, comments: false, fields: [], idMatches: true, liveId: canonicalId, status: "error",
      detail: `Meta wouldn't say what this account is subscribed to (${subs.error}).`, error: subs.error };
  }
  if (!subs.messages) {
    return { ...base, messages: false, comments: subs.comments, fields: subs.fields, idMatches: true, liveId: canonicalId, status: "error",
      detail: "Meta isn't delivering anything for this account — no DMs and no comments. Try Recheck, then reconnect if it doesn't clear." };
  }
  // Checked BEFORE the subscription, because the subscription lies here: Meta
  // accepts `comments` in subscribed_fields whether or not the permission was
  // granted, and then delivers nothing. Only the grant list settles it, and
  // re-subscribing cannot fix it — the account has to be authorised again.
  if (commentScopeMissing) {
    return { ...base, messages: true, comments: false, fields: subs.fields, idMatches: true, liveId: canonicalId, status: "dms-only",
      detail: "Instagram never granted comment access for this account, so comment webhooks are not delivered and no comment rule can fire — even though the subscription looks complete. Recheck won't help: disconnect it, connect again, and leave every permission switched on at Instagram's screen." };
  }
  if (!subs.comments) {
    return { ...base, messages: true, comments: false, fields: subs.fields, idMatches: true, liveId: canonicalId, status: "dms-only",
      detail: "DMs arrive, comments don't — so comment-to-DM and comment-reply rules on this account can never fire. Recheck to retry; if it stays off, Instagram hasn't granted comment access and the account needs reconnecting with every permission ticked." };
  }
  // The subscription says comments are on. That is only PROOF when we either
  // recorded the grant at connect, or have actually handled a comment for this
  // channel. Without one of those this check would print a confident green line
  // for an account that has never received a comment in its life — which is the
  // precise failure it was built to catch, reproduced by the checker itself.
  if (!scopesKnown && !commentsProven) {
    return { ...base, messages: true, comments: true, fields: subs.fields, idMatches: true, liveId: canonicalId, status: "unverified",
      detail: "DMs are arriving. Comments are subscribed, but Meta accepts that subscription even when comment access was never granted, and this account was connected before Talko started recording permissions — so it is not proof. No comment has reached this account yet. Reconnect it once to confirm, or post a test comment from another account." };
  }
  return { ...base, messages: true, comments: true, fields: subs.fields, idMatches: true, liveId: canonicalId, status: "ok",
    detail: commentsProven ? "Receiving DMs, and comments have been received on this account." : "Receiving DMs and comments." };
}

export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const channels = (await listChannels(tenantId)).filter(c => c.kind === "instagram" && c.active);
  const accounts = await Promise.all(channels.map(report));
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "Missing account id" }, { status: 400 });

  const ch = await getChannel(body.id, tenantId);
  if (!ch || ch.kind !== "instagram") return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
  if (!ch.token) return NextResponse.json({ error: "No access token is stored for this account — reconnect it." }, { status: 400 });
  // Without an id the subscribe URL would be built with an empty path segment
  // and fail with something meaningless from Graph rather than the real reason.
  if (!ch.igUserId) return NextResponse.json({ error: "No Instagram account id is stored for this account — reconnect it." }, { status: 400 });

  // Re-asking is the whole point: the connect-time attempt may have run before
  // App Review cleared the comments permission, or while Meta was refusing it
  // for an unrelated reason. Subscribing again is idempotent for Meta.
  const sub = await subscribeIgToApp(ch.igUserId, ch.token);
  const after = await report(ch);
  logActivity(await currentUser(), "channel.recheck", `${ch.name} (IG ${ch.igUserId}) — ${after.status}${sub.ok ? "" : `; resubscribe failed: ${sub.detail}`}`);
  return NextResponse.json({ account: after, resubscribe: sub });
}
