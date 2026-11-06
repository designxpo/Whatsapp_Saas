// The portal shell's decisions, kept pure so they can be tested without a
// browser: what the menu shows to whom, what the search box can jump to, which
// number each badge carries, and what Home puts first.
//
// Nothing here renders. page.tsx, the command palette, the bottom tab bar and
// Home all read from this one place, so the menu, the search results and the
// Home buttons can never disagree about what a person may open.

import { tabAllowed, tabRoleAllowed, TAB_MIN_ROLE, TAB_FEATURE, type Entitlements } from "@/lib/entitlement-registry";
import type { Tab, ChatIntent } from "../_shared";

// ── Menu ─────────────────────────────────────────────────────────────────────

/** A menu entry: a screen, or "whatsapp" — a shortcut to Settings → WhatsApp numbers. */
export type NavKey = Tab | "whatsapp";
/** Icon names, mapped to lucide icons by the shell (keeps this module JSX-free). */
export type NavIcon =
  | "home" | "chat" | "users" | "chart" | "team" | "whatsapp" | "instagram" | "facebook" | "youtube" | "star" | "globe"
  | "send" | "template" | "workflow" | "history" | "bot" | "zap" | "sparkles" | "bag" | "trending" | "at" | "form"
  | "megaphone" | "checklist" | "plug" | "ban" | "settings" | "shield" | "calendar" | "kanban";
export interface NavItem { key: NavKey; label: string; icon: NavIcon; hint: string }

// Grouped by what the person is trying to do, not by feature area. Each `hint`
// is the plain-English line under the label in the phone menu, and the hover
// help on a desktop.
export const NAV_GROUPS: { group: string; items: NavItem[] }[] = [
  {
    group: "Home & Inbox",
    items: [
      { key: "home", label: "Home", icon: "home", hint: "What needs you today, and how things are going" },
      { key: "livechat", label: "Live Chat", icon: "chat", hint: "Every conversation from every channel, in one inbox" },
      { key: "contacts", label: "Contacts", icon: "users", hint: "Everyone who has ever messaged you" },
      { key: "analytics", label: "Analytics", icon: "chart", hint: "See what's working — messages, replies, sales" },
      // Only a team lead or an admin ever sees this.
      { key: "team", label: "Team Progress", icon: "team", hint: "Is your team keeping up, and who is behind" },
    ],
  },
  {
    group: "Your Channels",
    items: [
      { key: "whatsapp", label: "WhatsApp", icon: "whatsapp", hint: "Your WhatsApp numbers and how they're connected" },
      { key: "instagram", label: "Instagram", icon: "instagram", hint: "Auto-reply to Instagram DMs and comments" },
      { key: "facebook", label: "Facebook", icon: "facebook", hint: "Auto-reply to Facebook Page messages and comments" },
      { key: "youtube", label: "YouTube", icon: "youtube", hint: "Auto-reply to video comments and hide spam" },
      { key: "reviews", label: "Google Reviews", icon: "star", hint: "Reply to your Google Business Profile reviews" },
      { key: "webchat", label: "Website Chat", icon: "globe", hint: "Add a chat bubble to your website" },
    ],
  },
  {
    group: "Send Messages",
    items: [
      { key: "broadcast", label: "Broadcast", icon: "send", hint: "Send one message to many people at once" },
      { key: "templates", label: "Templates", icon: "template", hint: "Message formats WhatsApp has approved" },
      { key: "sequences", label: "Sequences", icon: "workflow", hint: "Automatic follow-up messages over days" },
      { key: "campaigns", label: "History", icon: "history", hint: "Everything you've already sent" },
    ],
  },
  {
    group: "AI & Automation",
    items: [
      { key: "assistant", label: "AI Knowledge Base", icon: "bot", hint: "Teach the AI about your business so it answers correctly" },
      { key: "flows", label: "Chatbot Flows", icon: "zap", hint: "Build a step-by-step chat with buttons — no code" },
      { key: "aihub", label: "AI Hub", icon: "sparkles", hint: "AI personalities, tools and your own AI key" },
    ],
  },
  {
    group: "Grow & Sell",
    items: [
      { key: "catalog", label: "Catalog", icon: "bag", hint: "Your products, and checkout inside the chat" },
      { key: "growth", label: "Growth Tools", icon: "trending", hint: "Opt-in links and lead magnets that grow your list" },
      { key: "handlehub", label: "Links & QR Codes", icon: "at", hint: "Trackable chat links and QR codes for posters, ads and bios" },
      { key: "forms", label: "WhatsApp Forms", icon: "form", hint: "Collect name, email and details inside a chat" },
      { key: "ads", label: "Meta Ads", icon: "megaphone", hint: "Run Facebook and Instagram ads that open a chat" },
    ],
  },
  {
    group: "Settings & Setup",
    items: [
      { key: "setup", label: "Setup Guide", icon: "checklist", hint: "Step-by-step checklist to get fully live" },
      { key: "integrations", label: "Integrations", icon: "plug", hint: "Connect your CRM, payments and other tools" },
      { key: "optouts", label: "Do Not Contact", icon: "ban", hint: "People who asked to stop receiving messages" },
      { key: "settings", label: "Settings", icon: "settings", hint: "WhatsApp numbers, your team, and billing" },
      { key: "security", label: "Sign-in security", icon: "shield", hint: "Your passkeys and authenticator app" },
    ],
  },
  {
    // Useful but not core: folded away at the bottom until someone opens it.
    group: "More tools",
    items: [
      { key: "bookings", label: "Bookings", icon: "calendar", hint: "Appointments by day — confirm, remind, take deposits, mark who came" },
      { key: "pipeline", label: "Sales Pipeline", icon: "kanban", hint: "Drag leads from new enquiry to won" },
    ],
  },
];

export const TAB_TITLES: Record<Tab, string> = {
  home: "Home", today: "Today", results: "Results", bookings: "Bookings", livechat: "Live Chat", broadcast: "Broadcast", ads: "Meta Ads", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", webchat: "Website Chat", reviews: "Google Reviews", assistant: "AI Knowledge Base", flows: "Chatbot Flows",
  sequences: "Sequences", catalog: "Catalog", growth: "Growth Tools", handlehub: "Links & QR Codes",
  aihub: "AI Hub", templates: "Templates", forms: "WhatsApp Forms", analytics: "Analytics",
  contacts: "Contacts", pipeline: "Sales Pipeline", campaigns: "History", optouts: "Do Not Contact", settings: "Settings", setup: "Setup Guide", integrations: "Integrations", security: "Sign-in security", team: "Team Progress",
};

/** The Settings section the WhatsApp menu item opens (SettingsTab's ?section= key). */
export const WHATSAPP_SECTION = "numbers";

// Settings' own sections (mirrors SETTINGS_SECTIONS in _tabs/SettingsTab.tsx —
// keep the keys in step; SettingsTab reads ?section= when it opens).
export const SETTINGS_SECTIONS: { key: string; label: string; adminOnly: boolean; keywords: string }[] = [
  { key: "general", label: "General", adminOnly: false, keywords: "plan billing business name timezone" },
  { key: "numbers", label: "WhatsApp numbers", adminOnly: true, keywords: "phone number connect waba meta" },
  { key: "team", label: "Team", adminOnly: true, keywords: "users members invite roles staff agents" },
  { key: "crm", label: "CRM & API", adminOnly: true, keywords: "leadsquared api key webhook" },
  { key: "automation", label: "Automatic messages", adminOnly: false, keywords: "welcome away hours reminders" },
  { key: "replies", label: "Quick replies", adminOnly: false, keywords: "canned saved answers shortcuts" },
  { key: "privacy", label: "Data & privacy", adminOnly: true, keywords: "delete export consent retention" },
];

const ROLE_GATED = new Set<string>([...Object.keys(TAB_MIN_ROLE), "team"]);

/** Whether a menu entry depends on who the person is or what their plan includes. */
export function isGated(key: NavKey): boolean {
  return key === "whatsapp" || ROLE_GATED.has(key) || !!TAB_FEATURE[key];
}

export type NavState = "show" | "hide" | "pending";

/**
 * Show, hide, or "pending" (a neutral placeholder) for one menu entry.
 * Until /api/admin/me has answered (`loaded`), entries that depend on role or
 * plan are pending, so nothing appears and then vanishes a moment later.
 */
export function navItemState(key: NavKey, ent: Entitlements | null | undefined, role: string | null | undefined, loaded: boolean): NavState {
  if (!loaded) return isGated(key) ? "pending" : "show";
  if (key === "whatsapp") {
    const planOk = !ent || !ent.enforcing || ent.features.ch_whatsapp !== false;
    return planOk && (!role || role === "admin") ? "show" : "hide";
  }
  return tabAllowed(key, ent) && tabRoleAllowed(key, role) ? "show" : "hide";
}

/** May this person open this screen at all (plan and role)? */
export function canOpen(tab: Tab, ent: Entitlements | null | undefined, role: string | null | undefined): boolean {
  return tabAllowed(tab, ent) && tabRoleAllowed(tab, role);
}

// ── Search / command palette ─────────────────────────────────────────────────

export type PaletteGroup = "Suggested" | "Go to" | "Settings" | "Actions";
export interface PaletteEntry {
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  keywords?: string;
  tab?: Tab;
  /** A Settings section to open (?section=). */
  section?: string;
  intent?: ChatIntent;
  /** Something that isn't a screen. */
  action?: "tour";
}

export interface PaletteContext {
  ent: Entitlements | null | undefined;
  role: string | null | undefined;
  /** Whether /api/admin/me has answered; until then only ungated entries are offered. */
  loaded: boolean;
  /** The workspace's own name for a screen (Contacts → Students…). */
  label: (tab: Tab) => string;
}

const EXTRA_SCREENS: { key: Tab; hint: string; keywords?: string }[] = [
  { key: "today", hint: "Everything waiting for a person — overdue first", keywords: "tasks overdue due todo" },
  { key: "results", hint: "Sales and revenue, by where they came from", keywords: "revenue money sales" },
];

/** Everything the search box can jump to, for this person. Pure. */
export function paletteEntries(ctx: PaletteContext): PaletteEntry[] {
  const { ent, role, loaded, label } = ctx;
  const show = (k: NavKey) => navItemState(k, ent, role, loaded) === "show";
  const out: PaletteEntry[] = [];

  // Common actions first, so an empty search is already useful.
  if (show("livechat")) out.push({ id: "act:waiting", group: "Actions", label: "Chats waiting for you", hint: "Open the inbox at the chats that need a person", keywords: "inbox reply waiting needs a person escalated unanswered", tab: "livechat", intent: { filter: "waiting" } });
  if (show("broadcast")) out.push({ id: "act:broadcast", group: "Actions", label: "New broadcast", hint: "Send one message to many people", keywords: "send campaign message bulk", tab: "broadcast" });
  if (show("contacts")) out.push({ id: "act:import", group: "Actions", label: `Import ${label("contacts").toLowerCase()}`, hint: "Upload a CSV or add people one by one", keywords: "csv upload add contacts customers excel", tab: "contacts" });
  if (show("assistant")) out.push({ id: "act:knowledge", group: "Actions", label: "Add knowledge", hint: "Teach the AI with a document, a web page or an FAQ", keywords: "teach ai document pdf website faq knowledge", tab: "assistant" });
  out.push({ id: "act:tour", group: "Actions", label: "Take a tour", hint: "A short walk through the menu", keywords: "help guide walkthrough", action: "tour" });

  for (const s of EXTRA_SCREENS) {
    if (show(s.key)) out.push({ id: `tab:${s.key}`, group: "Go to", label: label(s.key), hint: s.hint, keywords: s.keywords, tab: s.key });
  }
  for (const g of NAV_GROUPS) {
    for (const n of g.items) {
      if (!show(n.key)) continue;
      if (n.key === "whatsapp") out.push({ id: "nav:whatsapp", group: "Go to", label: "WhatsApp numbers", hint: n.hint, keywords: "whatsapp phone number connect", tab: "settings", section: WHATSAPP_SECTION });
      else out.push({ id: `tab:${n.key}`, group: "Go to", label: label(n.key), hint: n.hint, keywords: g.group, tab: n.key });
    }
  }
  if (show("settings")) {
    for (const s of SETTINGS_SECTIONS) {
      if (s.adminOnly && (!loaded || (role && role !== "admin"))) continue;
      out.push({ id: `settings:${s.key}`, group: "Settings", label: `Settings › ${s.label}`, keywords: s.keywords, tab: "settings", section: s.key });
    }
  }
  // One entry per destination: the WhatsApp shortcut and Settings › WhatsApp numbers are the same place.
  // (Actions may share a screen with a "Go to" entry — they read differently.)
  const seen = new Set<string>();
  return out.filter(e => {
    if (!e.section) return true;
    if (seen.has(e.section)) return false;
    seen.add(e.section);
    return true;
  });
}

/**
 * Filter and rank entries for a typed query. Every word must match somewhere;
 * a match at the start of the label ranks first, then at the start of a word,
 * then anywhere in the label, then in the hint or keywords. Ties keep their
 * original order. An empty query returns the entries unchanged.
 */
export function filterPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  const scored: { e: PaletteEntry; score: number; i: number }[] = [];
  entries.forEach((e, i) => {
    const label = e.label.toLowerCase();
    const rest = `${e.group} ${e.hint ?? ""} ${e.keywords ?? ""}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (label.startsWith(t)) score += 0;
      else if (new RegExp(`(^|[\\s›&/-])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) score += 1;
      else if (label.includes(t)) score += 2;
      else if (rest.includes(t)) score += 4;
      else return;
    }
    scored.push({ e, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(s => s.e);
}

// ── Badges: one definition per number ────────────────────────────────────────

/** A badge's text: the number, or "99+". */
export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(Math.max(0, Math.floor(n)));
}

/**
 * The words screen readers hear for the two work badges. "Waiting for you" is
 * chats waiting for a person (/api/admin/inbox/waiting) — the Live Chat badge,
 * the phone's Inbox tab and Home all show this one number. Overdue is Today
 * items past due. (The bell names its own count: bellLabel in alerts-bell.tsx.)
 */
export function attentionLabels(c: { waiting: number; overdue: number }) {
  return { waiting: `${c.waiting} waiting for you`, overdue: `${c.overdue} overdue` };
}

// ── Home: the one next step ──────────────────────────────────────────────────

export interface WaitingLike { id: string; name?: string | null; phone: string; lastInboundAt: string; reason: string }
export interface TodayItemLike {
  key: string; kind: string; title: string; detail?: string; person: string | null; action: string;
  dueAt: string | null; overdue: boolean; mine?: boolean;
  open: { tab: string; phone?: string; reviewId?: string };
}
export interface SetupStepLike { key: string; title: string; status: "ok" | "warn" | "todo" | "error"; optional?: boolean; fixTab?: string; detail?: string }

export type NextAction =
  | { kind: "reply"; label: string; urgent: true; chat: WaitingLike }
  | { kind: "today"; label: string; urgent: boolean; item: TodayItemLike }
  | { kind: "setup"; label: string; urgent: false; step: SetupStepLike };

/** A customer's name fit for a button: never a raw web-chat id. */
export function personName(name: string | null | undefined, phone: string): string {
  const n = (name ?? "").trim();
  if (n) return n;
  return /^\+?\d{6,}$/.test(phone) ? `…${phone.slice(-4)}` : "a customer";
}

/** "42 min", "2 h 5 min", "3 days" since `iso`. */
export function waitWords(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day" : `${d} days`;
}

/**
 * The single most useful thing to do next, or null when nothing needs them:
 *  1. the customer who has waited longest for a person;
 *  2. otherwise the most overdue item in Today;
 *  3. otherwise the next item in Today;
 *  4. otherwise the next unfinished setup step.
 */
export function chooseNextAction(input: { waiting: WaitingLike[]; today: TodayItemLike[]; setupNext?: SetupStepLike | null; now: number }): NextAction | null {
  const { waiting, today, setupNext, now } = input;
  const valid = waiting.filter(c => !Number.isNaN(Date.parse(c.lastInboundAt)));
  if (valid.length) {
    const chat = [...valid].sort((a, b) => Date.parse(a.lastInboundAt) - Date.parse(b.lastInboundAt))[0];
    return { kind: "reply", urgent: true, chat, label: `Reply to ${personName(chat.name, chat.phone)} · waiting ${waitWords(chat.lastInboundAt, now)}` };
  }
  const due = (i: TodayItemLike) => (i.dueAt ? Date.parse(i.dueAt) : Number.POSITIVE_INFINITY);
  const overdue = today.filter(i => i.overdue).sort((a, b) => due(a) - due(b));
  const first = overdue[0] ?? [...today].sort((a, b) => due(a) - due(b))[0];
  if (first) return { kind: "today", urgent: first.overdue, item: first, label: `${first.action} · ${first.title}` };
  if (setupNext) return { kind: "setup", urgent: false, step: setupNext, label: `Finish setup: ${setupNext.title}` };
  return null;
}

/** How far through the required setup steps; `next` is the first one not done. */
export function setupProgress(steps: SetupStepLike[] | null | undefined) {
  const required = (steps ?? []).filter(s => !s.optional);
  const done = required.filter(s => s.status === "ok").length;
  const next = required.find(s => s.status !== "ok") ?? null;
  return { done, total: required.length, next, complete: required.length > 0 && done === required.length };
}

/** "When was it" for a Today item, in words. */
export function dueWords(dueAt: string | null, overdue: boolean, now: number): string {
  if (!dueAt || Number.isNaN(Date.parse(dueAt))) return "No due date";
  if (overdue) return `${waitWords(dueAt, now)} overdue`;
  const min = Math.round((Date.parse(dueAt) - now) / 60_000);
  if (min < 60) return `Due in ${Math.max(1, min)} min`;
  if (min < 24 * 60) return `Due in ${Math.round(min / 60)} h`;
  return `Due in ${Math.round(min / 1440)} days`;
}

// ── Home: key numbers with a comparison ──────────────────────────────────────

export type TrendDir = "up" | "down" | "same" | "new" | "none";
/** This week against the week before, in words — never colour alone. */
export function trendOf(current: number, previous: number): { dir: TrendDir; pct: number | null; words: string } {
  const c = Math.max(0, current), p = Math.max(0, previous);
  if (c === 0 && p === 0) return { dir: "none", pct: null, words: "None in the previous 7 days either" };
  if (p === 0) return { dir: "new", pct: null, words: "Up from none in the previous 7 days" };
  const pct = Math.round(((c - p) / p) * 100);
  if (pct === 0) return { dir: "same", pct: 0, words: "Same as the previous 7 days" };
  return pct > 0
    ? { dir: "up", pct, words: `Up ${pct}% vs previous 7 days` }
    : { dir: "down", pct: -pct, words: `Down ${-pct}% vs previous 7 days` };
}

/** The slice of /api/admin/analytics Home compares. */
export interface WeekSlice {
  contacts: { newInRange: number };
  messaging: { totals: { sent: number }; repliedInRange: number; aiRepliesInRange: number };
}

/**
 * Last 7 days against the 7 before them, from the 7-day and 14-day answers of
 * /api/admin/analytics (both start on a UTC day boundary, so 14d − 7d is the
 * previous week exactly).
 */
export function weekNumbers(a7: WeekSlice, a14: WeekSlice, contactsLabel = "contacts") {
  const pair = (cur: number, both: number) => ({ current: cur, previous: Math.max(0, both - cur) });
  const rows = [
    { key: "contacts", label: `New ${contactsLabel.toLowerCase()}`, ...pair(a7.contacts.newInRange, a14.contacts.newInRange) },
    { key: "inbound", label: "Messages from customers", ...pair(a7.messaging.repliedInRange, a14.messaging.repliedInRange) },
    { key: "ai", label: "AI answers", ...pair(a7.messaging.aiRepliesInRange, a14.messaging.aiRepliesInRange) },
    { key: "sent", label: "Messages you sent", ...pair(a7.messaging.totals.sent, a14.messaging.totals.sent) },
  ];
  return rows.map(r => ({ ...r, trend: trendOf(r.current, r.previous) }));
}

/** "Good morning" / "Good afternoon" / "Good evening" for a local hour. */
export function greetingFor(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Storage key for "hide the how-to guide on Home", per workspace and person. */
export function guideHiddenKey(tenantId: string, email: string): string {
  return `talko.home-guide-hidden:${encodeURIComponent(tenantId)}:${encodeURIComponent(email.trim().toLowerCase())}`;
}
