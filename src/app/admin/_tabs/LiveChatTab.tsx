"use client";

// Live Chat: 3-pane chat workspace (conversation list / thread / contact info).
// Extracted from admin/page.tsx, lazy-loaded. ContactProfile is a shared module
// (also used by the Contacts tab). Pure relocation.
import { useVocab } from "@/lib/vocab-client";
import { useState, useEffect, useLayoutEffect, useCallback, useRef, useId, Fragment } from "react";
import { MessageSquare, Instagram, Search, SlidersHorizontal, MessageCircle, Facebook, LayoutTemplate, X, Loader2, Send, Sparkles, Mic, Paperclip, FileText, Bot, Zap, Plus, Check, AlertTriangle, SmilePlus, ArrowRight, ArrowLeft, Clock, Hourglass, CirclePause, Keyboard, RotateCcw, UserRound, PanelRight, EllipsisVertical, CreditCard, Tag, UserCheck, History, Layers, ClipboardList, Megaphone } from "lucide-react";
import { type Conversation, ConvAvatar, ChannelNameBadge, inp, type Tab, type ChatIntent, type GoTo, useChannelList } from "../_shared";
import { ContactProfile } from "./ContactProfile";
import { channelShort, type ConversationPlatform } from "@/lib/channel-label";
import { crmChatKey, type ChatCrmStatus } from "@/lib/crmkey";
import { TEAM_SHORT, nextTeam, type Team } from "@/lib/team-vocab";
import { EmptyState } from "../_shared";
import { ChatNotes } from "@/components/chat-notes";
import { CustomerWork } from "@/components/customer-work";
import { CustomerAutomations } from "@/components/customer-automations";
import { LeadWord, LeadReason, ApprovalCard } from "./LeadInsight";
import { DetailsSection, detailsButton, detailsControl } from "@/components/details-section";
import { Drawer } from "@/components/overlay";
import { SegmentedControl } from "@/components/SegmentedControl";
import { toast } from "@/components/toast";
import { fmtAgo, fmtNum, fmtUpdated } from "@/lib/format";
import { waitInfo, replyTarget, DEFAULT_REPLY_TARGET_MINUTES, type WaitInfo, type WaitLevel } from "@/lib/wait-urgency";
import {
  INBOX_FILTERS, INBOX_SORTS, normalizeFilter, normalizeSort, matchesFilter, filterCounts, sortChats, isMine, lastTouchMs,
  readSavedView, saveView, type InboxFilter, type InboxSort,
} from "@/lib/inbox-view";

type ThreadMessage = { id: string; role: "user" | "assistant"; body: string; source: "inbound" | "bot" | "agent"; createdAt: string; channelId?: string | null; mediaUrl?: string | null; mediaType?: string | null; metaMessageId?: string | null };
// One step in a lead's ownership trail (which number owned it, and who moved it).
type OwnerHistoryRow = { id: string; channelId: string | null; changedBy: string; reason: string | null; createdAt: string };
// "20 Aug, 6:21 am" — compact absolute stamp for the ownership trail, where the
// actual date matters more than "3d ago".
const stampShort = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// WhatsApp's own default quick-react set.
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// Best-known lead source from what we have locally, BEFORE (or absent) a CRM
// lookup: Meta ad referral > Handle Hub link label > web-chat UTM. Same
// priority chain used when this attribution is pushed to LeadSquared, so the
// fallback always agrees with what the CRM will eventually show.
function localSourceLabel(attrs?: Record<string, string>): string | undefined {
  if (!attrs) return undefined;
  if (attrs.ad_headline || attrs.ad_source) return attrs.ad_headline || attrs.ad_source;
  if (attrs.handle_source) return attrs.handle_source;
  const utm = [attrs.utm_source, attrs.utm_medium, attrs.utm_campaign].filter(Boolean).join(" / ");
  return utm || undefined;
}

// WhatsApp-style day-divider label: Today / Yesterday / weekday (last week) /
// "12 June 2026" for anything older.
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}
// True when message `i` opens a new calendar day vs. the previous message.
function startsNewDay(messages: { createdAt: string }[], i: number): boolean {
  if (i === 0) return true;
  return new Date(messages[i - 1].createdAt).toDateString() !== new Date(messages[i].createdAt).toDateString();
}

// Turn bare URLs in a plain-text message into clickable links, and let long ones
// wrap instead of overflowing the bubble. Everything else renders verbatim.
const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkify(text: string) {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline decoration-1 underline-offset-2 break-all hover:opacity-80">{part}</a>
      : <Fragment key={i}>{part}</Fragment>,
  );
}

// Digits-only phone → a readable "+<digits>" form. Never fabricates a number
// from a sentinel id (wa:<handle> / web:<uuid>) or anything with letters —
// those aren't dialable numbers, so they're returned untouched.
function formatPhone(raw: string): string {
  const s = (raw || "").trim();
  if (/[a-z:]/i.test(s)) return s;
  const d = s.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? "+" + d : s;
}
// A WhatsApp @username conversation stores its phone as the sentinel "wa:<handle>"
// (see store.ts); show it as @handle.
function isHandle(phone: string): boolean { return (phone || "").startsWith("wa:"); }
// Resolve the channel from the phone sentinel FIRST — a web:<uuid> is web chat
// even if the platform column is null/mis-stored (store.ts defaults null →
// "whatsapp") — then fall back to the platform column.
function contactChannel(c: { phone: string; platform?: string | null }): ConversationPlatform {
  if ((c.phone || "").startsWith("web:")) return "webchat";
  const p = c.platform ?? "whatsapp";
  return p === "instagram" || p === "messenger" || p === "webchat" ? p : "whatsapp";
}
// A stand-in NAME for someone we have no name for — not a channel name. Kept
// separate from channelLabel() in lib/channel-label.ts, which names the channel
// itself ("WhatsApp", "Facebook Messenger"): the two read almost the same but
// one goes where a person's name goes, and "WhatsApp" is not a person.
function anonymousName(k: ConversationPlatform): string {
  return k === "instagram" ? "Instagram user" : k === "messenger" ? "Messenger user" : k === "webchat" ? "Website visitor" : "WhatsApp user";
}
// A human name for the contact — never a raw web:<uuid> / IG-scoped id / PSID.
function contactDisplayName(c: { name?: string | null; phone: string; platform?: string | null }): string {
  if (c.name?.trim()) return c.name.trim();
  const k = contactChannel(c);
  if (k === "whatsapp") return isHandle(c.phone) ? "@" + c.phone.slice(3) : formatPhone(c.phone);
  return anonymousName(k);
}
// The sub-line under the name in the chat header: the number / @handle for
// WhatsApp, a friendly channel label (plus any captured phone) otherwise — so
// the raw session id / PSID is never shown to the agent.
function contactSubtitle(c: { phone: string; platform?: string | null; leadPhone?: string | null }): string {
  const k = contactChannel(c);
  if (k === "whatsapp") return isHandle(c.phone) ? "@" + c.phone.slice(3) : formatPhone(c.phone);
  return c.leadPhone ? `${channelShort(k)} · ${formatPhone(c.leadPhone)}` : channelShort(k);
}
// Monospace only when the subtitle is an actual number (a real phone / captured
// lead phone) — not an @handle or a channel label.
function subtitleIsPhone(c: { phone: string; platform?: string | null; leadPhone?: string | null }): boolean {
  const k = contactChannel(c);
  if (k === "whatsapp") return !isHandle(c.phone);
  return !!c.leadPhone;
}

// ── Live Chat: 3-pane chat workspace (list / thread / contact info) ──────────
// ── LeadSquared push status ─────────────────────────────────────────────────
// Mirrors CrmPushHealth in lib/leadsquared.ts (DB counters, no network probe).
type CrmHealth = {
  configured: boolean;
  state: "ok" | "syncing" | "failing" | "off";
  pending: number; dead: number; held: number;
  lastOkAt: string | null; lastError: string; detail: string;
};

// LeadSquared push status, shown across the top of Live Chat.
//
// The July 2026 outage ran for a full day before anyone noticed: LeadSquared
// kept answering lead LOOKUPS while rejecting every activity Create, so the
// settings page said "Connected" while nothing reached a single timeline. The
// only honest signal is whether pushes are LANDING, which is what this shows —
// and it shows it where the work happens rather than on a settings page nobody
// opens.
function CrmStatusBar() {
  const [h, setH] = useState<CrmHealth | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/crm/health").then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setH(d); }).catch(() => {});
  }, []);

  // Once the CRM side is fixed, held conversations are still parked up to 24h
  // out by the permanent-failure backoff. This pulls them all back to due-now so
  // the next cron tick clears the backlog instead of trickling it over a day.
  async function retryNow() {
    setRetrying(true); setNote(null);
    try {
      const d = await fetch("/api/admin/crm/health", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      }).then(r => r.json());
      if (d.success) {
        setNote(`${d.released} queued for immediate retry`);
        if (d.health) setH(d.health);
      } else setNote(d.error || "Retry failed");
    } catch { setNote("Connection error"); }
    finally { setRetrying(false); }
  }

  useEffect(() => {
    // Slower than the 10s conversation poll: sync state changes on the cron's
    // cadence, not the customer's, so a faster poll would only add load.
    load();   // first answer straight away — otherwise the bar stays blank until the first poll
    const t = setInterval(() => { if (!document.hidden) load(); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Nothing to say before the first response, and nothing worth nagging about
  // on a workspace that doesn't use LeadSquared at all.
  if (!h || h.state === "off") return null;

  const tone = {
    ok:      { dot: "bg-emerald-500", text: "text-ink-600",    bg: "bg-emerald-50/60 border-emerald-100" },
    syncing: { dot: "bg-amber-500",   text: "text-amber-800",  bg: "bg-amber-50 border-amber-200" },
    failing: { dot: "bg-red-500",     text: "text-red-800",    bg: "bg-red-50 border-red-200" },
  }[h.state === "ok" ? "ok" : h.state === "syncing" ? "syncing" : "failing"];

  return (
    <div className={`shrink-0 flex items-center gap-2 px-4 py-1.5 border-b text-[12px] ${tone.bg}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot} ${h.state === "failing" ? "animate-pulse motion-reduce:animate-none" : ""}`} />
      <span className="font-bold text-ink-900 shrink-0">LeadSquared</span>
      <span className={`${tone.text} truncate`}>{h.detail}</span>
      {/* Dead pushes never retry themselves — they are the part a person has to
          act on, so they get their own count rather than hiding inside detail. */}
      {note && <span className="shrink-0 text-ink-500">· {note}</span>}
      {h.held > 0 && (
        <button
          onClick={retryNow}
          disabled={retrying}
          title="Release every held conversation so the next sync retries them immediately"
          className="ml-auto shrink-0 min-h-8 px-2.5 rounded-control border border-current/25 font-bold hover:bg-white/60 disabled:opacity-50"
        >
          {retrying ? "Retrying…" : `Retry ${h.held} now`}
        </button>
      )}
      {h.held === 0 && h.dead > 0 && (
        <span className="ml-auto shrink-0 font-bold text-red-700">{h.dead} gave up</span>
      )}
      {h.held === 0 && h.dead === 0 && h.lastOkAt && (
        <span className="ml-auto shrink-0 text-ink-400" title={new Date(h.lastOkAt).toLocaleString()}>
          last push {agoShort(h.lastOkAt)}
        </span>
      )}
    </div>
  );
}

// Compact relative time for the status bar ("3m", "2h", "4d").
function agoShort(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return "just now";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / (24 * 60))}d ago`;
}

// "in 8m" / "now" — the mirror of agoShort for a deadline that hasn't passed.
// A due time already behind us means the flush just hasn't reached this row
// yet, which is "any moment now", not a negative number.
function untilShort(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (!Number.isFinite(mins) || mins <= 0) return "any moment";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 24 * 60) return `in ${Math.floor(mins / 60)}h`;
  return `in ${Math.floor(mins / (24 * 60))}d`;
}

type CrmChatMap = Record<string, ChatCrmStatus>;

// Which buffer row belongs to this conversation.
//
// Tries several identities because one conversation can be reached by more than
// one: a WhatsApp chat is its phone, an Instagram lead who later shared a number
// is buffered under that number, and a phone-less IG lead is buffered under its
// handle. First hit wins; no hit means nothing is waiting, which is the "clear"
// state rather than "unknown".
function crmStatusFor(c: Conversation, map: CrmChatMap): ChatCrmStatus {
  const handle = c.name && c.name.startsWith("@") ? `handle:${c.name}` : null;
  for (const id of [c.phone, c.leadPhone, handle]) {
    const k = crmChatKey(id);
    if (k && map[k]) return map[k];
  }
  return { state: "clear", attempts: 0, dueAt: null };
}

// What each state means in words, so the dot and the pill can never drift apart.
function crmChatCopy(s: ChatCrmStatus, lastError: string): { tone: string; label: string; title: string } {
  switch (s.state) {
    case "held":
      return {
        tone: "bg-red-500", label: "Not syncing",
        title: `This chat is NOT reaching LeadSquared — ${s.attempts} failed attempt${s.attempts === 1 ? "" : "s"}, next try ${untilShort(s.dueAt)}.${lastError ? `\n\n${lastError}` : ""}`,
      };
    case "dead":
      return {
        tone: "bg-red-600", label: "Gave up",
        title: "LeadSquared pushes for this chat were abandoned after repeated failures. Nothing will retry on its own.",
      };
    case "queued":
      return {
        tone: "bg-amber-500", label: "Queued",
        // Not a fault: messages are batched into ONE timeline note per session
        // rather than one per message, so a live chat is SUPPOSED to sit here.
        title: `Waiting to post to LeadSquared. Messages are combined into one timeline note once the chat goes quiet — posts ${untilShort(s.dueAt)}.`,
      };
    default:
      return {
        tone: "bg-emerald-500", label: "Synced",
        title: "Nothing is waiting to reach LeadSquared for this chat — every message has been posted.",
      };
  }
}

// Compact marker for the conversation list: one dot per row, no visible text,
// so 100 chats stay scannable and the eye only stops on the red ones. Screen
// readers get the words.
function CrmChatDot({ status, lastError }: { status: ChatCrmStatus; lastError: string }) {
  const { tone, label, title } = crmChatCopy(status, lastError);
  return (
    <span
      role="img"
      aria-label={`LeadSquared: ${label}`}
      title={title}
      className={`w-2 h-2 rounded-full shrink-0 ${tone} ${status.state === "held" || status.state === "dead" ? "animate-pulse motion-reduce:animate-none" : ""}`}
    />
  );
}

// Spelled-out version for the open chat's header, where there is room to say
// which system this is and there is only one conversation to describe. A dot
// and words, like the rest of the header's status line.
function CrmChatPill({ status, lastError }: { status: ChatCrmStatus; lastError: string }) {
  const { tone, label, title } = crmChatCopy(status, lastError);
  const text = status.state === "clear" ? "" : status.state === "queued" ? "text-amber-800" : "font-semibold text-red-700";
  return (
    <span title={title} className={text}>
      <span aria-hidden className={`inline-block w-1.5 h-1.5 mr-1 rounded-full align-middle ${tone}`} />
      LeadSquared {label.toLowerCase()}
    </span>
  );
}

// ── Inbox helpers shared by the list and the open chat ──────────────────────

// True while the viewport is at least `px` wide. Live Chat is client-only
// (dynamic, ssr:false), so the first render can read the real answer.
// Where the inbox starts on the page (below the header and any banner — the
// owner preview, a plan notice, an announcement), so it can fill exactly the
// rest of the screen. A fixed guess made the page taller than the window
// whenever a banner showed: the page scrolled and the reply box was cut off.
/**
 * The inbox's height, MEASURED: from where the inbox starts to where the phone
 * tab bar starts (or the bottom of the window when there is no tab bar).
 *
 * It used to be `100dvh - top - 56px - safe area`. On an iPhone, Safari's own
 * toolbar and the home-indicator inset make that sum come out taller than the
 * space really left, so the reply box slid under the tab bar. Measuring both
 * edges is right on every browser. The old calc stays as the first-paint
 * fallback, before JavaScript has measured.
 */
export function fitHeight(frameTopInPage: number, scrollY: number, tabBarTop: number | null, windowHeight: number): number {
  const bottom = tabBarTop ?? windowHeight;           // viewport coordinates
  return Math.max(240, Math.floor(bottom - (frameTopInPage - scrollY)));
}

function useFitHeight(ref: React.RefObject<HTMLElement | null>): number | null {
  const [h, setH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tabBar = () => {
      const nav = document.querySelector<HTMLElement>('nav[aria-label="Main"]');
      if (!nav || getComputedStyle(nav).display === "none") return null;
      const r = nav.getBoundingClientRect();
      return r.height > 0 ? r.top : null;
    };
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = fitHeight(top, window.scrollY, tabBar(), window.innerHeight);
      setH(prev => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    // Banners come and go (and fonts load) without a resize; the body's size
    // changes when they do. Our own height change doesn't move our top, so this settles.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(document.body);
    const nav = document.querySelector('nav[aria-label="Main"]');
    if (nav) ro?.observe(nav);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [ref]);
  return h;
}

function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setOk(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [query]);
  return ok;
}

const DETAILS_KEY = "talko-inbox-details";
function readLocal(key: string): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; } catch { return null; }
}
function writeLocal(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private mode: this visit only */ }
}

function sessionStore(): Storage | null {
  try { return typeof window !== "undefined" ? window.sessionStorage : null; } catch { return null; }
}

// Unsent replies, per chat, for this page visit — going back to the list on a
// phone (or opening another chat) no longer throws away what was typed.
const drafts = new Map<string, string>();

// What the inbox needs once, not once per opened chat: the composer's quick
// replies and canned templates, the people a chat can be assigned to, the AI
// rewrite prompts and assistants, and the broadcast batches. Opening a chat
// used to fire all of these again, every time.
type InboxRefs = {
  quickReplies: { id: string; shortcut: string; body: string }[];
  team: { name: string; email: string; title: string }[];
  aiPrompts: { id: string; name: string; active: boolean }[];
  canned: { id: string; label: string; stage?: string }[];
  aiAgents: { id: string; name: string; active: boolean }[];
  allBatches: { id: string; name: string; kind: string; size: number }[];
  me: { name: string; email: string } | null;
  /** Today settings' reply target, in minutes. */
  replyTarget: number;
};
const EMPTY_REFS: InboxRefs = { quickReplies: [], team: [], aiPrompts: [], canned: [], aiAgents: [], allBatches: [], me: null, replyTarget: DEFAULT_REPLY_TARGET_MINUTES };

// The reply target rarely changes, and its only GET is the full Today payload,
// so it is read once per page visit rather than on every visit to the inbox.
let replyTargetCache: number | null = null;

function useInboxRefs(): InboxRefs {
  const [refs, setRefs] = useState<InboxRefs>(() => ({ ...EMPTY_REFS, replyTarget: replyTargetCache ?? DEFAULT_REPLY_TARGET_MINUTES }));
  useEffect(() => {
    let alive = true;
    const get = <T,>(url: string, pick: (d: Record<string, unknown>) => T) =>
      fetch(url).then(r => (r.ok ? r.json() : null)).then(d => (d ? pick(d) : undefined)).catch(() => undefined);
    const put = (patch: Partial<InboxRefs>) => { if (alive) setRefs(r => ({ ...r, ...patch })); };
    void get("/api/admin/quick-replies", d => (d.quickReplies ?? []) as InboxRefs["quickReplies"]).then(v => v && put({ quickReplies: v }));
    void get("/api/admin/team/members", d => (d.members ?? []) as InboxRefs["team"]).then(v => v && put({ team: v }));
    void get("/api/admin/ai/prompts", d => ((d.prompts ?? []) as InboxRefs["aiPrompts"]).filter(p => p.active)).then(v => v && put({ aiPrompts: v }));
    void get("/api/admin/canned", d => (d.canned ?? []) as InboxRefs["canned"]).then(v => v && put({ canned: v }));
    void get("/api/admin/ai/agents", d => (d.agents ?? []) as InboxRefs["aiAgents"]).then(v => v && put({ aiAgents: v }));
    void get("/api/admin/batches", d => (d.batches ?? []) as InboxRefs["allBatches"]).then(v => v && put({ allBatches: v }));
    void get("/api/admin/me", d => {
      const u = d.user as { name?: string; email?: string } | undefined;
      return u?.email ? { name: u.name ?? "", email: u.email } : null;
    }).then(v => v !== undefined && put({ me: v }));
    if (replyTargetCache == null) {
      void get("/api/admin/today", d => replyTarget((d.settings as { replyTargetMinutes?: unknown } | undefined)?.replyTargetMinutes))
        .then(v => { if (v) { replyTargetCache = v; put({ replyTarget: v }); } });
    }
    return () => { alive = false; };
  }, []);
  return refs;
}

// "Waiting 42 min" with an icon that changes with the level, so lateness is
// never said by colour alone: a clock, an hourglass, then a warning sign. In a
// row's quiet status line this is the one coloured thing.
const WAIT_TEXT: Record<WaitLevel, string> = {
  fine: "text-ink-700",
  soon: "text-amber-800",
  late: "text-red-700",
};
function WaitText({ info }: { info: WaitInfo }) {
  const Icon = info.level === "late" ? AlertTriangle : info.level === "soon" ? Hourglass : Clock;
  return (
    <span title={`${info.label}, ${info.explain}`}
      className={`whitespace-nowrap font-semibold tabular-nums ${WAIT_TEXT[info.level]}`}>
      <Icon className="inline w-3 h-3 mr-1 -mt-0.5 align-middle" aria-hidden />
      {info.label}
      <span className="sr-only">, {info.explain}</span>
    </span>
  );
}

// Words separated by " · " — the list row's and the header's status line.
// The dots are decoration; screen readers hear commas. Items stay plain inline
// boxes (no inline-flex), so a line cut short ends in a clean ellipsis.
function Dotted({ items }: { items: React.ReactNode[] }) {
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="px-1 text-ink-400">·</span>}
          {i > 0 && <span className="sr-only">, </span>}
          {item}
        </Fragment>
      ))}
    </>
  );
}

// Last touch, short enough for a row: "just now", "42 min", "3 h", "2 days".
const shortAgo = (iso: string | null, now: number) => (iso ? fmtAgo(iso, now).replace(/ ago$/, "") : "");

// The keys the inbox answers to, shown from the filter menu's "Keyboard shortcuts".
const SHORTCUTS: [string, string][] = [
  ["↑ ↓  or  j k", "Move through the chat list"],
  ["Enter", "Open the highlighted chat"],
  ["Esc", "Back to the list (phone)"],
  ["/", "Quick replies, in the reply box"],
  ["⌘ Enter  or  Ctrl Enter", "Send the reply"],
];

function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <>
      <div className="fixed inset-0 z-20" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-label="Keyboard shortcuts"
        onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
        className="absolute right-0 top-full mt-1 z-30 w-72 rounded-[12px] border border-line bg-white shadow-lg p-3 focus:outline-none u-scale-in origin-top-right">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[13px] font-semibold text-ink-900">Keyboard shortcuts</p>
          <button type="button" onClick={onClose} aria-label="Close keyboard shortcuts" className="w-7 h-7 -m-1 flex items-center justify-center rounded-md text-ink-500 hover:bg-canvas hover:text-ink-900"><X className="w-3.5 h-3.5" aria-hidden /></button>
        </div>
        <dl className="space-y-1">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 text-[12px]">
              <dt><kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-line bg-canvas text-ink-800 whitespace-nowrap">{k}</kbd></dt>
              <dd className="text-ink-600 text-right">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

// A small segmented control for the list pane: a recessed track with one
// raised segment. Buttons with aria-pressed, because each one filters the list
// rather than switching to another panel. `value` may match nothing, when the
// active choice lives in the filter menu instead.
function Segments<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T | null;
  options: { value: T; label: React.ReactNode; count?: number; sr?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 p-0.5 rounded-[9px] bg-canvas">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className={`flex-1 min-w-0 h-9 md:h-8 lg:h-7 px-2 rounded-[7px] inline-flex items-center justify-center gap-1 text-[13px] md:text-[12px] whitespace-nowrap transition-colors ${on ? "bg-white shadow-sm text-ink-900 font-semibold" : "text-ink-600 font-medium hover:text-ink-900"}`}>
            <span className="truncate">{o.label}{o.sr && <span className="sr-only">{o.sr}</span>}</span>
            {typeof o.count === "number" && <span className={`tabular-nums text-[11px] ${on ? "text-ink-500" : "text-ink-400"}`}>{fmtNum(o.count)}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── The list's filters, shown like yesterday: a channel box, then one row of
// chips for the views used all day, and a small select for the rest. ──

type PlatformKey = "all" | "whatsapp" | "instagram" | "messenger" | "webchat";
const PLATFORMS: { key: PlatformKey; label: string; pill: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", pill: "All channels", icon: null },
  { key: "whatsapp", label: "WhatsApp", pill: "WhatsApp", icon: <MessageCircle className="w-3.5 h-3.5 text-green-600" /> },
  { key: "instagram", label: "Instagram", pill: "Instagram", icon: <Instagram className="w-3.5 h-3.5 text-pink-600" /> },
  // Every channel always shows, so a connected one is visible before its first chat lands.
  { key: "messenger", label: "Facebook", pill: "Facebook", icon: <Facebook className="w-3.5 h-3.5 text-blue-600" /> },
  { key: "webchat", label: "Web chat", pill: "Web chat", icon: <MessageSquare className="w-3.5 h-3.5 text-brand-700" /> },
];
/** The views used all day sit as chips; the rest are in the "More filters" select. */
const CHIP_FILTERS: readonly InboxFilter[] = ["all", "waiting", "mine", "needs_person"];
const CHIP_LABEL: Partial<Record<InboxFilter, string>> = { all: "All", waiting: "Waiting", mine: "Mine", needs_person: "Needs a person" };

type ChipTone = "red" | "amber" | "grey" | "green" | "brand";
const CHIP_TONE: Record<ChipTone, string> = {
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-800",
  grey: "bg-canvas text-ink-600",
  green: "bg-emerald-50 text-emerald-700",
  brand: "bg-brand-50 text-brand-700",
};
/** Yesterday's small uppercase tag (11px at the smallest). */
function Chip({ tone, title, children }: { tone: ChipTone; title?: string; children: React.ReactNode }) {
  return <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-[0.02em] whitespace-nowrap ${CHIP_TONE[tone]}`}>{children}</span>;
}
/** "WAITING 42 MIN" as a tag: grey, then amber, then red against the reply target, with a changing icon. */
function WaitChip({ info }: { info: WaitInfo }) {
  const Icon = info.level === "late" ? AlertTriangle : info.level === "soon" ? Hourglass : Clock;
  return (
    <Chip tone={info.level === "late" ? "red" : info.level === "soon" ? "amber" : "grey"} title={`${info.label}, ${info.explain}`}>
      <Icon className="w-3 h-3" aria-hidden /><span className="tabular-nums">{info.label}</span><span className="sr-only">, {info.explain}</span>
    </Chip>
  );
}
/** The AI's lead read as tags: "HOT 88", plus "PAY" when they're ready to pay. */
function LeadChips({ lead }: { lead?: Conversation["lead"] }) {
  if (!lead) return null;
  const tone: ChipTone = lead.status === "Hot" ? "red" : lead.status === "Warm" ? "amber" : lead.status === "Won" ? "green" : "grey";
  const label = lead.status === "OptOut" ? "Opted out" : lead.status;
  return (
    <>
      <Chip tone={tone} title={lead.reason ?? "AI lead read"}><span className="sr-only">Lead: </span>{label}{lead.score != null && lead.status !== "OptOut" ? <span className="tabular-nums">{lead.score}</span> : null}</Chip>
      {lead.readyToPay && <Chip tone="green" title="Ready to pay"><CreditCard className="w-3 h-3" aria-hidden />Pay</Chip>}
    </>
  );
}

// Placeholder rows while the first list is on its way, so "No conversations
// yet" is never shown to someone whose chats just haven't arrived.
function ListSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading conversations…</span>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} aria-hidden className="flex items-start gap-2.5 pl-6 pr-3 py-2.5 animate-pulse motion-reduce:animate-none">
          <div className="w-10 h-10 md:w-8 md:h-8 rounded-full bg-canvas shrink-0" />
          <div className="flex-1 space-y-1.5 py-0.5">
            <div className="h-3 w-2/5 rounded bg-canvas" />
            <div className="h-3 w-4/5 rounded bg-canvas" />
            <div className="h-2.5 w-1/3 rounded bg-canvas" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Why a list or thread fetch failed, in words a shop owner can act on.
function fetchProblem(status: number | null): string {
  if (status === 401) return "You've been signed out. Sign in again to see your chats.";
  if (status === 403) return "This chat belongs to another team.";
  if (status === 404) return "This chat no longer exists.";
  if (status && status >= 500) return "The server had a problem loading this.";
  return "Couldn't reach the server. Check your internet connection.";
}

function LiveChatTab({ goTo, intent, clearIntent }: { goTo: GoTo; intent: ChatIntent | null; clearIntent: () => void }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const inboxHeight = useFitHeight(frameRef);
  const { vocab } = useVocab();
  const [convos, setConvos] = useState<Conversation[]>([]);
  // Until the first answer, the list shows placeholders, not "No conversations yet".
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Filter and sort are remembered for this browser tab, so leaving the inbox
  // and coming back keeps the view an agent chose.
  const [filter, setFilter] = useState<InboxFilter>(() => readSavedView(sessionStore()).filter);
  const [sort, setSort] = useState<InboxSort>(() => readSavedView(sessionStore()).sort);
  useEffect(() => { saveView(sessionStore(), { filter, sort }); }, [filter, sort]);
  const [platform, setPlatform] = useState<PlatformKey>("all");
  // Narrow further to ONE number/account/Page of the selected platform — only
  // shown when that platform has 2+ connected channels.
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  // Set when the signed-in member is pinned to one team — the inbox then only
  // ever contains that team's numbers, and we say so rather than letting it look
  // like chats went missing.
  const [scopedTeam, setScopedTeam] = useState<Team | null>(null);
  // phone → pipeline stage, batched by the conversations endpoint so the inbox
  // can show WHERE each lead is, not only which number it arrived on.
  const [stages, setStages] = useState<Record<string, { name: string; color: string | null; isWon: boolean; isLost: boolean }>>({});
  const [stageFilter, setStageFilter] = useState<string>("");
  const channelList = useChannelList();
  const [view, setView] = useState<"chats" | "comments">("chats");
  const [search, setSearch] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Phones: channel, stage, "More filters" and sort fold behind one Filters
  // button so the chats get the screen. Laptops always show them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);   // deep-link: open this person once loaded
  // Chats the alerts endpoint says are waiting for a person (ready to pay,
  // approvals, or all of them while the AI is off) — joined into "Waiting for
  // you" so the list and the alert count agree.
  const [alerted, setAlerted] = useState<ReadonlySet<string>>(() => new Set());
  // The clock the wait labels read; ticks so "Waiting 4 min" keeps up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const refs = useInboxRefs();

  // One panel at a time on a phone; the contact details join as a third
  // column only where there is room for all three.
  const twoPane = useMinWidth(768);
  const threePane = useMinWidth(1280);

  // The number filter goes to the SERVER, not the browser. This endpoint returns
  // at most 150 conversations ordered by recency, so filtering client-side would
  // search only the newest page and quietly hide the rest of that number's chats.
  // Refetching on change also means the counts and the list agree.
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const qs = channelFilter ? `?channelId=${encodeURIComponent(channelFilter)}` : "";
    // Best-effort, alongside: which chats the alerts count as waiting.
    fetch("/api/admin/inbox/waiting").then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.chats) && mine === seq.current) setAlerted(new Set((d.chats as { id: string }[]).map(c => c.id))); })
      .catch(() => {});
    let status: number | null = null;
    try {
      const r = await fetch(`/api/admin/conversations${qs}`);
      status = r.status;
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (mine !== seq.current) return;   // a newer request (another number) owns the list now
      setConvos(d.conversations ?? []); setStages(d.stages ?? {}); setScopedTeam(d.scopedToTeam ?? null);
      setLoaded(true); setListError(null); setUpdatedAt(Date.now()); setNow(Date.now());
    } catch {
      if (mine === seq.current) setListError(fetchProblem(status));
    }
  }, [channelFilter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    // The poll skips hidden tabs, so coming back to one left the list showing
    // whatever was true when it was last visible for up to another 10s. Fetch on
    // the way back in: that gap is exactly when the inbox looks frozen.
    const wake = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [load]);
  const retryList = async () => { setRetrying(true); try { await load(); } finally { setRetrying(false); } };

  // Per-chat CRM markers. Polled a third as often as the conversations: this
  // state moves on the flush cron's cadence, not the customer's, so matching the
  // 10s message poll would only add load for no extra freshness.
  const [crmChats, setCrmChats] = useState<CrmChatMap>({});
  const [crmOn, setCrmOn] = useState(false);
  const [crmErr, setCrmErr] = useState("");
  useEffect(() => {
    const pull = () => fetch("/api/admin/crm/chat-status").then(r => r.ok ? r.json() : null)
      .then(d => { if (!d) return; setCrmOn(!!d.configured); setCrmChats(d.statuses ?? {}); setCrmErr(d.lastError ?? ""); })
      .catch(() => {});
    pull();
    const t = setInterval(() => { if (!document.hidden) pull(); }, 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Opening a chat, and getting back to the list ──
  // On a phone the open chat replaces the list, so it gets a history entry:
  // the browser's Back (or the swipe-back gesture) returns to the list instead
  // of leaving the portal.
  const pushed = useRef(false);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const openChat = useCallback((id: string) => {
    setSelected(id);
    if (!twoPane && !pushed.current) {
      try { window.history.pushState({ ...(window.history.state ?? {}), talkoInboxChat: id }, ""); pushed.current = true; } catch { /* history unavailable */ }
    }
  }, [twoPane]);
  const backToList = useCallback(() => {
    if (pushed.current) { window.history.back(); return; }   // popstate below clears the selection
    setSelected(null);
  }, []);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const s = e.state as { talkoInboxChat?: string } | null;
      if (pushed.current && !s?.talkoInboxChat) { pushed.current = false; setSelected(null); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Apply a deep-link intent on arrival (Home cards / Pipeline / Contacts / Today).
  // Opening a specific person clears any filter so their chat can't be hidden.
  // Older filter names (needs_reply, escalated, bot_off) still work.
  useEffect(() => {
    if (!intent) return;
    if (intent.openPhone) { setPendingPhone(intent.openPhone); setView("chats"); setPlatform("all"); setChannelFilter(null); setFilter("all"); }
    else { if (intent.view) setView(intent.view); if (intent.platform) { setPlatform(intent.platform); setChannelFilter(null); } if (intent.filter) setFilter(normalizeFilter(intent.filter)); }
    clearIntent();
  }, [intent, clearIntent]);

  // Once conversations are loaded, open the deep-linked person (match by number).
  useEffect(() => {
    if (!pendingPhone || !loaded) return;
    const norm = (p: string) => (p || "").replace(/\D/g, "").slice(-10);
    const match = convos.find(c => norm(c.phone) === norm(pendingPhone));
    if (match) openChat(match.id);
    setPendingPhone(null);   // resolved (found or not) — stop retrying on each refresh
  }, [pendingPhone, convos, loaded, openChat]);

  // ── Keyboard: ↑/↓ or j/k move through the list, Enter opens (the rows are
  // buttons), Escape goes back to the list on a phone. Never while typing, and
  // never under an open dialog.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      if (document.querySelector("[aria-modal='true']")) return;
      if (e.key === "Escape") {
        if (!twoPane && selectedRef.current) { e.preventDefault(); backToList(); }
        return;
      }
      const arrow = e.key === "ArrowDown" || e.key === "ArrowUp";
      const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      if (!dir) return;
      const list = listRef.current;
      if (!list || list.offsetParent === null) return;   // list hidden (a phone showing the chat)
      // Arrows keep scrolling the thread when focus is in it; j/k work anywhere.
      if (arrow && t && t !== document.body && !list.contains(t)) return;
      const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-inbox-row]"));
      if (!rows.length) return;
      e.preventDefault();
      let from = rows.findIndex(r => r === document.activeElement);
      if (from < 0) from = rows.findIndex(r => r.dataset.id === selectedRef.current);
      const to = from < 0 ? (dir > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, from + dir));
      rows[to].focus();
      rows[to].scrollIntoView?.({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [twoPane, backToList]);

  const q = search.trim().toLowerCase();
  const onPlatform = (c: Conversation, p: "whatsapp" | "instagram" | "messenger" | "webchat") => (c.platform ?? "whatsapp") === p;
  // Split comment threads (IG comment → AI reply) from real DM chats.
  const chatsCount = convos.filter(c => !c.isComment).length;
  const commentsCount = convos.filter(c => !!c.isComment).length;
  const inView = convos.filter(c => view === "comments" ? !!c.isComment : !c.isComment);
  const filterCtx = { now, me: refs.me, alerted };
  // Everything except the status filter, so each filter chip can say how many it would show.
  const scoped = inView
    .filter(c => platform === "all" ? true : onPlatform(c, platform))
    // Belt-and-braces only: the server already applied this. Kept so a list still
    // in flight from the previous number can't flash the wrong chats.
    .filter(c => !channelFilter || c.channelId === channelFilter)
    .filter(c => !stageFilter || (stageFilter === "__none" ? !stages[c.phone] : stages[c.phone]?.name === stageFilter))
    .filter(c => !q || (c.name ?? "").toLowerCase().includes(q) || c.phone.includes(q));
  const counts = filterCounts(scoped, filterCtx);
  const visible = sortChats(scoped.filter(c => matchesFilter(c, filter, filterCtx)), sort, now);
  const stageNames = [...new Set(inView.map(c => stages[c.phone]?.name).filter(Boolean))] as string[];
  const platformChannels = platform === "all" ? [] : channelList.filter(c => (c.kind ?? "whatsapp") === platform);
  const waCount = inView.filter(c => onPlatform(c, "whatsapp")).length;
  const igCount = inView.filter(c => onPlatform(c, "instagram")).length;
  const fbCount = inView.filter(c => onPlatform(c, "messenger")).length;
  const wcCount = inView.filter(c => onPlatform(c, "webchat")).length;

  // The row's clock. Ranking and labelling by the last INBOUND alone made a chat
  // we had replied to twenty minutes ago read as hours old, because that was when
  // the customer last wrote — while the preview underneath showed our reply, so
  // the row contradicted itself. The later of the two is the last touch.
  const lastTouch = (c: Conversation) => {
    const t = lastTouchMs(c);
    return t ? new Date(t).toISOString() : null;
  };

  const showList = twoPane || !selected;
  const showThread = twoPane || !!selected;
  const filterLabel = INBOX_FILTERS.find(f => f.key === filter)?.label ?? "All";
  const platformCount: Record<PlatformKey, number> = { all: inView.length, whatsapp: waCount, instagram: igCount, messenger: fbCount, webchat: wcCount };
  const channelNoun = platform === "instagram" ? "account" : platform === "messenger" ? "Page" : platform === "webchat" ? "site" : "number";
  // How many of the folded-away filters are doing something, for the badge.
  const foldedActive = (view === "chats" && platform !== "all" ? 1 : 0) + (channelFilter ? 1 : 0) + (stageFilter ? 1 : 0)
    + (CHIP_FILTERS.includes(filter) ? 0 : 1) + (sort !== "newest" ? 1 : 0);

  return (
    // Fills the screen between where it starts (measured: header + any banner)
    // and the bottom — on phones, the 56px tab bar — cancelling <main>'s
    // padding: p-4 / sm:p-6, pb-24 under md for the bar.
    <div ref={frameRef} style={inboxHeight === null ? undefined : { height: inboxHeight }}
      className="-mx-4 -mt-4 -mb-24 sm:-mx-6 sm:-mt-6 md:-mb-6 h-[calc(100dvh-112px-56px-env(safe-area-inset-bottom))] md:h-[calc(100dvh-64px)] flex flex-col bg-white overflow-hidden">
      <CrmStatusBar />
      <div className="flex-1 flex min-h-0">
      {/* Conversation list */}
      <aside aria-label="Conversations" className={`${showList ? "flex" : "hidden"} w-full md:w-80 shrink-0 md:border-r border-line flex-col min-h-0`}>
        <div className="px-3 pt-2.5 pb-2.5 md:p-4 md:pb-3 space-y-2.5 md:space-y-3 border-b border-line">
          <div className="relative max-md:sr-only flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-[15px] font-bold text-ink-900">
              {view === "comments" ? "Comments" : "Live Chat"}{" "}
              <span className="text-xs font-normal text-ink-500 tabular-nums">({loaded ? fmtNum(visible.length) : "…"})<span className="sr-only"> shown</span></span>
            </h2>
            <button type="button" onClick={() => setShowShortcuts(s => !s)} aria-label="Keyboard shortcuts" aria-expanded={showShortcuts} title="Keyboard shortcuts"
              className="hidden md:inline-flex w-7 h-7 items-center justify-center rounded-[8px] text-ink-500 hover:text-ink-900 hover:bg-canvas">
              <Keyboard className="w-4 h-4" aria-hidden />
            </button>
            {showShortcuts && <ShortcutsPanel onClose={() => setShowShortcuts(false)} />}
          </div>
          {/* Chats vs Comments — comment threads (IG comment → AI reply) live in
              their own section so they don't clutter real DM conversations. */}
          <SegmentedControl ariaLabel="Conversation type" value={view}
            onChange={v => { setView(v); setSelected(null); setPlatform("all"); setChannelFilter(null); }}
            options={[
              { value: "chats", label: "Chats", count: chatsCount, icon: <MessageSquare className="w-3 h-3" aria-hidden /> },
              { value: "comments", label: "Comments", count: commentsCount, icon: <MessageCircle className="w-3 h-3 text-ink-500" aria-hidden /> },
            ]} />
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input type="search" aria-label="Search chats by name or number"
                className="w-full h-10 md:h-auto border border-line rounded-control pl-8 pr-3 md:py-2 text-base md:text-sm bg-canvas text-ink-900 placeholder:text-ink-500 focus:bg-white"
                placeholder="Search name or number" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button type="button" onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} aria-controls="inbox-filters"
              className={`md:hidden relative shrink-0 h-10 px-3 inline-flex items-center gap-1.5 rounded-control border text-[13px] font-semibold ${filtersOpen || foldedActive ? "border-brand-200 bg-brand-50 text-brand-800" : "border-line bg-white text-ink-700"}`}>
              <SlidersHorizontal className="w-4 h-4" aria-hidden /> Filters
              {foldedActive > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-700 text-white text-[11px] leading-[18px] text-center tabular-nums">{foldedActive}<span className="sr-only"> on</span></span>}
            </button>
          </div>
          {/* A pinned member's inbox is a subset by design. Saying so stops it
              reading as missing data — the failure mode this whole split risks. */}
          {scopedTeam && (
            <p className="text-[11px] text-blue-700 bg-blue-50 rounded-control px-2.5 py-1.5">
              Showing the <b>{TEAM_SHORT[scopedTeam]}</b> team&apos;s numbers only. Other teams&apos; chats are handled in their own inbox.
            </p>
          )}
          {/* Phones: folded behind the Filters button. Laptops: always shown. */}
          <div id="inbox-filters" className={`${filtersOpen ? "block" : "hidden"} md:block empty:hidden space-y-2.5 md:space-y-3`}>
            {/* Channel — only for Chats; comments are Instagram/Facebook posts. */}
            {view === "chats" && (
              <div role="group" aria-label="Channel" className="flex flex-wrap gap-1 p-0.5 bg-canvas rounded-control">
                {PLATFORMS.map(p => (
                  <button key={p.key} type="button" aria-pressed={platform === p.key} onClick={() => { setPlatform(p.key); setChannelFilter(null); }}
                    className={`flex-1 min-w-[96px] md:min-w-[68px] min-h-9 md:min-h-0 px-2 py-1.5 rounded-[7px] text-[11px] font-bold whitespace-nowrap flex items-center justify-center gap-1 transition-colors ${platform === p.key ? "bg-white shadow-sm text-ink-900" : "text-ink-500 hover:text-ink-800"}`}>
                    {p.icon && <span aria-hidden className="flex [&>svg]:w-3 [&>svg]:h-3">{p.icon}</span>}
                    {p.label} <span className="opacity-60 tabular-nums">{loaded ? fmtNum(platformCount[p.key]) : ""}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Which number/account/Page — once a platform with 2+ connected channels is chosen. */}
            {platformChannels.length > 1 && (
              <select aria-label={`Filter by ${channelNoun}`} className={`${inp} w-full !py-1.5 !text-base md:!text-xs`} value={channelFilter ?? ""} onChange={e => setChannelFilter(e.target.value || null)}>
                <option value="">{channelNoun === "number" ? "All numbers" : channelNoun === "Page" ? "All Pages" : channelNoun === "site" ? "All sites" : "All accounts"}</option>
                {platformChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            {/* Pipeline stage — the "where is this lead" axis. */}
            {stageNames.length > 0 && (
              <select aria-label={`Show only ${vocab.lead.many.toLowerCase()} at one ${vocab.pipeline.one.toLowerCase()} stage`} className={`${inp} w-full !py-1.5 !text-base md:!text-xs`} value={stageFilter}
                onChange={e => { setStageFilter(e.target.value); setSelected(null); }}>
                <option value="">All stages</option>
                {stageNames.map(n => <option key={n} value={n}>Stage: {n}</option>)}
                <option value="__none">No stage set</option>
              </select>
            )}
          </div>
          <div role="group" aria-label="Show" className="flex gap-1 max-md:-mx-3 max-md:px-3 max-md:overflow-x-auto max-md:[scrollbar-width:none] md:flex-wrap">
            {CHIP_FILTERS.map(k => {
              const full = INBOX_FILTERS.find(f => f.key === k)?.label ?? k;
              return (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={`shrink-0 min-h-8 md:min-h-0 px-3 md:px-2 py-1 rounded-full text-[11px] font-bold whitespace-nowrap ${filter === k ? "bg-ink-950 text-white" : "bg-canvas text-ink-500 hover:text-ink-800"}`}>
                  {CHIP_LABEL[k]}{CHIP_LABEL[k] !== full && <span className="sr-only"> ({full})</span>}
                  {k === "waiting" && loaded && <span className="ml-1 opacity-70 tabular-nums">{fmtNum(counts[k])}</span>}
                </button>
              );
            })}
          </div>
          <div className={`${filtersOpen ? "block" : "hidden"} md:block`}>
            <div className="flex gap-2">
              <select aria-label="More filters" className={`${inp} flex-1 min-w-0 !py-1.5 !text-base md:!text-xs`}
                value={CHIP_FILTERS.includes(filter) ? "" : filter} onChange={e => setFilter(normalizeFilter(e.target.value || "all"))}>
                <option value="">More filters…</option>
                {INBOX_FILTERS.filter(f => !CHIP_FILTERS.includes(f.key)).map(f => <option key={f.key} value={f.key}>{f.label}{loaded ? ` (${counts[f.key]})` : ""}</option>)}
              </select>
              <select aria-label="Sort chats" className={`${inp} flex-1 min-w-0 !py-1.5 !text-base md:!text-xs`} value={sort} onChange={e => setSort(normalizeSort(e.target.value))}>
                {INBOX_SORTS.map(o => <option key={o.key} value={o.key}>{o.key === "newest" ? "Newest first" : "Longest waiting first"}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain">
          {/* A refresh that failed after the list had loaded: keep what we had, say so. */}
          {loaded && listError && (
            <div role="alert" className="flex items-center gap-2 mx-0.5 my-1 px-3 py-1.5 rounded-[8px] text-[12px] text-amber-900 bg-amber-50 border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="flex-1">Couldn&apos;t refresh the list. {fmtUpdated(updatedAt, now)}.</span>
              <button onClick={() => void retryList()} disabled={retrying} className="shrink-0 min-h-8 md:min-h-7 px-2.5 rounded-[8px] border border-amber-300 bg-white font-semibold hover:bg-amber-100 disabled:opacity-60">{retrying ? "Retrying…" : "Retry"}</button>
            </div>
          )}
          {!loaded && !listError && <ListSkeleton />}
          {!loaded && listError && (
            <div role="alert" className="flex flex-col items-center text-center gap-3 px-6 py-12">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-700 flex items-center justify-center"><AlertTriangle className="w-5 h-5" aria-hidden /></div>
              <div>
                <p className="text-sm font-semibold text-ink-900">Couldn&apos;t load your chats</p>
                <p className="text-[13px] text-ink-600 mt-1">{listError}</p>
              </div>
              <button onClick={() => void retryList()} disabled={retrying} className="min-h-10 md:min-h-8 px-4 rounded-[8px] bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-semibold disabled:opacity-60 inline-flex items-center gap-1.5">
                {retrying ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw className="w-4 h-4" aria-hidden />} Retry
              </button>
            </div>
          )}
          {loaded && visible.map(c => {
            const awaiting = !!c.needsReply;
            const wait = awaiting ? waitInfo(c.lastInboundAt, refs.replyTarget, now) : null;
            const mine = isMine(c.assignedTo, refs.me);
            const name = contactDisplayName(c);
            const on = selected === c.id;
            const stage = stages[c.phone];
            const tags = awaiting || c.status === "escalated" || !c.botEnabled || !!c.lead || !!stage || !!c.assignedTo;
            return (
            <button key={c.id} data-inbox-row data-id={c.id} onClick={() => openChat(c.id)}
              aria-current={on ? "true" : undefined}
              className={`relative w-full flex items-start gap-3 px-4 py-3 text-left border-b border-line/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 ${on ? "bg-brand-50" : "hover:bg-canvas"}`}>
              <div className="relative shrink-0 mt-0.5">
                <ConvAvatar url={c.avatarUrl} label={name} size={twoPane ? 36 : 40} />
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white border border-line flex items-center justify-center" title={c.platform === "instagram" ? "Instagram" : c.platform === "messenger" ? "Messenger" : c.platform === "webchat" ? "Web chat" : "WhatsApp"}>
                  {c.platform === "instagram" ? <Instagram className="w-2.5 h-2.5 text-pink-600" aria-hidden /> : c.platform === "messenger" ? <Facebook className="w-2.5 h-2.5 text-blue-600" aria-hidden /> : c.platform === "webchat" ? <MessageSquare className="w-2.5 h-2.5 text-brand-700" aria-hidden /> : <MessageCircle className="w-2.5 h-2.5 text-green-600" aria-hidden />}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[14px] md:text-[13px] font-semibold text-ink-900">
                    {name}
                    <span className="sr-only">{awaiting ? ", awaiting a reply" : ""}, on {channelShort(contactChannel(c))}</span>
                  </p>
                  {/* Whether THIS chat's messages are reaching LeadSquared. Hidden
                      entirely when LeadSquared isn't configured, so a workspace
                      that doesn't use it sees no unexplained dots. */}
                  {crmOn && <CrmChatDot status={crmStatusFor(c, crmChats)} lastError={crmErr} />}
                  <span className={`text-[11px] shrink-0 tabular-nums ${awaiting ? "text-brand-700 font-semibold" : "text-ink-500"}`}>{shortAgo(lastTouch(c), now)}</span>
                </div>
                <p className="text-[13px] md:text-[12px] text-ink-500 truncate">{c.lastMessage ?? "—"}</p>
                {tags && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {awaiting && <span aria-hidden className="w-2 h-2 rounded-full bg-brand-500" title="Awaiting reply" />}
                    {wait && <WaitChip info={wait} />}
                    {c.status === "escalated" && <Chip tone="red">Needs a person</Chip>}
                    {!c.botEnabled && <Chip tone="grey" title="The AI won't reply in this chat until it is resumed">AI paused</Chip>}
                    <LeadChips lead={c.lead} />
                    {stage && (
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full uppercase whitespace-nowrap"
                        style={{ backgroundColor: `${stage.color ?? "#64748b"}1a`, color: stage.color ?? "#64748b" }}
                        title={`${vocab.pipeline.one} stage: ${stage.name}`}>{stage.name}</span>
                    )}
                    {c.assignedTo && <span className="text-[11px] font-bold text-brand-700 truncate" title={`Assigned to ${c.assignedTo}`}><span className="sr-only">Assigned to </span>@{mine ? "You" : c.assignedTo}</span>}
                  </div>
                )}
              </div>
            </button>
            );
          })}
          {loaded && visible.length === 0 && (
            (q || filter !== "all" || platform !== "all" || stageFilter || channelFilter)
              ? <EmptyState mood="searching" title={filter === "waiting" && !q ? "Nobody is waiting for you" : "No conversations match"}
                  body={filter !== "all" ? `Nothing under “${filterLabel}” right now. Clear the search or switch back to All.` : "Try clearing the search, or switch back to All."}
                  action={<button onClick={() => { setSearch(""); setFilter("all"); setPlatform("all"); setStageFilter(""); setChannelFilter(null); }} className="min-h-10 md:min-h-8 px-4 rounded-[8px] border border-line bg-white text-[13px] font-semibold text-ink-800 hover:bg-canvas">Show all chats</button>} />
              : <EmptyState mood="sleeping" title="No conversations yet"
                  body="When someone messages one of your connected channels, the chat lands here." />
          )}
        </div>
      </aside>

      {selected && showThread
        ? <ChatView key={selected} id={selected} onChanged={load} goTo={goTo} crm={crmOn ? crmChats : null} crmError={crmErr}
            refs={refs} now={now} onBack={twoPane ? null : backToList} detailsColumn={threePane} />
        : showThread && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-500 bg-canvas/40">
            <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><MessageSquare className="w-6 h-6" aria-hidden /></div>
            <p className="text-sm font-medium">Select a conversation to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Send an approved template from Live Chat — the ONLY message type Meta allows
// outside the 24h window. Scoped to APPROVED templates with no media header and
// no header variable (sendTemplateSingle only fills BODY {{n}}); richer
// templates (media headers etc.) are sent from the Broadcast tab.
function TemplateComposer({ channelId, busy, onSend, onClose }: {
  channelId?: string | null;
  busy: boolean;
  onSend: (p: { templateName: string; languageCode: string; bodyParams: string[]; preview: string }) => void;
  onClose: () => void;
}) {
  type Tpl = { name: string; status: string; language: string; category: string; components?: { type: string; format?: string; text?: string }[] };
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [selKey, setSelKey] = useState("");          // `${name}|${language}`
  const [vars, setVars] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/templates${channelId ? `?channelId=${channelId}` : ""}`)
      .then(r => r.json()).then(d => setTpls(d.templates ?? [])).catch(() => setTpls([]))
      .finally(() => setLoading(false));
  }, [channelId]);

  const bodyText = (t: Tpl) => t.components?.find(c => c.type === "BODY")?.text ?? "";
  const varsOf = (t: Tpl) => Math.max(0, ...(bodyText(t).match(/\{\{(\d+)\}\}/g) ?? []).map(m => parseInt(m.replace(/\D/g, ""), 10)));
  // Quick-sendable: no media header, no header variable (we only fill BODY {{n}}).
  const sendable = (t: Tpl) => {
    const h = t.components?.find(c => c.type === "HEADER");
    if (h?.format && h.format !== "TEXT") return false;
    if (h && /\{\{\d+\}\}/.test(h.text ?? "")) return false;
    return true;
  };
  const approved = tpls.filter(t => t.status === "APPROVED");
  const usable = approved.filter(sendable);
  const hiddenCount = approved.length - usable.length;
  const selected = usable.find(t => `${t.name}|${t.language}` === selKey);
  const varCount = selected ? varsOf(selected) : 0;

  function pick(k: string) {
    setSelKey(k);
    const t = usable.find(x => `${x.name}|${x.language}` === k);
    setVars(Array(t ? varsOf(t) : 0).fill(""));
  }
  function preview(): string {
    if (!selected) return "";
    return bodyText(selected).replace(/\{\{(\d+)\}\}/g, (_, d) => vars[Number(d) - 1]?.trim() || `{{${d}}}`);
  }
  const filled = varCount === 0 || vars.slice(0, varCount).every(v => v.trim());

  return (
    <div className="border border-line rounded-[10px] bg-canvas/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-ink-600 uppercase tracking-[0.06em] flex items-center gap-1.5"><LayoutTemplate className="w-3.5 h-3.5" /> Send approved template</p>
        <button onClick={onClose} aria-label="Close templates" className="w-8 h-8 -m-1.5 flex items-center justify-center rounded-full text-ink-500 hover:text-ink-900 hover:bg-white"><X className="w-4 h-4" aria-hidden /></button>
      </div>
      {loading ? (
        <p className="text-[11px] text-ink-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading templates…</p>
      ) : usable.length === 0 ? (
        <p className="text-[11px] text-ink-400">No quick-sendable approved templates{hiddenCount > 0 ? ` (${hiddenCount} with media headers — use the Broadcast tab)` : ""}. Create one in the <b>Templates</b> tab.</p>
      ) : (
        <>
          <select className={`${inp} w-full`} value={selKey} onChange={e => pick(e.target.value)}>
            <option value="">Choose a template…</option>
            {usable.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language} · {t.category}</option>)}
          </select>
          {selected && varCount > 0 && (
            <div className="space-y-1.5">
              {Array.from({ length: varCount }).map((_, i) => (
                <input key={i} className={`${inp} w-full text-xs`} placeholder={`Value for {{${i + 1}}}`} value={vars[i] ?? ""} onChange={e => setVars(prev => { const next = [...prev]; next[i] = e.target.value; return next; })} />
              ))}
            </div>
          )}
          {selected && <p className="text-[12px] text-ink-600 bg-white border border-line rounded-control px-2.5 py-1.5 whitespace-pre-wrap break-words">{preview()}</p>}
          {hiddenCount > 0 && <p className="text-[12px] text-ink-500">{hiddenCount} template{hiddenCount > 1 ? "s" : ""} with media headers hidden — send those from the Broadcast tab.</p>}
          <div className="flex items-center justify-end">
            <button
              onClick={() => selected && onSend({ templateName: selected.name, languageCode: selected.language, bodyParams: vars.slice(0, varCount).map(v => v.trim()), preview: preview() })}
              disabled={busy || !selected || !filled}
              className="h-11 md:h-8 px-3 rounded-[8px] bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-semibold disabled:opacity-60 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send template</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// A reply shown in the thread the moment it is sent, before the server has it.
type PendingReply = { tempId: string; body: string; buttons: string[]; createdAt: string; state: "sending" | "failed"; error?: string };

// Middle thread + contact details for one conversation. `onBack` is set on a
// phone, where the thread replaces the list; `detailsColumn` puts the details
// in a third column (wide screens) instead of a side panel.
function ChatView({ id, onChanged, goTo, crm, crmError, refs, now, onBack, detailsColumn }: {
  id: string; onChanged: () => unknown; goTo: (t: Tab) => void; crm?: CrmChatMap | null; crmError?: string;
  refs: InboxRefs; now: number; onBack: (() => void) | null; detailsColumn: boolean;
}) {
  const { vocab } = useVocab();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [thread, setThread] = useState<"loading" | "ok" | "error">("loading");
  const [threadError, setThreadError] = useState("");
  const [retryingThread, setRetryingThread] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Wide screens can fold the details column away; remembered in this browser.
  const [detailsHidden, setDetailsHidden] = useState(() => readLocal(DETAILS_KEY) === "0");
  const toggleDetailsColumn = () => { const next = !detailsHidden; setDetailsHidden(next); writeLocal(DETAILS_KEY, next ? "0" : "1"); };
  const [showMore, setShowMore] = useState(false);
  const [pending, setPending] = useState<PendingReply[]>([]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [showProfile, setShowProfile] = useState(false);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  // Per-message channel log: when the customer has talked to MORE THAN ONE of
  // our numbers/accounts, label each message with the number it went through.
  const threadChannels = useChannelList();
  const channelName = (cid?: string | null) => threadChannels.find(c => c.id === cid)?.name ?? null;
  // Which of our numbers a message went through, said so it can't be misread.
  // Numbers are often named after the person who works them ("Kushal"), and
  // "via Kushal" under a CUSTOMER's message read as though Kushal had written
  // it. So: received on / sent from, and the word "number" (or "account").
  const channelNote = (m: { role: string; channelId?: string | null }) => {
    const ch = threadChannels.find(c => c.id === m.channelId);
    if (!ch?.name) return null;
    const noun = (ch.kind ?? "whatsapp") === "whatsapp" ? "number" : "account";
    return `${m.role === "user" ? "received on" : "sent from"} the \u201c${ch.name}\u201d ${noun}`;
  };
  const multiChannelThread = new Set(messages.map(m => m.channelId).filter(Boolean)).size > 1;
  // Ownership trail: where the lead came from and who has held it since.
  const [ownerHistory, setOwnerHistory] = useState<OwnerHistoryRow[]>([]);
  // Broadcast batches this lead is in, so an agent can add them to one straight
  // from the chat instead of going hunting in Contacts.
  const [leadBatches, setLeadBatches] = useState<{ id: string; name: string }[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  // The customer is free to message any of our numbers, but ownership is sticky
  // — so flag it when their latest message landed somewhere other than the
  // owner, since that's where a reply would NOT go.
  const lastChannelMsg = [...messages].reverse().find(m => m.channelId);
  const offOwnerChannel = conv?.channelId && lastChannelMsg?.channelId && lastChannelMsg.channelId !== conv.channelId
    ? lastChannelMsg.channelId : null;
  // The draft is kept per chat for this visit, so Back on a phone doesn't lose it.
  const [reply, setReplyState] = useState(() => drafts.get(id) ?? "");
  const setReply = (v: string) => { setReplyState(v); if (v) drafts.set(id, v); else drafts.delete(id); };
  const [busy, setBusy] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [btns, setBtns] = useState<string[]>(["", "", ""]);
  const [showQuick, setShowQuick] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  // Fetched once by the inbox, not once per opened chat.
  const { quickReplies, team, aiPrompts, canned, aiAgents, allBatches } = refs;
  const [showAssist, setShowAssist] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [actError, setActError] = useState("");
  // What the last hand-over said back — which number took the lead, and whether it
  // has left this person's inbox. Shown, not swallowed: a chat that leaves the
  // inbox with no explanation reads as the conversation having been lost.
  const [handNotice, setHandNotice] = useState("");
  const [showTemplate, setShowTemplate] = useState(false);
  const [reactMsgId, setReactMsgId] = useState<string | null>(null);
  const [contact, setContact] = useState<{ email: string | null; tags: string[]; attributes: Record<string, string> } | null>(null);
  const [crmSourceSnap, setCrmSourceSnap] = useState<{ configured: boolean; lead: { source: string | null } | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // The reply box starts one line tall and grows with what is typed (to ~8 lines).
  const replyBox = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = replyBox.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
  }, [reply]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCount = useRef(0);

  // A failed first load shows an error with Retry; a failed poll after that
  // keeps the thread on screen and says so above the reply box.
  const load = useCallback(async () => {
    let status: number | null = null;
    try {
      const r = await fetch(`/api/admin/conversations/${id}`);
      status = r.status;
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      setConv(d.conversation ?? null); setMessages(d.messages ?? []); setOwnerHistory(d.ownerHistory ?? []); setLeadBatches(d.batches ?? []);
      setThread("ok"); setThreadError("");
    } catch {
      setThreadError(fetchProblem(status));
      setThread(t => (t === "ok" ? "ok" : "error"));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const retryThread = async () => { setRetryingThread(true); try { await load(); } finally { setRetryingThread(false); } };

  async function leadBatchAction(action: "addToBatch" | "removeFromBatch", batchId: string, label: string) {
    setBatchBusy(true); setActError("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, batchId }),
      });
      const d = await res.json();
      if (!res.ok) { setActError(d.error || "That didn't work."); return; }
      // The server owns the truth (and reports "already a member"), so re-read
      // rather than guessing the new state here.
      if (d.alreadyIn) setActError(`Already in ${label}.`);
      load();
    } finally { setBatchBusy(false); }
  }
  // Live thread: poll every 4s so inbound messages, AI replies, and flow
  // sends appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void load(); }, 4_000);
    return () => clearInterval(t);
  }, [load]);
  // Contact card (tags + attributes collected by flows/forms/AI functions).
  // Web-chat/IG conversations are keyed by an opaque id, not a phone — their
  // contact record lives under the CAPTURED number (lead_phone), so look that
  // up first; WhatsApp chats keep using their own number.
  useEffect(() => {
    const key = conv?.leadPhone || conv?.phone;
    if (!key) return;
    fetch(`/api/admin/contacts?search=${encodeURIComponent(key)}&limit=1`).then(r => r.json())
      .then(d => { const c = (d.contacts ?? [])[0]; setContact(c ? { email: c.email, tags: c.tags ?? [], attributes: c.attributes ?? {} } : null); })
      .catch(() => {});
    setCrmSourceSnap(null);
    fetch(`/api/admin/contacts/crm?phone=${encodeURIComponent(key)}`).then(r => r.json()).then(setCrmSourceSnap).catch(() => {});
  }, [conv?.phone, conv?.leadPhone]);
  // Stick to the bottom when new messages arrive (jump on first paint), and
  // when a reply is sent. No smooth scroll for people who asked for less motion.
  const shownCount = messages.length + pending.length;
  useEffect(() => {
    if (shownCount !== prevCount.current) {
      const calm = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      bottomRef.current?.scrollIntoView?.({ behavior: prevCount.current === 0 || calm ? "auto" : "smooth", block: "end" });
      prevCount.current = shownCount;
    }
  }, [shownCount]);

  async function applyAssist(promptId: string) {
    if (!reply.trim()) return;
    setAssisting(true);
    try {
      const d = await fetch("/api/admin/ai/transform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptId, text: reply }) }).then(r => r.json());
      if (d.result) setReply(d.result);
    } finally { setAssisting(false); setShowAssist(false); }
  }

  // Draft a fresh reply from the knowledge base + this conversation (the same
  // grounded pipeline the bot uses), and drop it into the box for review/edit.
  // Unlike ✨ (which rewrites what you typed), this writes from scratch.
  async function draftReply() {
    setDrafting(true); setActError("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "suggest" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setActError(d.error ?? `Couldn't draft a reply (HTTP ${res.status})`); return; }
      if (d.suggestion?.trim()) setReply(d.suggestion.trim());
      else setActError("Nothing in the knowledge base to draft from — type your own reply.");
    } catch { setActError("Could not reach the server"); }
    finally { setDrafting(false); }
  }

  // Push this lead to the next phase. Its own fetch rather than act(), because the
  // server's answer matters here: which number took it, whether it has left this
  // person's inbox, and — when a team works several numbers — the list to choose
  // from instead of a guess.
  async function handToTeam(team: Team, channelId?: string) {
    setBusy(true); setActError(""); setHandNotice("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "handToTeam", team, ...(channelId ? { channelId } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setActError(d.error ?? `Failed (HTTP ${res.status})`); return; }
      setHandNotice(d.alreadyThere ? `Already on a ${TEAM_SHORT[team]} number.` : (d.notice ?? "Handed over."));
      load(); onChanged();
    } catch { setActError("Could not reach the server"); }
    finally { setBusy(false); }
  }

  // Ask LeadSquared who owns this lead right now and apply it.
  async function syncCrmOwner() {
    setBusy(true); setActError(""); setHandNotice("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "syncCrmOwner" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setActError(d.error ?? `Failed (HTTP ${res.status})`); return; }
      setHandNotice(d.moved ? `Moved — ${d.note}` : `No change — ${d.note}`);
      load(); onChanged();
    } catch { setActError("Could not reach the server"); }
    finally { setBusy(false); }
  }

  async function act(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setActError("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setActError(d.error ?? `Failed (HTTP ${res.status})`); return false; }
      load(); onChanged(); return true;
    } catch { setActError("Could not reach the server"); return false; }
    finally { setBusy(false); }
  }
  // Optimistic send: the reply appears in the thread at once as "Sending…".
  // On success the server's copy replaces it; on failure it stays, marked
  // "Not sent", with Retry and Edit (which puts the text back in the box) —
  // nothing typed is ever lost.
  async function sendReply(retry?: PendingReply) {
    const body = retry ? retry.body : reply.trim();
    if (!body) return;
    // A retry only for a reply still marked "Not sent" — the toast's Retry and
    // the bubble's can't both send it.
    if (retry && !pendingRef.current.some(x => x.tempId === retry.tempId && x.state === "failed")) return;
    const buttons = retry ? retry.buttons : btns.map(b => b.trim()).filter(Boolean);
    const p: PendingReply = retry
      ? { ...retry, state: "sending", error: undefined }
      : { tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, body, buttons, createdAt: new Date().toISOString(), state: "sending" };
    setPending(list => (retry ? list.map(x => (x.tempId === p.tempId ? p : x)) : [...list, p]));
    if (!retry) { setReply(""); setBtns(["", "", ""]); setShowButtons(false); }
    setActError("");
    try {
      const res = await fetch(`/api/admin/conversations/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", body, ...(buttons.length ? { buttons } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? `The server answered ${res.status}`);
      await load();
      setPending(list => list.filter(x => x.tempId !== p.tempId));
      void onChanged();
    } catch (e) {
      const why = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't reach the server";
      setPending(list => list.map(x => (x.tempId === p.tempId ? { ...x, state: "failed", error: why } : x)));
      toast({ tone: "error", text: `Message not sent. ${why}`, action: { label: "Retry", onClick: () => void sendReply({ ...p, state: "failed" }) } });
    }
  }
  function editFailed(p: PendingReply) {
    setPending(list => list.filter(x => x.tempId !== p.tempId));
    setReply(reply.trim() ? `${reply}\n${p.body}` : p.body);
    if (p.buttons.length) { setBtns([0, 1, 2].map(i => p.buttons[i] ?? "")); setShowButtons(true); }
  }
  // Send a photo/video/file to the customer: upload to public storage, then send
  // it via WhatsApp/IG. Any text in the box rides along as the caption (WhatsApp).
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";                       // allow re-picking the same file
    if (!file) return;
    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
    setUploading(true); setActError("");
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd }).then(r => r.json()).catch(() => ({}));
      if (!up.url) { setActError(up.error || "Upload failed"); return; }
      const ok = await act({ action: "media", url: up.url, kind, mediaType: file.type, caption: reply.trim() || undefined });
      if (ok) setReply("");
    } finally { setUploading(false); }
  }
  async function sendTemplate(p: { templateName: string; languageCode: string; bodyParams: string[]; preview: string }) {
    const ok = await act({ action: "template", ...p });
    if (ok) setShowTemplate(false);
  }
  // Free-form replies only deliver inside Meta's 24h window; outside it the agent
  // must send an approved template. WhatsApp only — IG/Messenger have no template
  // path, and web chat has no window.
  const windowClosed = !!conv && conv.platform === "whatsapp" &&
    (!conv.lastInboundAt || Date.now() - new Date(conv.lastInboundAt).getTime() > 24 * 60 * 60 * 1000);
  // Tap-react on a message — WhatsApp only, mirrors what the customer can do.
  const canReact = !!conv && conv.platform !== "instagram" && conv.platform !== "messenger" && conv.platform !== "webchat";
  async function reactTo(metaMessageId: string, emoji: string) {
    setReactMsgId(null);
    await act({ action: "react", targetMessageId: metaMessageId, emoji });
  }

  return (
    <>
      {/* ── Middle: thread ── */}
      <section aria-label={conv ? `Chat with ${contactDisplayName(conv)}` : "Chat"} className="flex-1 flex flex-col min-w-0 min-h-0">
        {(() => {
          // Where this chat stands, as yesterday's small tags beside the name:
          // the wait (grey → amber → red against the reply target), anything a
          // person must act on, the number it's on, LeadSquared and the lead read.
          const wait = conv?.needsReply ? waitInfo(conv.lastInboundAt, refs.replyTarget, now) : null;
          const tags = conv ? (
            <>
              {wait && <WaitChip info={wait} />}
              {conv.status === "escalated" && <Chip tone="red">Needs a person</Chip>}
              {conv.status === "paused" && <Chip tone="grey">Paused</Chip>}
              {!conv.botEnabled && <Chip tone="grey" title="The AI won't reply in this chat until it is resumed">AI paused</Chip>}
              {conv.channelId && <ChannelNameBadge channelId={conv.channelId} />}
              {crm && <CrmChatPill status={crmStatusFor(conv, crm)} lastError={crmError ?? ""} />}
              <LeadChips lead={conv.lead} />
            </>
          ) : null;
          const iconBtn = "inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 rounded-full md:rounded-control text-ink-600 hover:text-ink-900 hover:bg-canvas";
          return (
            <div className="shrink-0 border-b border-line bg-white">
              <div className="min-h-14 px-2 md:px-5 py-2 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0 flex items-center gap-2 md:gap-3">
                  {onBack && (
                    <button type="button" onClick={onBack} aria-label="Back to chats"
                      className="shrink-0 w-11 h-11 -ml-1 rounded-full flex items-center justify-center text-ink-700 hover:bg-canvas">
                      <ArrowLeft className="w-5 h-5" aria-hidden />
                    </button>
                  )}
                  <ConvAvatar url={conv?.avatarUrl} label={conv ? contactDisplayName(conv) : "?"} size={36} />
                  {/* The name keeps its room; the tags have a row of their own below. */}
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-ink-900 truncate leading-tight">{conv ? contactDisplayName(conv) : "Conversation"}</h2>
                    {conv && <p className={`text-[11px] text-ink-500 leading-tight truncate ${subtitleIsPhone(conv) ? "font-mono" : ""}`}>{contactSubtitle(conv)}</p>}
                  </div>
                </div>
                {conv && (
                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    {/* Wide screens: yesterday's buttons — filled when the AI is paused (the action to take). */}
                    <button disabled={busy} onClick={() => act({ action: "bot", enabled: !conv.botEnabled })}
                      title={conv.botEnabled ? "Pause the AI for this chat" : "Let the AI reply in this chat again"}
                      className={`hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border font-semibold disabled:opacity-60 ${conv.botEnabled ? "border-line text-ink-700 hover:bg-canvas" : "border-brand-700 bg-brand-700 text-white hover:bg-brand-600"}`}>
                      {conv.botEnabled ? <><CirclePause className="w-3.5 h-3.5" aria-hidden /> Pause AI</> : <><Bot className="w-3.5 h-3.5" aria-hidden /> Resume AI</>}
                    </button>
                    {conv.status !== "escalated"
                      ? <button disabled={busy} onClick={() => act({ action: "status", status: "escalated" })} title="Flag this chat for a person on your team"
                          className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border border-red-200 text-red-700 font-semibold hover:bg-red-50 disabled:opacity-60"><UserRound className="w-3.5 h-3.5" aria-hidden /> Needs a person</button>
                      : <button disabled={busy} onClick={() => act({ action: "status", status: "active" })} title="A person has it — clear the flag"
                          className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border border-line text-ink-700 font-semibold hover:bg-canvas disabled:opacity-60"><Check className="w-3.5 h-3.5" aria-hidden /> Mark handled</button>}
                    {/* Phones and tablets: the same two switches in a menu, so the name keeps its room. */}
                    <div className="relative lg:hidden">
                      <button type="button" onClick={() => setShowMore(o => !o)} aria-label="Chat actions" aria-haspopup="menu" aria-expanded={showMore} className={iconBtn}>
                        <EllipsisVertical className="w-5 h-5 md:w-4 md:h-4" aria-hidden />
                      </button>
                      {showMore && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setShowMore(false)} aria-hidden />
                          <div role="menu" aria-label="Chat actions" className="absolute right-0 top-full mt-1 z-20 w-56 bg-white border border-line rounded-[12px] shadow-lg p-1 u-scale-in origin-top-right">
                            <button role="menuitem" disabled={busy} onClick={() => { setShowMore(false); void act({ action: "bot", enabled: !conv.botEnabled }); }}
                              className="w-full min-h-11 md:min-h-8 flex items-center gap-2.5 px-2.5 rounded-[6px] text-[14px] md:text-[13px] text-ink-800 hover:bg-canvas text-left">
                              {conv.botEnabled ? <><CirclePause className="w-4 h-4 text-ink-500" aria-hidden /> Pause AI for this chat</> : <><Bot className="w-4 h-4 text-ink-500" aria-hidden /> Resume AI</>}
                            </button>
                            <button role="menuitem" disabled={busy} onClick={() => { setShowMore(false); void act({ action: "status", status: conv.status === "escalated" ? "active" : "escalated" }); }}
                              className="w-full min-h-11 md:min-h-8 flex items-center gap-2.5 px-2.5 rounded-[6px] text-[14px] md:text-[13px] text-ink-800 hover:bg-canvas text-left">
                              {conv.status === "escalated" ? <><Check className="w-4 h-4 text-ink-500" aria-hidden /> Mark handled</> : <><UserRound className="w-4 h-4 text-red-600" aria-hidden /> Needs a person</>}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                    {/* The details: a column that can be hidden on wide screens, a side panel elsewhere. */}
                    {detailsColumn ? (
                      <button type="button" onClick={() => toggleDetailsColumn()} aria-label="Contact details" aria-pressed={!detailsHidden}
                        title={detailsHidden ? "Show contact details" : "Hide contact details"}
                        className={`${iconBtn} ${!detailsHidden ? "text-brand-700 bg-brand-50 hover:bg-brand-50 hover:text-brand-800" : ""}`}>
                        <PanelRight className="w-4 h-4" aria-hidden />
                      </button>
                    ) : (
                      <button type="button" onClick={() => setShowDetails(true)} aria-label="Contact details" aria-expanded={showDetails} title="Contact details" className={iconBtn}>
                        <PanelRight className="w-5 h-5 md:w-4 md:h-4" aria-hidden />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* Where this chat stands: a row of small tags under the name. */}
              {tags && <div className="flex flex-wrap items-center gap-1.5 px-3 md:px-5 md:pl-[68px] pb-2 -mt-1">{tags}</div>}
              {conv?.lead?.reason && <div className="px-3 md:px-5 py-1.5 border-t border-line bg-white"><LeadReason lead={conv.lead} /></div>}
            </div>
          );
        })()}
        {conv && <ApprovalCard conversationId={conv.id} onDecided={() => { load(); onChanged(); }} />}

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 md:px-6 py-4 space-y-1.5 bg-canvas/60">
          {thread === "loading" && (
            <div aria-busy="true" className="space-y-3 animate-pulse motion-reduce:animate-none">
              <span className="sr-only">Loading this chat…</span>
              {["w-2/3", "w-1/2 ml-auto", "w-3/5", "w-2/5 ml-auto"].map((w, i) => <div key={i} aria-hidden className={`h-10 rounded-2xl bg-white border border-line ${w}`} />)}
            </div>
          )}
          {thread === "error" && (
            <div role="alert" className="flex flex-col items-center text-center gap-3 py-12">
              <div className="w-12 h-12 rounded-full bg-red-50 text-red-700 flex items-center justify-center"><AlertTriangle className="w-5 h-5" aria-hidden /></div>
              <div>
                <p className="text-sm font-bold text-ink-900">Couldn&apos;t load this chat</p>
                <p className="text-[13px] text-ink-600 mt-1">{threadError}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => void retryThread()} disabled={retryingThread} className="min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 inline-flex items-center gap-1.5">
                  {retryingThread ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw className="w-4 h-4" aria-hidden />} Retry
                </button>
                {onBack && <button onClick={onBack} className="min-h-10 px-4 rounded-control border border-line bg-white text-sm font-bold text-ink-800 hover:bg-canvas">Back to chats</button>}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            // WhatsApp-style centered day divider whenever the calendar day changes.
            const dateDivider = startsNewDay(messages, i)
              ? <div className="flex justify-center my-2"><span className="text-[11px] font-semibold text-ink-500 bg-white border border-line rounded-full px-3 py-1 shadow-sm">{dayLabel(m.createdAt)}</span></div>
              : null;
            // Form lifecycle markers render as status cards, not plain bubbles.
            if (m.body === "[form-abandoned]") {
              return <Fragment key={m.id}>{dateDivider}<div className="flex justify-center"><span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1"><AlertTriangle className="w-3 h-3" /> Form not completed</span></div></Fragment>;
            }
            const isComment = m.body.startsWith("[comment] ");
            const commentIsFb = isComment && conv?.platform === "messenger";
            const body = isComment ? m.body.slice(10) : m.body;
            const submitted = body.startsWith("[form] ");
            const sentMatch = body.match(/^([\s\S]*?)\n\[form:\s*(.+?)\]\s*$/);
            const mt = m.mediaType ?? "";
            const isImage = !!m.mediaUrl && mt.startsWith("image/");
            const isVideo = !!m.mediaUrl && mt.startsWith("video/");
            const isAudio = !!m.mediaUrl && mt.startsWith("audio/");
            const isFile = !!m.mediaUrl && !isImage && !isVideo && !isAudio;
            const isMedia = isImage || isVideo || isAudio || isFile;
            // Show the caption/transcript only when it's real text (not the
            // "[image message]" placeholder kept for messages with no caption).
            const hasCaption = isMedia && !!body.trim() && !/^\[.*\]$/.test(body.trim());
            // Group consecutive messages from the same side (same day, not a
            // centered marker): the timestamp shows only on the last of the run,
            // so a burst of bot bubbles reads as one turn, WhatsApp-style.
            const nextM = messages[i + 1];
            const contNext = !!nextM && nextM.role === m.role
              && nextM.body !== "[form-abandoned]" && m.body !== "[form-abandoned]"
              && !startsNewDay(messages, i + 1);
            const reactable = canReact && !isComment && !!m.metaMessageId;
            const reactButton = reactable && (
              <div className="relative shrink-0 self-end mb-1">
                <button
                  onClick={() => setReactMsgId(reactMsgId === m.id ? null : m.id)}
                  aria-label="React to this message" aria-expanded={reactMsgId === m.id}
                  className="md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity w-8 h-8 flex items-center justify-center rounded-full text-ink-400 hover:text-brand-700 hover:bg-white"
                >
                  <SmilePlus className="w-4 h-4" aria-hidden />
                </button>
                {reactMsgId === m.id && (
                  <div className={`absolute z-10 bottom-8 ${m.role === "user" ? "left-0" : "right-0"} flex items-center gap-0.5 bg-white border border-line rounded-full shadow-lg px-1.5 py-1`}>
                    {REACTION_EMOJIS.map(e => (
                      <button key={e} onClick={() => reactTo(m.metaMessageId!, e)} aria-label={`React with ${e}`} className="text-lg leading-none w-9 h-9 flex items-center justify-center rounded-full hover:bg-canvas motion-safe:hover:scale-125 transition-transform">{e}</button>
                    ))}
                  </div>
                )}
              </div>
            );
            return (
              <Fragment key={m.id}>
              {dateDivider}
              <div className={`group flex items-end gap-1 ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                {m.role !== "user" && reactButton}
                <div className={`max-w-[78%] sm:max-w-[68%] xl:max-w-[min(68%,36rem)] min-w-[2.75rem] px-3.5 py-2 text-sm shadow-sm rounded-2xl ${m.role === "user" ? "rounded-bl-md" : "rounded-br-md"} ${submitted ? "bg-emerald-50 border border-emerald-200 text-ink-900" : isComment ? (commentIsFb ? "bg-blue-50 border border-blue-200 text-ink-900" : "bg-pink-50 border border-pink-200 text-ink-900") : m.role === "user" ? "bg-white border border-line text-ink-900" : "bg-brand-100 text-ink-900"}`}>
                  {isComment && <p className={`text-[11px] font-bold mb-0.5 flex items-center gap-1 ${commentIsFb ? "text-blue-600" : "text-pink-600"}`}>{commentIsFb ? <Facebook className="w-3 h-3" /> : <Instagram className="w-3 h-3" />} {m.role === "user" ? "comment" : "comment reply"}</p>}
                  {isMedia ? (
                    <div className="space-y-1.5">
                      {isImage && <a href={m.mediaUrl!} target="_blank" rel="noreferrer"><img src={m.mediaUrl!} alt="Image attachment (opens full size)" className="rounded-lg max-h-72 max-w-full object-cover" /></a>}
                      {isVideo && <video controls preload="metadata" src={m.mediaUrl!} className="rounded-lg max-h-72 max-w-full" />}
                      {isAudio && <>
                        <p className="text-[11px] font-bold text-ink-500 flex items-center gap-1"><Mic className="w-3 h-3" /> Voice note</p>
                        <audio controls preload="none" src={m.mediaUrl!} className="h-10 w-[240px] max-w-full" />
                      </>}
                      {isFile && <a href={m.mediaUrl!} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-brand-700 underline text-[13px] font-semibold"><FileText className="w-4 h-4" /> Download file</a>}
                      {hasCaption && <p className={`whitespace-pre-wrap break-words text-[13px] ${isAudio ? "text-ink-500 italic" : ""}`}>{isAudio ? `“${body}”` : linkify(body)}</p>}
                    </div>
                  ) : submitted ? (
                    <div>
                      <p className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 mb-1"><Check className="w-3 h-3" /> Form submitted</p>
                      <div className="space-y-0.5">
                        {body.slice(7).split(" · ").map((pair, i) => {
                          const idx = pair.indexOf(": ");
                          const k = idx > 0 ? pair.slice(0, idx) : pair;
                          const v = idx > 0 ? pair.slice(idx + 2) : "";
                          return <p key={i} className="text-[12px]"><span className="text-ink-400">{k}:</span> <span className="font-medium">{v}</span></p>;
                        })}
                      </div>
                    </div>
                  ) : sentMatch ? (
                    <div>
                      <p className="whitespace-pre-wrap break-words">{linkify(sentMatch[1])}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand-700"><Send className="w-3 h-3" /> Form sent · {sentMatch[2]}</p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{linkify(body)}</p>
                  )}
                  {!contNext && (
                    <p className={`text-[11px] mt-1 text-right ${m.role === "user" ? "text-ink-500" : "text-brand-900/70"}`}>
                      {m.role === "user" ? "" : m.source === "bot" ? "AI · " : `${vocab.teamMember.one.toLowerCase()} · `}{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {multiChannelThread && channelNote(m) && <span className="ml-1.5 font-semibold opacity-80" title={m.role === "user" ? "The number this message arrived on" : "The number this message was sent from"}>· {channelNote(m)}</span>}
                    </p>
                  )}
                </div>
                {m.role === "user" && reactButton}
              </div>
              </Fragment>
            );
          })}
          {thread === "ok" && messages.length === 0 && pending.length === 0 && <p className="text-center text-ink-500 text-sm py-10">No messages yet.</p>}
          {/* Replies on their way out, shown at once. A server copy that has
              already landed (the 4s poll can beat the send) hides its twin. */}
          <div aria-live="polite" className="space-y-1.5">
            {pending.filter(p => !messages.some(m => m.role === "assistant" && m.source === "agent" && m.body.startsWith(p.body) && Date.parse(m.createdAt) >= Date.parse(p.createdAt) - 60_000)).map(p => (
              <div key={p.tempId} className="flex justify-end">
                <div className={`max-w-[78%] sm:max-w-[68%] xl:max-w-[min(68%,36rem)] px-3.5 py-2 text-sm shadow-sm rounded-2xl rounded-br-md text-ink-900 ${p.state === "failed" ? "bg-red-50 border border-red-200" : "bg-brand-100/70"}`}>
                  <p className="whitespace-pre-wrap break-words">{p.body}</p>
                  {p.buttons.length > 0 && <p className="mt-1 text-[12px] text-ink-600">Buttons: {p.buttons.join(" · ")}</p>}
                  {p.state === "sending" ? (
                    <p className="text-[11px] mt-1 text-right text-brand-900/70 inline-flex w-full justify-end items-center gap-1"><Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden /> Sending…</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[12px]">
                      <span className="inline-flex items-center gap-1 font-bold text-red-700" title={p.error}><AlertTriangle className="w-3.5 h-3.5" aria-hidden /> Not sent</span>
                      <button onClick={() => void sendReply(p)} className="min-h-8 px-2.5 rounded-control bg-white border border-red-200 font-bold text-red-700 hover:bg-red-100">Retry</button>
                      <button onClick={() => editFailed(p)} className="min-h-8 px-2.5 rounded-control bg-white border border-line font-bold text-ink-700 hover:bg-canvas">Edit</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div ref={bottomRef} />
        </div>

        {/* The reply box stays pinned under the thread, and the thread above
            shrinks for the keyboard. On phones the shell's tab bar below already
            clears the home indicator; elsewhere the box does. */}
        {/* The composer. Its optional panels scroll in their own area; the input
            row is outside any clipping box, so the "+" menu that opens upward is
            never cut off, and z-10 keeps it above the messages. */}
        <div className="relative z-10 shrink-0 px-3 md:px-5 pt-2.5 pb-3 md:pb-[max(0.625rem,env(safe-area-inset-bottom))] border-t border-line bg-white">
          <div className="max-h-[40dvh] overflow-y-auto space-y-2 [&:not(:empty)]:mb-2">
          {thread === "ok" && threadError && (
            <p role="status" className="flex items-center gap-2 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-[10px] px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span className="flex-1">Couldn&apos;t refresh this chat. New messages may be missing.</span>
              <button onClick={() => void retryThread()} disabled={retryingThread} className="shrink-0 min-h-8 md:min-h-7 px-2.5 rounded-[8px] border border-amber-300 bg-white font-semibold hover:bg-amber-100 disabled:opacity-60">{retryingThread ? "Retrying…" : "Retry"}</button>
            </p>
          )}
          {actError && (
            <p className="flex items-start gap-1.5 text-[12px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-[10px] px-3 py-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{actError}{/Invalid OAuth|access token|credentials not configured/i.test(actError) ? " — WhatsApp (Meta) credentials are not set yet, so messages can't actually send." : ""}</span>
            </p>
          )}
          {windowClosed && (
            <div className="flex items-center gap-2 text-[13px] text-amber-900 bg-amber-50 border border-amber-200 rounded-[10px] pl-3 pr-1.5 py-1">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <p className="flex-1 min-w-0 py-0.5 lg:truncate" title="Outside WhatsApp's 24-hour window, free-form replies won't deliver. An approved template re-opens the chat (a paid, business-initiated message).">
                24-hour window closed — free-form replies won&apos;t deliver. Send an approved template (paid) to reopen.
              </p>
              {!showTemplate && <button onClick={() => setShowTemplate(true)} className="shrink-0 h-11 md:h-7 px-2.5 rounded-[8px] border border-amber-300 bg-white text-[12px] font-semibold text-amber-900 hover:bg-amber-100">Send template</button>}
            </div>
          )}
          {showTemplate && conv && (
            <TemplateComposer channelId={conv.channelId} busy={busy} onClose={() => setShowTemplate(false)} onSend={sendTemplate} />
          )}
          {showQuick && quickReplies.length > 0 && (
            <div className="flex gap-1.5 flex-wrap max-h-24 overflow-y-auto">
              {quickReplies.map(q => (
                <button key={q.id} onClick={() => { setReply(q.body); setShowQuick(false); }} title={q.body} className="min-h-9 md:min-h-7 px-2.5 rounded-full border border-line text-[12px] font-medium text-ink-700 hover:border-brand-700">/{q.shortcut}</button>
              ))}
            </div>
          )}
          {showAssist && (
            <div className="flex gap-1.5 flex-wrap">
              {aiPrompts.length === 0 && <p className="text-[12px] text-ink-500">No AI prompts yet — add them in the AI Hub tab.</p>}
              {aiPrompts.map(p => (
                <button key={p.id} onClick={() => applyAssist(p.id)} disabled={assisting || !reply.trim()} className="inline-flex items-center gap-1 min-h-9 md:min-h-7 px-2.5 rounded-full border border-brand-100 text-[12px] font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"><Sparkles className="w-3 h-3" aria-hidden /> {p.name}</button>
              ))}
            </div>
          )}
          {showButtons && (
            <div className="grid grid-cols-3 gap-2">
              {btns.map((b, i) => (
                <input key={i} aria-label={`Reply button ${i + 1}`} className={`${inp} !text-base md:!text-xs`} maxLength={20} placeholder={`Button ${i + 1}`} value={b} onChange={e => setBtns(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} />
              ))}
            </div>
          )}
          {/* One-click canned templates (follow-up, post-call follow-up…). WhatsApp only —
              they deliver even outside the 24h window and log to the CRM timeline. */}
          {conv?.platform === "whatsapp" && canned.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {canned.map(c => (
                <button key={c.id} disabled={busy} onClick={() => act({ action: "canned", cannedId: c.id })}
                  title={`Send the "${c.label}" template from this number${c.stage ? ` and set the CRM stage to ${c.stage}` : ""}`}
                  className="min-h-9 md:min-h-7 px-2.5 rounded-full border border-brand-700 text-brand-700 text-[12px] font-semibold hover:bg-brand-50 disabled:opacity-60">
                  {c.label}{c.stage ? ` · ${c.stage}` : ""}
                </button>
              ))}
            </div>
          )}
          </div>
          <div className="flex items-end gap-2">
            {/* 16px text on phones: smaller makes iOS zoom the page on focus. */}
            <textarea ref={replyBox} aria-label="Reply" aria-keyshortcuts="Meta+Enter Control+Enter"
              className="flex-1 min-w-0 resize-none min-h-11 md:min-h-[60px] max-h-40 rounded-control border border-line bg-white px-3 py-[11px] md:py-2 text-base md:text-sm leading-5 text-ink-900 placeholder:text-ink-500"
              rows={onBack ? 1 : 2} placeholder={onBack ? "Type a reply…" : "Type a reply… (type / for quick replies, ⌘↵ to send)"} value={reply}
              onChange={e => { setReply(e.target.value); if (e.target.value === "/") setShowQuick(true); }}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendReply(); } }} />
            {/* mp3/m4a only for audio — WhatsApp accepts aac/amr/mpeg/mp4/ogg-opus, not wav. */}
            <input ref={fileRef} type="file" accept="image/*,video/*,audio/mpeg,audio/mp4,.mp3,.m4a,.pdf,.doc,.docx,.xls,.xlsx" hidden onChange={onPickFile} />
            {/* All composer tools live in one menu so the reply box stays roomy. */}
            <div className="relative">
              <button onClick={() => setShowTools(s => !s)} aria-label="Reply tools" aria-haspopup="menu" aria-expanded={showTools} className={`w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-[10px] border text-sm font-bold ${showTools ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-500 hover:bg-canvas hover:text-ink-900"}`}>
                {drafting || assisting || uploading ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Plus className={`w-4 h-4 motion-safe:transition-transform ${showTools ? "rotate-45" : ""}`} aria-hidden />}
              </button>
              {showTools && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTools(false)} />
                  <div role="menu" aria-label="Reply tools" className="absolute bottom-full right-0 mb-2 w-60 bg-white border border-line rounded-[12px] shadow-lg p-1 z-20 u-scale-in origin-bottom-right">
                    {[
                      { icon: <Zap className="w-4 h-4" />, label: "Quick replies", on: () => setShowQuick(s => !s) },
                      { icon: <Bot className="w-4 h-4" />, label: "Draft from knowledge base", on: draftReply },
                      { icon: <Sparkles className="w-4 h-4" />, label: "Rewrite my draft", on: () => setShowAssist(s => !s) },
                      { icon: <span className="text-base leading-none">⊞</span>, label: "Add reply buttons", on: () => setShowButtons(s => !s) },
                      ...(conv?.platform === "whatsapp" ? [{ icon: <LayoutTemplate className="w-4 h-4" />, label: "Send template", on: () => setShowTemplate(s => !s) }] : []),
                      { icon: <Paperclip className="w-4 h-4" />, label: "Attach photo, file or voice note", on: () => fileRef.current?.click() },
                    ].map(t => (
                      <button key={t.label} role="menuitem" onClick={() => { setShowTools(false); t.on(); }} className="w-full min-h-11 md:min-h-8 flex items-center gap-2.5 px-2.5 rounded-[6px] text-[14px] md:text-[13px] text-ink-800 hover:bg-canvas text-left">
                        <span className="text-ink-500 w-4 flex justify-center" aria-hidden>{t.icon}</span> {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => void sendReply()} disabled={!reply.trim() || thread !== "ok"} aria-label="Send reply"
              className="min-w-11 h-11 md:h-9 px-3 rounded-[10px] bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Send className="w-4 h-4" aria-hidden /><span className="hidden md:inline">Send</span>
            </button>
          </div>
        </div>
      </section>

      {/* ── Contact details: a third column on wide screens, a side panel
          (opened from the header) everywhere else. Built once, shown in one. ── */}
      {(() => {
      const details = (
      <div className="text-sm">
        {/* Who this is — yesterday's centred profile. */}
        <div className="p-5 flex flex-col items-center text-center border-b border-line">
          <ConvAvatar url={conv?.avatarUrl} label={conv ? contactDisplayName(conv) : "?"} size={64} />
          <p className="text-[15px] font-bold text-ink-900 mt-2 max-w-full break-words">{conv ? contactDisplayName(conv) : "Unknown"}</p>
          {conv && <p className={`text-xs text-ink-500 ${subtitleIsPhone(conv) ? "font-mono" : ""}`}>{contactSubtitle(conv)}</p>}
          {contact?.email && <p className="text-xs text-ink-500 mt-0.5 max-w-full truncate" title={contact.email}>{contact.email}</p>}
          {conv?.phone && (
            <button onClick={() => setShowProfile(true)} className="mt-3 min-h-11 md:min-h-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" aria-hidden /> AI brief &amp; full profile
            </button>
          )}
        </div>

        {/* pb-24: the floating support-chat button sits over the bottom-right corner;
            the last control can always be scrolled clear of it. */}
        <div className="p-4 pb-24 space-y-4">
          {conv && (
            <>
              <DetailsSection id="labels" title="Labels" icon={<Tag />}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(conv.labels ?? []).map(l => (
                    <span key={l} className="inline-flex items-center gap-0.5 h-7 md:h-6 pl-2 pr-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
                      {l}
                      <button disabled={busy} onClick={() => act({ action: "labels", labels: (conv.labels ?? []).filter(x => x !== l) })} aria-label={`Remove label ${l}`} className="w-6 h-6 md:w-5 md:h-5 flex items-center justify-center rounded-full text-brand-700/60 hover:text-red-600 hover:bg-white"><X className="w-3 h-3" aria-hidden /></button>
                    </span>
                  ))}
                  <input
                    aria-label="Add a label"
                    className="h-9 md:h-6 w-24 rounded-full border border-line bg-white px-2.5 text-base md:text-[11px] placeholder:text-ink-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    placeholder="+ label" value={labelInput} onChange={e => setLabelInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && labelInput.trim()) { act({ action: "labels", labels: [...(conv.labels ?? []), labelInput.trim()] }); setLabelInput(""); } }}
                  />
                </div>
              </DetailsSection>

              <CustomerWork phone={conv.phone} conversationId={conv.id} />

              <CustomerAutomations conversationId={conv.id} />

              <ChatNotes conversationId={conv.id} />

              <DetailsSection id="assigned" title="Assigned to" icon={<UserCheck />}>
                <select disabled={busy} className={detailsControl} aria-label="Assigned to"
                  value={conv.assignedTo ?? ""}
                  onChange={e => act({ action: "assign", assignedTo: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {/* Keep a legacy free-text assignee selectable until reassigned */}
                  {conv.assignedTo && !team.some(m => m.name === conv.assignedTo) && (
                    <option value={conv.assignedTo}>{conv.assignedTo}</option>
                  )}
                  {team.map(m => (
                    <option key={m.email} value={m.name}>{m.name}{m.title ? ` — ${m.title}` : ""}</option>
                  ))}
                </select>
                {(() => { const m = team.find(x => x.name === conv.assignedTo); return m?.title ? <p className="text-[11px] text-ink-500 mt-1">{m.title}</p> : null; })()}
              </DetailsSection>

              {aiAgents.length > 0 && (
                <DetailsSection id="ai-assistant" title="AI assistant" icon={<Sparkles />}>
                  <select disabled={busy} className={detailsControl} aria-label="AI assistant for this chat"
                    value={conv.agentId ?? ""}
                    onChange={e => act({ action: "agent", agentId: e.target.value || null })}>
                    <option value="">Auto / default{(() => { const a = aiAgents.find(x => x.active); return a ? ` (${a.name})` : ""; })()}</option>
                    {aiAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </DetailsSection>
              )}

              {/* ── Lead journey: which number owns this lead, and its trail ──
                  Ownership is sticky: the customer can message any of our
                  numbers/accounts, but replies always leave from the owner below
                  until someone deliberately hands the lead over. */}
              {(() => {
                const owners = threadChannels.filter(c => c.active && (c.kind ?? "whatsapp") === (conv.platform ?? "whatsapp"));
                if (owners.length < 2 && !ownerHistory.length) return null;   // single-number workspace — nothing to show
                const firstTouch = ownerHistory[0];
                return (
                  <DetailsSection id="journey" title={`${vocab.lead.one} journey`} icon={<History />}>

                    {offOwnerChannel && (
                      <div className="mb-2 rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-2">
                        <p className="text-[12px] text-amber-900 leading-relaxed">
                          <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-1" aria-hidden />
                          Their latest message came in on <b>{channelName(offOwnerChannel) ?? "another number"}</b>, but replies still go out from <b>{channelName(conv.channelId) ?? "the owner"}</b>.
                        </p>
                        <button
                          disabled={busy}
                          onClick={() => act({ action: "reassignChannel", channelId: offOwnerChannel, reason: "Customer moved to this number" })}
                          className="mt-1.5 h-11 md:h-7 px-2.5 rounded-[8px] bg-amber-600 hover:bg-amber-700 text-white text-[12px] font-semibold disabled:opacity-60">
                          Hand over to {channelName(offOwnerChannel) ?? "that number"}
                        </button>
                      </div>
                    )}

                    {/* Hand the lead to the NEXT PHASE. The funnel is marketing → sales →
                        ops, so this offers only the step forward; sideways or backwards
                        moves stay on the picker below, where the person is choosing a
                        number knowingly. Appears only once numbers have teams. */}
                    {(() => {
                      const curTeam = (threadChannels.find(c => c.id === conv.channelId)?.team ?? null) as Team | null;
                      const to = nextTeam(curTeam);
                      if (!to) return null;
                      const targets = owners.filter(c => c.team === to);
                      if (!targets.length) return null;
                      return (
                        <div className="mb-2">
                          {targets.length === 1 ? (
                            <button
                              disabled={busy}
                              onClick={() => handToTeam(to)}
                              title={`Move this ${vocab.lead.one.toLowerCase()} onto ${targets[0].name}, the ${TEAM_SHORT[to]} number. Replies then go out from there.`}
                              className={`${detailsButton} w-full`}>
                              Hand to {TEAM_SHORT[to]} → {targets[0].name}
                            </button>
                          ) : (
                            <select
                              disabled={busy}
                              defaultValue=""
                              aria-label={`Hand to ${TEAM_SHORT[to]}`}
                              onChange={e => { if (e.target.value) { void handToTeam(to, e.target.value); e.target.value = ""; } }}
                              className={`${detailsControl} font-medium`}>
                              <option value="">Hand to {TEAM_SHORT[to]} …</option>
                              {targets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </div>
                      );
                    })()}

                    {conv.platform === "whatsapp" && crm && (
                      <button
                        disabled={busy}
                        onClick={() => void syncCrmOwner()}
                        title={`Read this ${vocab.lead.one.toLowerCase()}'s owner from LeadSquared and move the chat onto that person's number.`}
                        className={`${detailsButton} w-full mb-2`}>
                        Sync owner from LeadSquared
                      </button>
                    )}

                    {handNotice && (
                      <p className="mb-2 text-[12px] text-ink-700 bg-canvas rounded-[8px] px-2.5 py-1.5 leading-relaxed">{handNotice}</p>
                    )}

                    <label htmlFor={`owner-${conv.id}`} className="block text-[11px] text-ink-500 mb-1">Replies go out from</label>
                      <select
                        id={`owner-${conv.id}`}
                        disabled={busy}
                        className={detailsControl}
                        value={conv.channelId ?? ""}
                        onChange={e => e.target.value && act({ action: "reassignChannel", channelId: e.target.value, reason: "Reassigned from Live Chat" })}
                      >
                        {!conv.channelId && <option value="">— not set —</option>}
                        {owners.map(c => <option key={c.id} value={c.id}>{c.name}{c.coex ? " (app+API)" : ""}</option>)}
                      </select>

                    {firstTouch && (
                      <p className="text-[12px] text-ink-500 mt-2">
                        Came in via <span className="font-medium text-ink-700">{channelName(firstTouch.channelId) ?? "unknown number"}</span> · {stampShort(firstTouch.createdAt)}
                      </p>
                    )}
                    {ownerHistory.length > 1 && (
                      <div className="mt-1.5 border-l border-line pl-2.5 space-y-1">
                        {ownerHistory.slice(1).map(h => (
                          <p key={h.id} className="text-[12px] text-ink-500 leading-snug">
                            <ArrowRight className="w-3 h-3 inline -mt-0.5 mr-0.5" aria-hidden />
                            <span className="font-medium text-ink-700">{channelName(h.channelId) ?? "unknown number"}</span>
                            {h.changedBy !== "system" && <> by {h.changedBy}</>} · {stampShort(h.createdAt)}
                          </p>
                        ))}
                      </div>
                    )}
                  </DetailsSection>
                );
              })()}
            </>
          )}

          {(() => {
            const source = crmSourceSnap?.lead?.source || localSourceLabel(contact?.attributes);
            const utmSource = contact?.attributes?.utm_source;
            const utmMedium = contact?.attributes?.utm_medium;
            if (!source && !utmSource && !utmMedium) return null;
            return (
              <DetailsSection id="source" title="Source" icon={<Megaphone />}>
                {source && <p className="text-[13px] font-medium text-ink-900" title={crmSourceSnap?.lead?.source ? "From LeadSquared" : "From this chat's captured attribution"}>{source}</p>}
                {(utmSource || utmMedium) && (
                  <p className="text-[12px] text-ink-500 mt-0.5 flex gap-3 flex-wrap">
                    {utmSource && <span>utm_source: <span className="font-medium text-ink-700">{utmSource}</span></span>}
                    {utmMedium && <span>utm_medium: <span className="font-medium text-ink-700">{utmMedium}</span></span>}
                  </p>
                )}
              </DetailsSection>
            );
          })()}

          {/* Broadcast batches. The agent on a live chat is the person who knows
              this lead belongs in "Aug weekend batch" — making them leave, find
              the contact and tick a row is how it never gets done. */}
          <DetailsSection id="batches" title="Batches" icon={<Layers />}>
            {leadBatches.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mb-1.5">
                {leadBatches.map(b => (
                  <span key={b.id} className="inline-flex items-center gap-0.5 h-7 md:h-6 pl-2 pr-0.5 rounded-full bg-canvas border border-line text-ink-800 text-[12px] font-medium">
                    {b.name}
                    <button disabled={batchBusy} onClick={() => leadBatchAction("removeFromBatch", b.id, b.name)}
                      title={`Remove from ${b.name}`}
                      aria-label={`Remove from ${b.name}`}
                      className="w-6 h-6 md:w-5 md:h-5 flex items-center justify-center rounded-full text-ink-500 hover:bg-white hover:text-red-600 disabled:opacity-40"><X className="w-3 h-3" aria-hidden /></button>
                  </span>
                ))}
              </div>
            )}
            {(() => {
              // Only static batches — a dynamic one's membership is its filter,
              // so adding one person would do nothing at send time.
              const addable = allBatches.filter(b => b.kind === "static" && !leadBatches.some(x => x.id === b.id));
              if (!allBatches.length) return <p className="text-[12px] text-ink-500">No batches yet — create one under {vocab.contact.many} › Batches.</p>;
              if (!addable.length) return <p className="text-[12px] text-ink-500">In every batch available.</p>;
              return (
                <select disabled={batchBusy} value="" aria-label={`Add this ${vocab.lead.one.toLowerCase()} to a batch`}
                  onChange={e => {
                    const b = addable.find(x => x.id === e.target.value);
                    if (b) leadBatchAction("addToBatch", b.id, b.name);
                  }}
                  className={detailsControl}>
                  <option value="">{batchBusy ? "Saving…" : `Add to a batch…`}</option>
                  {addable.map(b => <option key={b.id} value={b.id}>{b.name} · {b.size.toLocaleString()}</option>)}
                </select>
              );
            })()}
          </DetailsSection>

          {contact && contact.tags.length > 0 && (
            <DetailsSection id="tags" title={`${vocab.contact.one} tags`} icon={<Tag />}>
              <div className="flex gap-1.5 flex-wrap">
                {contact.tags.map(t => <span key={t} className="px-2 h-6 inline-flex items-center rounded-full bg-canvas text-ink-700 text-[12px]">{t}</span>)}
              </div>
            </DetailsSection>
          )}

          {contact && Object.keys(contact.attributes).length > 0 && (
            <DetailsSection id="collected" title="Details collected" icon={<ClipboardList />}>
              <dl className="divide-y divide-line/70">
                {Object.entries(contact.attributes).map(([k, v]) => {
                  const value = String(v ?? "");
                  const ownLine = value.length > 48 || (!/\s/.test(value) && value.length > 28);
                  return <div key={k} className={`py-1.5 gap-3 ${ownLine ? "" : "flex items-start justify-between"}`}>
                    <dt className="text-[12px] text-ink-500 capitalize shrink-0">{k.replaceAll("_", " ")}</dt>
                    <dd className={ownLine ? "mt-0.5 block max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-[13px] text-ink-900" : "min-w-0 text-[13px] text-ink-900 text-right break-words"}>{value}</dd>
                  </div>;
                })}
              </dl>
            </DetailsSection>
          )}
        </div>
      </div>
      );
      return detailsColumn
        ? (detailsHidden ? null : <aside aria-label="Contact details" className="w-80 shrink-0 border-l border-line overflow-y-auto overscroll-contain bg-white">{details}</aside>)
        : <Drawer open={showDetails} onClose={() => setShowDetails(false)} title="Contact details" subtitle={conv ? contactDisplayName(conv) : undefined} width="md">
            <div className="-mx-5 -my-4">{details}</div>
          </Drawer>;
      })()}
      {showProfile && conv?.phone && <ContactProfile phone={conv.leadPhone || conv.phone} onClose={() => setShowProfile(false)} onChanged={() => { load(); onChanged(); }} goTo={goTo} />}
    </>
  );
}

export default LiveChatTab;
