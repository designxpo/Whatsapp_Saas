// YouTube thread follow-ups — answering the conversation that continues under a
// comment the channel already replied to.
//
// Pure decisions only (which replies to answer, what the AI sees, how the reply
// is addressed); ytpoller.ts does the I/O. Kept apart so the rules that decide
// whether the channel speaks in public can be tested without a network.
//
// Who gets an answer, in a thread the channel has replied in:
//   - anyone who TAGS the channel (@handle). Tapping "reply" on the channel's
//     own reply inserts that tag automatically, so this is also "replied to us";
//   - the person who started the thread, continuing it after our reply.
// Viewers talking to each other underneath are left alone — the channel butting
// into every exchange is exactly the repetitive pattern YouTube treats as spam.

import type { YtReply, YtThread } from "./youtube";

/** How long after its last activity a thread is still watched. */
export const WATCH_DAYS = 7;
/** Most replies the channel will post in one thread, ever — a hard stop on loops. */
export const MAX_REPLIES_PER_THREAD = 6;
/** History the AI sees: the opening comment plus the latest turns. */
const CONTEXT_TURNS = 10;

export interface WatchedThread {
  /** Newest reply time already considered — anything later is new. */
  seen: string;
  /** Last activity in the thread (any author) — drives pruning and check cadence. */
  active: string;
  /** totalReplyCount last time we looked, so the full list is re-fetched only when it grew. */
  n?: number;
}
export interface YtWatch {
  handle?: string | null;
  handleAt?: string;
  checkedAt?: string;
  seeded?: boolean;
  threads: Record<string, WatchedThread>;
}

const ms = (iso: string | null | undefined): number => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? t : 0; };
const norm = (s: string) => s.normalize("NFKC").replace(/[​-‍﻿]/g, "").toLowerCase();

/** Does the text tag this channel? Case-insensitive; YouTube prefixes tags with a zero-width space. */
export function mentionsHandle(text: string, handle: string | null | undefined): boolean {
  if (!handle) return false;
  const h = norm(handle.startsWith("@") ? handle : `@${handle}`);
  const t = norm(text);
  const i = t.indexOf(h);
  if (i < 0) return false;
  // "@spiritualtalks" must not match inside "@spiritualtalksfan".
  const next = t.charAt(i + h.length);
  return !next || !/[a-z0-9._-]/.test(next);
}

/**
 * The replies in a watched thread that the channel should answer now. At most
 * one per person (their latest) — three quick messages get one answer that
 * reads all three, not three answers.
 */
export function pickFollowUps(thread: YtThread, o: { selfChannelId: string; handle?: string | null; seen: string; now: Date }): YtReply[] {
  const ours = thread.replies.filter(r => r.authorChannelId === o.selfChannelId);
  if (!ours.length) return [];                                   // not a thread we're in
  if (ours.length >= MAX_REPLIES_PER_THREAD) return [];
  const floor = Math.max(ms(o.seen), o.now.getTime() - WATCH_DAYS * 86_400_000);
  const firstOurs = ms(ours[0].publishedAt);

  const latestBy = new Map<string, YtReply>();
  for (const r of thread.replies) {
    const t = ms(r.publishedAt);
    if (t <= floor || t <= firstOurs) continue;                  // old, or before we joined
    if (!r.authorChannelId || r.authorChannelId === o.selfChannelId) continue;
    const tagged = mentionsHandle(r.text, o.handle);
    // The opener continuing their own thread — unless they are visibly talking
    // to someone else (their reply opens by tagging another viewer).
    const opener = r.authorChannelId === thread.top.authorChannelId && !opensWithOtherTag(r.text, o.handle);
    if (!tagged && !opener) continue;
    // Already answered: a reply of ours after this one means we've spoken since.
    if (ours.some(x => ms(x.publishedAt) > t)) continue;
    latestBy.set(r.authorChannelId, r);
  }
  return [...latestBy.values()].slice(0, MAX_REPLIES_PER_THREAD - ours.length);
}

function opensWithOtherTag(text: string, handle: string | null | undefined): boolean {
  const m = norm(text).trim().match(/^@[\w.-]+/);
  return !!m && !mentionsHandle(m[0], handle);
}

/** The thread as a conversation for the AI, up to and including `upTo`. */
export function threadHistory(thread: YtThread, selfChannelId: string, upTo: YtReply): { role: "user" | "assistant"; body: string }[] {
  const cut = ms(upTo.publishedAt);
  const turns = thread.replies
    .filter(r => ms(r.publishedAt) <= cut)
    .map(r => ({ role: r.authorChannelId === selfChannelId ? "assistant" as const : "user" as const, body: clean(r.text) }))
    .filter(t => t.body);
  const opener = { role: "user" as const, body: clean(thread.top.text) };
  return [opener, ...turns.slice(-CONTEXT_TURNS)];
}

/** Strip the auto-inserted tags so the AI reads what was said, not who was tagged. */
function clean(text: string): string {
  return text.replace(/[​-‍﻿]/g, "").replace(/^(\s*@[\w.-]+\s*)+/, "").trim();
}

/** Address the reply to its author, as YouTube's own reply button would. */
export function addressTo(author: string, reply: string): string {
  const name = author.trim();
  if (!name.startsWith("@") || norm(reply).startsWith(norm(name))) return reply;
  return `${name} ${reply}`;
}

/**
 * Whether the watched threads are due a check. Lively threads every tick;
 * otherwise every 15 minutes — the batch is one quota unit, but the quota is
 * shared by every tenant on the deployment.
 */
export function watchDue(w: YtWatch, now: Date): boolean {
  const ids = Object.keys(w.threads);
  if (!ids.length) return false;
  if (now.getTime() - ms(w.checkedAt) >= 15 * 60_000) return true;
  return ids.some(id => now.getTime() - ms(w.threads[id].active) < 2 * 3_600_000);
}

/** Drop threads quiet for WATCH_DAYS, and keep the newest 100 at most. */
export function pruneWatch(w: YtWatch, now: Date): YtWatch {
  const live = Object.entries(w.threads)
    .filter(([, t]) => now.getTime() - ms(t.active) < WATCH_DAYS * 86_400_000)
    .sort((a, b) => ms(b[1].active) - ms(a[1].active))
    .slice(0, 100);
  return { ...w, threads: Object.fromEntries(live) };
}
