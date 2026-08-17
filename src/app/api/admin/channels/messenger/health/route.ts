import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listChannels, getChannel, resolvePageId, subscribePageToApp, type Channel } from "@/lib/channels";
import { fbTokenInfo, pageSubscribedFields, FB_COMMENT_SCOPE } from "@/lib/embeddedsignup";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Is this Facebook Page actually able to receive messages and comments?
//
// The Instagram twin of this route has to work from a grant list captured at
// connect, because no Meta endpoint will inspect an Instagram-login token. A
// Page token has no such problem: debug_token answers live, which is strictly
// better — it reflects a permission revoked after connect, which a stored
// snapshot never would. So this asks Meta every time rather than remembering.
//
// GET  — live state for each connected Page.
// POST — re-subscribe one Page and report what changed.

const MESSAGING_FIELD = "messages";
const COMMENT_FIELD = "feed";

interface Report {
  id: string;
  name: string;
  pageId: string | null;
  active: boolean;
  messages: boolean;
  comments: boolean;
  fields: string[];
  scopes: string[];
  tokenType: string | null;
  expiresAt: number;          // 0 = never, which is what a Page token should be
  idMatches: boolean;
  status: "ok" | "dms-only" | "wrong-id" | "expiring" | "error";
  detail: string;
}

async function report(ch: Channel): Promise<Report> {
  const base = { id: ch.id, name: ch.name, pageId: ch.pageId, active: ch.active };
  const empty = { messages: false, comments: false, fields: [] as string[], scopes: [] as string[], tokenType: null, expiresAt: 0, idMatches: false };
  if (!ch.token) return { ...base, ...empty, status: "error", detail: "No access token is stored for this Page — reconnect it." };
  if (!ch.pageId) return { ...base, ...empty, status: "error", detail: "No Page id is stored for this channel — reconnect it." };

  const [info, subs, live] = await Promise.all([
    fbTokenInfo(ch.token),
    pageSubscribedFields(ch.pageId, ch.token),
    resolvePageId(ch.token),
  ]);

  if (!info) {
    return { ...base, ...empty, status: "error", detail: "Meta wouldn't inspect this Page's token. Check the app credentials, then reconnect the Page." };
  }
  const scopes = info.scopes;
  const shared = { fields: subs.fields, scopes, tokenType: info.type, expiresAt: info.expiresAt };

  if (!info.valid) {
    return { ...base, ...shared, messages: false, comments: false, idMatches: false, status: "error",
      detail: `Meta has invalidated this Page's token${info.error ? ` (${info.error})` : ""} — nothing will send or arrive until the Page is reconnected.` };
  }
  // A USER token where a PAGE token belongs is the classic wrong-token save:
  // Page endpoints reject it with (#210) and inbound never resolves.
  if (info.type && info.type !== "PAGE") {
    return { ...base, ...shared, messages: false, comments: false, idMatches: false, status: "error",
      detail: `This channel holds a ${info.type} token, not a Page token. Page endpoints reject it — reconnect the Page so Talko can derive the Page's own token.` };
  }
  // Inbound matches page_id exactly, so a mismatch drops every event while
  // sends keep working — the failure that looks most like success.
  const canonical = live.id ?? info.profileId ?? null;
  const idMatches = !canonical || canonical === ch.pageId;
  if (!idMatches) {
    return { ...base, ...shared, messages: false, comments: false, idMatches: false, status: "wrong-id",
      detail: `This channel is stored under Page id ${ch.pageId}, but the token belongs to ${canonical}. Nothing inbound can match — reconnect the Page.` };
  }
  // 0 means never, which is what a Page token derived from a long-lived user
  // token should be. Anything else is a countdown nobody is watching.
  if (info.expiresAt > 0) {
    const days = Math.round((info.expiresAt * 1000 - Date.now()) / 86_400_000);
    return { ...base, ...shared, messages: subs.fields.includes(MESSAGING_FIELD), comments: subs.fields.includes(COMMENT_FIELD), idMatches: true, status: "expiring",
      detail: `This Page token expires in about ${days} day${days === 1 ? "" : "s"} and nothing renews it — a Page token should never expire. Reconnect the Page so Talko derives one from a long-lived login.` };
  }
  if (!subs.ok) {
    return { ...base, ...shared, messages: false, comments: false, idMatches: true, status: "error",
      detail: `Meta wouldn't say what this Page is subscribed to (${subs.error}).` };
  }
  if (!subs.fields.includes(MESSAGING_FIELD)) {
    return { ...base, ...shared, messages: false, comments: subs.fields.includes(COMMENT_FIELD), idMatches: true, status: "error",
      detail: "Meta isn't delivering messages for this Page. Press Recheck; if it doesn't clear, reconnect the Page." };
  }
  // Comments need BOTH the `feed` subscription and the permission behind it —
  // Meta accepts the subscription without the grant and then delivers nothing.
  const commentsGranted = scopes.includes(FB_COMMENT_SCOPE);
  const feedSubscribed = subs.fields.includes(COMMENT_FIELD);
  if (!commentsGranted || !feedSubscribed) {
    return { ...base, ...shared, messages: true, comments: false, idMatches: true, status: "dms-only",
      detail: !commentsGranted
        ? `Messenger DMs arrive, comments don't: this Page never granted ${FB_COMMENT_SCOPE}, so Meta delivers no comment events and no comment rule can fire. Recheck won't help — reconnect the Page with every permission left on.`
        : "Messenger DMs arrive, but this Page isn't subscribed to comment events, so comment rules can't fire. Press Recheck to subscribe it.",
    };
  }
  return { ...base, ...shared, messages: true, comments: true, idMatches: true, status: "ok",
    detail: "Receiving messages and comments." };
}

export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const channels = (await listChannels(tenantId)).filter(c => c.kind === "messenger" && c.active);
  return NextResponse.json({ accounts: await Promise.all(channels.map(report)) });
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "Missing Page id" }, { status: 400 });

  const ch = await getChannel(body.id, tenantId);
  if (!ch || ch.kind !== "messenger") return NextResponse.json({ error: "Facebook Page not found" }, { status: 404 });
  if (!ch.token || !ch.pageId) return NextResponse.json({ error: "This Page is missing its id or token — reconnect it." }, { status: 400 });

  const sub = await subscribePageToApp(ch.pageId, ch.token);
  const after = await report(ch);
  logActivity(await currentUser(), "channel.recheck", `${ch.name} (Page ${ch.pageId}) — ${after.status}${sub.ok ? "" : `; resubscribe failed: ${sub.detail}`}`);
  return NextResponse.json({ account: after, resubscribe: sub });
}
