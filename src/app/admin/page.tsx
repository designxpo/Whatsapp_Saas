"use client";

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/BrandLogo";
import { launchWhatsAppSignup, launchInstagramSignup, whatsappSignupReady, instagramSignupReady } from "@/lib/embedded-signup-client";
import { Loader2, Send, Users, History, Zap, Ban, LogOut, UploadCloud, Check, Trash2, Plus, Bot, MessageSquare, Database, Sparkles, ShieldCheck, ArrowRight, Globe, FileText, BarChart3, LayoutTemplate, FlaskConical, Home, CircleCheck, CircleDashed, Settings, Tag, UserCheck, RefreshCw, Image as ImageIcon, Video, Phone, Link2, Copy, X, GalleryHorizontalEnd, Star, Filter, Download, ChevronLeft, ChevronRight, ArrowLeft, MousePointerClick, Reply, AlertTriangle, ClipboardList, ExternalLink, Search, Megaphone, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, MapPin, Instagram, Workflow, ShoppingBag, TrendingUp } from "lucide-react";

type Tab = "home" | "livechat" | "broadcast" | "ads" | "instagram" | "assistant" | "flows" | "sequences" | "catalog" | "growth" | "aihub" | "templates" | "forms" | "analytics" | "contacts" | "campaigns" | "optouts" | "settings";

const NAV_GROUPS: { group: string; items: { key: Tab; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Main Menu",
    items: [
      { key: "home", label: "Home", icon: <Home className="w-[18px] h-[18px]" /> },
      { key: "livechat", label: "Live Chat", icon: <MessageSquare className="w-[18px] h-[18px]" /> },
      { key: "broadcast", label: "Broadcast", icon: <Send className="w-[18px] h-[18px]" /> },
      { key: "contacts", label: "Contacts", icon: <Users className="w-[18px] h-[18px]" /> },
      { key: "campaigns", label: "History", icon: <History className="w-[18px] h-[18px]" /> },
      { key: "analytics", label: "Analytics", icon: <BarChart3 className="w-[18px] h-[18px]" /> },
      { key: "ads", label: "Meta Ads", icon: <Megaphone className="w-[18px] h-[18px]" /> },
      { key: "instagram", label: "Instagram", icon: <Instagram className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    group: "Features",
    items: [
      { key: "assistant", label: "AI Knowledge Base", icon: <Bot className="w-[18px] h-[18px]" /> },
      { key: "flows", label: "Chatbot Flows", icon: <Zap className="w-[18px] h-[18px]" /> },
      { key: "sequences", label: "Sequences", icon: <Workflow className="w-[18px] h-[18px]" /> },
      { key: "catalog", label: "Catalog", icon: <ShoppingBag className="w-[18px] h-[18px]" /> },
      { key: "growth", label: "Growth Tools", icon: <TrendingUp className="w-[18px] h-[18px]" /> },
      { key: "aihub", label: "AI Hub", icon: <Sparkles className="w-[18px] h-[18px]" /> },
      { key: "templates", label: "Templates", icon: <LayoutTemplate className="w-[18px] h-[18px]" /> },
      { key: "forms", label: "WhatsApp Forms", icon: <ClipboardList className="w-[18px] h-[18px]" /> },
    ],
  },
  {
    group: "General",
    items: [
      { key: "optouts", label: "Opt-outs", icon: <Ban className="w-[18px] h-[18px]" /> },
      { key: "settings", label: "Settings", icon: <Settings className="w-[18px] h-[18px]" /> },
    ],
  },
];
const TAB_TITLES: Record<Tab, string> = {
  home: "Home", livechat: "Live Chat", broadcast: "Broadcast", ads: "Meta Ads", instagram: "Instagram", assistant: "AI Knowledge Base", flows: "Chatbot Flows",
  sequences: "Sequences", catalog: "Catalog", growth: "Growth Tools",
  aihub: "AI Hub", templates: "Templates", forms: "WhatsApp Forms", analytics: "Analytics",
  contacts: "Contacts", campaigns: "History", optouts: "Opt-outs", settings: "Settings",
};

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export default function Admin() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  const [me, setMe] = useState<{ email: string; name: string; role: string; isPlatformOwner?: boolean; tenantId?: string } | null>(null);
  const [banner, setBanner] = useState<{ title: string; body: string; level: string } | null>(null);
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    fetch("/api/admin/me").then(r => r.json()).then(d => {
      const u = d.user ?? null;
      setMe(u);
      setBanner(d.banner ?? null);
      // The product owner can browse this app interface (the platform's default
      // workspace) AND jump to the Owner Portal via the sidebar. When viewing a
      // specific tenant they're impersonating (tenantId != default).
      const welcome = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("welcome") === "1";
      if (d.needsWalkthrough || welcome) setShowTour(true);
    }).catch(() => {});
  }, [router]);

  const impersonating = !!me?.isPlatformOwner && !!me?.tenantId && me.tenantId !== DEFAULT_TENANT_ID;
  async function exitImpersonation() {
    await fetch("/api/owner/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) }).catch(() => {});
    router.push("/admin/owner"); router.refresh();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex bg-canvas">
      <aside className="w-64 shrink-0 bg-white border-r border-line flex flex-col h-screen sticky top-0">
        {/* Logo block */}
        <div className="px-5 py-5">
          <BrandLogo height={30} className="max-w-[170px]" fallback={
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center shrink-0">
                <MessageSquare className="w-[18px] h-[18px] text-white" />
              </div>
              <p className="text-[15px] font-bold text-ink-900 leading-tight">Talko AI</p>
            </div>
          } />
          <p className="text-[11px] text-ink-400 leading-tight truncate mt-1.5">AI conversations for WhatsApp &amp; Instagram</p>
        </div>

        {/* Owner-only: jump to the platform control plane. Tenants never see this. */}
        {me?.isPlatformOwner && (
          <div className="px-3 pb-1">
            <a href="/admin/owner" className="w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-bold text-white bg-brand-700 hover:bg-brand-800 transition-colors" title="Manage every tenant, billing and feature flags">
              <ShieldCheck className="w-[18px] h-[18px]" /> Owner Portal
            </a>
          </div>
        )}

        {/* Grouped nav */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          {NAV_GROUPS.map(g => (
            <div key={g.group} className="mb-4">
              <p className="px-3 mb-1.5 text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">{g.group}</p>
              <div className="space-y-0.5">
                {g.items.map(n => {
                  const active = tab === n.key;
                  return (
                    <button key={n.key} onClick={() => setTab(n.key)}
                      className={`w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-medium text-left transition-colors ${active ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
                      {n.icon}{n.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-line space-y-1">
          {me && (
            <div className="flex items-center gap-2.5 px-3 py-1.5">
              <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                {(me.name || me.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink-900 truncate leading-tight">{me.name || me.email}</p>
                <p className="text-[10px] text-ink-400 leading-tight">{me.role === "member" ? "Member" : "Admin"}</p>
              </div>
            </div>
          )}
          {/* Owner returning from a tenant they're viewing. Tenants never see this. */}
          {impersonating && (
            <button onClick={exitImpersonation} className="w-full flex items-center gap-3 h-9 px-3 rounded-full text-[12px] font-bold text-brand-700 hover:bg-brand-50 transition-colors" title="Back to the Owner Portal">
              <ShieldCheck className="w-4 h-4" /> Exit to Owner Portal
            </button>
          )}
          <button onClick={logout} className="w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-medium text-ink-600 hover:bg-red-50 hover:text-red-600 transition-colors">
            <LogOut className="w-[18px] h-[18px]" /> Log out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {banner && (
          <div className={`shrink-0 px-6 py-2 text-[12px] font-medium text-center ${banner.level === "warning" ? "bg-amber-50 text-amber-800 border-b border-amber-200" : banner.level === "success" ? "bg-emerald-50 text-emerald-800 border-b border-emerald-200" : "bg-brand-50 text-brand-800 border-b border-brand-100"}`}>
            <b>{banner.title}</b>{banner.body ? ` — ${banner.body}` : ""}
          </div>
        )}
        {me?.isPlatformOwner && !impersonating && (
          <div className="h-9 shrink-0 bg-brand-50 border-b border-brand-100 flex items-center justify-center gap-3 text-[12px] text-brand-800 font-semibold">
            🛡️ Owner preview — this is the platform&apos;s default workspace
            <a href="/admin/owner" className="px-2 py-0.5 rounded-control bg-brand-700 text-white text-[11px] font-bold hover:bg-brand-800">Open Owner Portal</a>
          </div>
        )}
        {impersonating && (
          <div className="h-9 shrink-0 bg-amber-50 border-b border-amber-200 flex items-center justify-center gap-3 text-[12px] text-amber-800 font-semibold">
            👀 You&apos;re viewing a tenant&apos;s workspace as the owner
            <button onClick={exitImpersonation} className="px-2 py-0.5 rounded-control bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700">Exit to Owner Portal</button>
          </div>
        )}
        {/* Topbar */}
        <header className="h-16 shrink-0 bg-white border-b border-line flex items-center justify-between px-6 sticky top-0 z-10">
          <p className="text-[13px] text-ink-400">
            Talko AI <span className="mx-1">/</span> <span className="text-ink-900 font-medium">{TAB_TITLES[tab]}</span>
          </p>
          <button onClick={() => setTab("broadcast")} className={btnPrimary}>
            <Send className="w-4 h-4" /> New broadcast
          </button>
        </header>

        <main className="flex-1 p-6 overflow-x-hidden">
          {tab === "home" && <HomeTab goTo={setTab} />}
          {tab === "livechat" && <LiveChatTab goTo={setTab} />}
          {tab === "broadcast" && <BroadcastTab goTo={setTab} />}
          {tab === "ads" && <AdsTab goTo={setTab} />}
          {tab === "instagram" && <InstagramTab />}
          {tab === "assistant" && <AssistantTab goTo={setTab} />}
          {tab === "flows" && <FlowsTab />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "catalog" && <CatalogTab />}
          {tab === "growth" && <GrowthTab />}
          {tab === "aihub" && <AiHubTab goTo={setTab} />}
          {tab === "templates" && <TemplatesTab />}
          {tab === "forms" && <FormsTab goTo={setTab} />}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "contacts" && <ContactsTab goTo={setTab} />}
          {tab === "campaigns" && <CampaignsTab goTo={setTab} />}
          {tab === "optouts" && <OptoutsTab />}
          {tab === "settings" && <SettingsTab goTo={setTab} />}
        </main>
      </div>
      {showTour && <Walkthrough goTo={setTab} onDone={() => setShowTour(false)} />}
    </div>
  );
}

// First-login product walkthrough — a short guided tour. Marks the tenant
// onboarded on finish/skip so it shows once.
const TOUR_STEPS: { title: string; body: string; tab?: Tab }[] = [
  { title: "Welcome to Talko AI 👋", body: "Your all-in-one WhatsApp + Instagram platform — AI replies, broadcasts, chatbot flows, drip sequences, catalog & growth tools. Here's a 60-second tour." },
  { title: "Connect your channels", body: "Go to Settings to connect a WhatsApp number, and the Instagram section to link an Instagram account. Everything runs from here.", tab: "settings" },
  { title: "Teach the AI", body: "Add your business docs in AI Knowledge Base — the assistant answers customer questions automatically, grounded in your content.", tab: "assistant" },
  { title: "Build chatbot flows", body: "Create drag-and-drop flows for WhatsApp or Instagram, triggered by keywords, comments or ads.", tab: "flows" },
  { title: "Automate follow-ups", body: "Use Sequences for timed drip campaigns, Catalog for in-chat selling, and Growth Tools for opt-in links — all in the sidebar.", tab: "sequences" },
  { title: "You're all set 🚀", body: "Start a broadcast or send a test message anytime. Need help? Everything has inline guidance." },
];
function Walkthrough({ goTo, onDone }: { goTo: (t: Tab) => void; onDone: () => void }) {
  const [i, setI] = useState(0);
  const step = TOUR_STEPS[i];
  const finish = async () => { await fetch("/api/admin/walkthrough", { method: "POST" }).catch(() => {}); onDone(); };
  const next = () => { const s = TOUR_STEPS[i + 1]; if (s?.tab) goTo(s.tab); if (i + 1 >= TOUR_STEPS.length) finish(); else setI(i + 1); };
  return (
    <div className="fixed inset-0 z-50 bg-ink-950/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-card border border-line p-6 space-y-4">
        <div className="flex gap-1.5">{TOUR_STEPS.map((_, j) => <div key={j} className={`h-1.5 flex-1 rounded-full ${j <= i ? "bg-brand-700" : "bg-line"}`} />)}</div>
        <div>
          <h3 className="text-lg font-extrabold text-ink-900">{step.title}</h3>
          <p className="text-sm text-ink-500 mt-1.5 leading-relaxed">{step.body}</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button onClick={finish} className="text-xs font-semibold text-ink-400 hover:text-ink-700">Skip tour</button>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-400">{i + 1} / {TOUR_STEPS.length}</span>
            <button onClick={next} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">{i + 1 >= TOUR_STEPS.length ? "Get started" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared component grammar (Emerald Fintech theme) ──
const inp = "border border-line rounded-control px-3 py-2 text-sm bg-white text-ink-900 placeholder:text-ink-400";
const btnPrimary = "px-4 py-2 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white text-[13px] font-semibold flex items-center gap-2 transition-colors disabled:opacity-60";

// ── Multi-number channels (shared) ──
type ChannelRow = { id: string; kind?: "whatsapp" | "instagram"; name: string; phoneId: string; wabaId: string; igUserId?: string | null; pageId?: string | null; token: string; appId: string | null; agentId: string | null; active: boolean; isDefault: boolean };
let CHANNELS_CACHE: ChannelRow[] | null = null;
async function loadChannelList(force = false): Promise<ChannelRow[]> {
  if (!CHANNELS_CACHE || force) {
    CHANNELS_CACHE = await fetch("/api/admin/channels").then(r => r.json()).then(d => d.channels ?? []).catch(() => []);
  }
  return CHANNELS_CACHE ?? [];
}
function useChannelList() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  useEffect(() => { loadChannelList().then(setChannels); }, []);
  return channels;
}
// Number picker — renders nothing in single-number (env) mode.
function ChannelSelect({ value, onChange, allLabel, className }: { value: string | null; onChange: (v: string | null) => void; allLabel?: string; className?: string }) {
  const channels = useChannelList();
  if (!channels.length) return null;
  return (
    <select className={className ?? inp} value={value ?? ""} onChange={e => onChange(e.target.value || null)} title="WhatsApp number">
      <option value="">{allLabel ?? "Default number"}</option>
      {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

// ── Home: setup checklist + how the platform works ───────────────────────────
interface SetupStep { ok: boolean; label: string; detail: string }
interface SystemStatus {
  steps: Record<string, SetupStep>;
  completed: number;
  totalRequired: number;
  live: boolean;
  router: { enabled: boolean; faqEntries: number };
  counts: { contacts: number; kbDocuments: number; conversations: number; needsAttention: number };
}

function HomeTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [s, setS] = useState<SystemStatus | null>(null);
  useEffect(() => { fetch("/api/admin/system/status").then(r => r.json()).then(setS).catch(() => undefined); }, []);

  const guide: { icon: React.ReactNode; title: string; text: string; cta: string; tab: Tab }[] = [
    { icon: <Database className="w-5 h-5" />, title: "1 · Teach the AI", text: "Upload your business docs (PDF, text, website URL) so the assistant can answer customer questions.", cta: "Add knowledge", tab: "assistant" },
    { icon: <FlaskConical className="w-5 h-5" />, title: "2 · Test it", text: "Ask the assistant questions in the test box — no WhatsApp needed. See whether the answer came from FAQ, cache, or AI.", cta: "Test assistant", tab: "assistant" },
    { icon: <Users className="w-5 h-5" />, title: "3 · Add contacts", text: "Import a CSV or add contacts with tags and attributes (e.g. city, course) for targeted broadcasts.", cta: "Import contacts", tab: "contacts" },
    { icon: <Send className="w-5 h-5" />, title: "4 · Broadcast", text: "Pick an approved template, choose an audience (all / tag / attribute), and send. Replies land in Live Chat where the AI answers automatically.", cta: "Send a broadcast", tab: "broadcast" },
  ];

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-bold">Welcome 👋</h2>
        <p className="text-sm text-slate-500 mt-1">This platform sends WhatsApp broadcasts, and an AI assistant answers replies automatically using your knowledge base. Humans take over anytime from Live Chat.</p>
      </div>

      {/* At a glance */}
      {s && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Contacts", value: s.counts.contacts, tab: "contacts" as Tab },
            { label: "Knowledge docs", value: s.counts.kbDocuments, tab: "assistant" as Tab },
            { label: "Conversations", value: s.counts.conversations, tab: "livechat" as Tab },
            { label: "Need attention", value: s.counts.needsAttention, tab: "livechat" as Tab },
          ].map(c => (
            <button key={c.label} onClick={() => goTo(c.tab)} className="bg-white border border-line rounded-2xl p-4 text-left hover:border-brand-500">
              <p className={`text-2xl font-extrabold ${c.label === "Need attention" && c.value > 0 ? "text-red-500" : ""}`}>{c.value}</p>
              <p className="text-xs text-slate-500 font-medium">{c.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* How to use */}
      <section>
        <h3 className="font-bold text-sm mb-3">How to use this platform</h3>
        <div className="grid grid-cols-2 gap-3">
          {guide.map(g => (
            <div key={g.title} className="bg-white border border-line rounded-2xl p-4 flex flex-col">
              <div className="flex items-center gap-2 text-brand-600 mb-1.5">{g.icon}<p className="font-bold text-sm">{g.title}</p></div>
              <p className="text-xs text-slate-500 flex-1">{g.text}</p>
              <button onClick={() => goTo(g.tab)} className="mt-3 self-start text-xs font-bold text-brand-700 flex items-center gap-1 hover:gap-2 transition-all">{g.cta} <ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </section>

      {s?.router.enabled && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Knowledge Router active — {s.router.faqEntries} FAQs answer instantly before the AI is called.</p>
      )}
    </div>
    <HomeRail goTo={goTo} />
    </div>
  );
}

// ── Right-rail insights ───────────────────────────────────────────────────────
// Contextual insight rails that fill the right side of Home, Broadcast, and
// AI Knowledge Base — live numbers + jump-offs to the deeper feature screens.

// (AnalyticsData type is declared above AnalyticsTab — same payload shape.)
function useAnalytics(): AnalyticsData | null {
  const [a, setA] = useState<AnalyticsData | null>(null);
  useEffect(() => { fetch("/api/admin/analytics").then(r => r.json()).then(d => setA(d.analytics ?? null)).catch(() => {}); }, []);
  return a;
}

function RailCard({ title, action, onAction, children }: { title: string; action?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-card border border-line p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">{title}</p>
        {action && <button onClick={onAction} className="text-[11px] font-bold text-brand-700 hover:underline flex items-center gap-0.5">{action} <ArrowRight className="w-3 h-3" /></button>}
      </div>
      {children}
    </section>
  );
}

function StatRow({ label, value, tone, onClick }: { label: string; value: React.ReactNode; tone?: "warn" | "bad"; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`flex items-center justify-between py-0.5 ${onClick ? "cursor-pointer hover:bg-canvas rounded-md px-1 -mx-1" : ""}`}>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-bold ${tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-ink-900"}`}>{value}</span>
    </div>
  );
}

function RailBar({ label, pct, count, color }: { label: string; pct: number; count: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="font-semibold text-ink-700">{label}</span>
        <span className="text-slate-400">{count.toLocaleString()} · {pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-canvas overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}

const railLoading = <Loader2 className="w-4 h-4 animate-spin text-slate-300" />;

// Home: inbox pulse, 14-day delivery funnel, audience health, quick actions.
function HomeRail({ goTo }: { goTo: (t: Tab) => void }) {
  const a = useAnalytics();
  const t = a?.messaging.totals;
  const pct = (n: number) => t && t.sent ? Math.round((n / t.sent) * 100) : 0;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Inbox pulse" action="Live Chat" onAction={() => goTo("livechat")}>
        {!a ? railLoading : <>
          <StatRow label="Awaiting your reply" value={a.conversations.needsReply} tone={a.conversations.needsReply > 0 ? "warn" : undefined} onClick={() => goTo("livechat")} />
          <StatRow label="Escalated to humans" value={a.conversations.escalated} tone={a.conversations.escalated > 0 ? "bad" : undefined} onClick={() => goTo("livechat")} />
          <StatRow label="Active conversations" value={a.conversations.active} />
        </>}
      </RailCard>
      <RailCard title="Delivery — last 14 days" action="Analytics" onAction={() => goTo("analytics")}>
        {!t ? railLoading : t.sent === 0
          ? <p className="text-xs text-slate-400">No sends yet — this fills in after your first broadcast.</p>
          : <div className="space-y-2">
              <RailBar label="Sent" count={t.sent} pct={100} color="bg-ink-900" />
              <RailBar label="Delivered" count={t.delivered} pct={pct(t.delivered)} color="bg-brand-500" />
              <RailBar label="Read" count={t.read} pct={pct(t.read)} color="bg-brand-700" />
              <RailBar label="Failed" count={t.failed} pct={pct(t.failed)} color="bg-red-400" />
            </div>}
      </RailCard>
      <RailCard title="Audience" action="Contacts" onAction={() => goTo("contacts")}>
        {!a ? railLoading : <>
          <StatRow label="Active contacts" value={a.contacts.active} onClick={() => goTo("contacts")} />
          <StatRow label="Opted out" value={a.contacts.optedOut} onClick={() => goTo("optouts")} />
          <StatRow label="Sent today" value={a.messaging.sentToday} />
        </>}
      </RailCard>
      <RailCard title="Quick actions">
        <div className="grid grid-cols-2 gap-1.5">
          {([["New broadcast", "broadcast"], ["Templates", "templates"], ["Chatbot Flows", "flows"], ["Import contacts", "contacts"], ["WhatsApp Forms", "forms"], ["AI Hub", "aihub"]] as [string, Tab][]).map(([label, tab]) => (
            <button key={tab + label} onClick={() => goTo(tab)} className="px-2.5 py-2 rounded-control border border-line text-[11px] font-bold text-ink-600 hover:border-brand-500 hover:text-brand-700 text-left">{label}</button>
          ))}
        </div>
      </RailCard>
    </aside>
  );
}

// Tier values Meta returns on the phone number node → plain language.
const TIER_LABELS: Record<string, string> = {
  TIER_50: "50 / day", TIER_250: "250 / day", TIER_1K: "1,000 / day",
  TIER_10K: "10,000 / day", TIER_100K: "100,000 / day", TIER_UNLIMITED: "Unlimited",
};

// Broadcast: daily limit & number status, sending health, templates, campaigns.
function BroadcastRail({ goTo, preview }: { goTo: (t: Tab) => void; preview?: React.ReactNode }) {
  const a = useAnalytics();
  const [tpls, setTpls] = useState<{ name: string; status: string }[] | null>(null);
  const [camps, setCamps] = useState<{ id: string; name?: string | null; templateName: string; status: string; sentCount: number; totalRecipients: number }[] | null>(null);
  const [limits, setLimits] = useState<{ dailyCap: number; sentToday: number; quality: string | null; tier: string | null; displayPhone: string | null; metaError: string | null } | null>(null);
  useEffect(() => { fetch("/api/admin/templates").then(r => r.json()).then(d => setTpls(d.templates ?? [])).catch(() => setTpls([])); }, []);
  useEffect(() => { fetch("/api/admin/campaigns").then(r => r.json()).then(d => setCamps((d.campaigns ?? []).slice(0, 4))).catch(() => setCamps([])); }, []);
  useEffect(() => { fetch("/api/admin/broadcast/limits").then(r => r.json()).then(setLimits).catch(() => {}); }, []);
  const byStatus = (s: string) => (tpls ?? []).filter(t => t.status === s).length;
  const usedPct = limits && limits.dailyCap > 0 ? Math.round((limits.sentToday / limits.dailyCap) * 100) : 0;
  const quality = limits?.quality?.toUpperCase() ?? null;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      {preview}
      <RailCard title="Daily sending limit">
        {!limits ? railLoading : <>
          <RailBar label="Used today" count={limits.sentToday} pct={usedPct} color={usedPct >= 90 ? "bg-red-400" : usedPct >= 70 ? "bg-amber-400" : "bg-brand-500"} />
          <StatRow label="Platform cap" value={`${limits.sentToday.toLocaleString()} / ${limits.dailyCap.toLocaleString()}`} tone={usedPct >= 90 ? "bad" : usedPct >= 70 ? "warn" : undefined} />
          <StatRow label="Meta tier limit" value={limits.tier ? (TIER_LABELS[limits.tier] ?? limits.tier) : limits.metaError ? "unavailable" : "—"} />
          <StatRow label="Number quality" value={
            quality === "GREEN" ? <span className="text-brand-700">● GREEN</span>
            : quality === "YELLOW" ? <span className="text-amber-600">● YELLOW</span>
            : quality === "RED" ? <span className="text-red-600">● RED</span>
            : limits.metaError ? "unavailable" : (quality ?? "—")
          } />
          {limits.metaError && <p className="text-[11px] text-amber-600">Meta status check failed — {limits.metaError.length > 60 ? "Meta API unreachable right now (likely their outage)." : limits.metaError}</p>}
          <p className="text-[11px] text-slate-400">When the cap is reached, remaining sends queue and resume automatically after midnight. The cap protects your Meta tier and quality rating.</p>
        </>}
      </RailCard>
      <RailCard title="Sending health" action="Analytics" onAction={() => goTo("analytics")}>
        {!a ? railLoading : <>
          <StatRow label="Active contacts" value={a.contacts.active} onClick={() => goTo("contacts")} />
          <StatRow label="Opted out (auto-skipped)" value={a.contacts.optedOut} onClick={() => goTo("optouts")} />
          <StatRow label="Failed (14 days)" value={a.messaging.totals.failed} tone={a.messaging.totals.failed > 0 ? "warn" : undefined} />
        </>}
      </RailCard>
      <RailCard title="Templates" action="Manage" onAction={() => goTo("templates")}>
        {!tpls ? railLoading : <>
          <StatRow label="Approved — ready to send" value={byStatus("APPROVED")} />
          <StatRow label="Pending Meta review" value={byStatus("PENDING")} tone={byStatus("PENDING") > 0 ? "warn" : undefined} />
          <StatRow label="Rejected" value={byStatus("REJECTED")} tone={byStatus("REJECTED") > 0 ? "bad" : undefined} />
          {tpls.filter(t => t.status === "APPROVED").slice(0, 3).map(t => (
            <p key={t.name} className="text-[11px] font-mono text-ink-600 truncate border-t border-line pt-1.5">{t.name}</p>
          ))}
        </>}
      </RailCard>
      <RailCard title="Recent campaigns" action="History" onAction={() => goTo("campaigns")}>
        {!camps ? railLoading : camps.length === 0
          ? <p className="text-xs text-slate-400">No campaigns yet — your first send shows up here with its delivery funnel.</p>
          : camps.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-0.5 cursor-pointer hover:bg-canvas rounded-md px-1 -mx-1" onClick={() => goTo("campaigns")}>
              <span className="text-xs font-semibold text-ink-900 truncate">{c.name || c.templateName}</span>
              <span className="text-[11px] text-slate-400 shrink-0">{c.sentCount}/{c.totalRecipients} · {c.status}</span>
            </div>
          ))}
      </RailCard>
      <RailCard title="Good to know">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Marketing templates need Meta approval — submit from <b>Templates</b>, status updates here.</li>
          <li>Opted-out numbers are skipped automatically on every send.</li>
          <li>Use <b>Test before sending</b> to preview the exact message on your own phone.</li>
          <li>Event-driven sends (e.g. from your website/CRM) live in <b>API broadcasting</b> with rules and frequency caps.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// AI Knowledge Base: answer-engine split, latency/savings, personas, inbox.
type RouterStatsData = {
  total: number;
  counts: Record<string, number>;
  faqHitRate: number; cacheHitRate: number; memoryResolvedRate: number; ragUsageRate: number;
  avgLatencyMs: Record<string, number>;
  estTokensSaved: number;
  faqEntries?: number;
};

function KnowledgeRail({ goTo }: { goTo: (t: Tab) => void }) {
  const a = useAnalytics();
  const [rs, setRs] = useState<RouterStatsData | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; active: boolean }[] | null>(null);
  useEffect(() => { fetch("/api/admin/router/stats?days=7").then(r => r.json()).then(d => setRs(d.error ? null : d)).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents(d.agents ?? [])).catch(() => setAgents([])); }, []);
  const answered = rs ? (rs.counts.MEMORY_HIT ?? 0) + (rs.counts.FAQ_MATCH ?? 0) + (rs.counts.CACHE_HIT ?? 0) + (rs.counts.RAG_USED ?? 0) : 0;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Answer engine — 7 days">
        {!rs || answered === 0
          ? <p className="text-xs text-slate-400">No customer questions answered yet. Once chats flow in, you&apos;ll see how many were answered instantly (FAQ/cache) vs. by the full AI.</p>
          : <div className="space-y-2">
              <RailBar label="Instant — FAQ" count={rs.counts.FAQ_MATCH ?? 0} pct={rs.faqHitRate} color="bg-brand-700" />
              <RailBar label="Instant — cache" count={rs.counts.CACHE_HIT ?? 0} pct={rs.cacheHitRate} color="bg-brand-500" />
              <RailBar label="Remembered answer" count={rs.counts.MEMORY_HIT ?? 0} pct={rs.memoryResolvedRate} color="bg-brand-300" />
              <RailBar label="Full AI (RAG)" count={rs.counts.RAG_USED ?? 0} pct={rs.ragUsageRate} color="bg-ink-900" />
              <p className="text-[11px] text-slate-400 pt-1">{answered.toLocaleString()} answered · ~{rs.estTokensSaved.toLocaleString()} AI tokens saved{rs.avgLatencyMs.RAG_USED ? ` · AI avg ${rs.avgLatencyMs.RAG_USED}ms` : ""}</p>
            </div>}
      </RailCard>
      <RailCard title="AI personas" action="AI Hub" onAction={() => goTo("aihub")}>
        {!agents ? railLoading : agents.length === 0
          ? <p className="text-xs text-slate-400">No personas yet — create agents in AI Hub (e.g. Sales, Support) and the router switches between them per question.</p>
          : agents.map(ag => (
            <div key={ag.id} className="flex items-center gap-2 py-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${ag.active ? "bg-brand-500" : "bg-slate-300"}`} />
              <span className="text-xs font-semibold text-ink-900 truncate">{ag.name}</span>
              {ag.active && <span className="text-[10px] font-bold text-brand-700 ml-auto">DEFAULT</span>}
            </div>
          ))}
      </RailCard>
      <RailCard title="Conversations" action="Live Chat" onAction={() => goTo("livechat")}>
        {!a ? railLoading : <>
          <StatRow label="Awaiting your reply" value={a.conversations.needsReply} tone={a.conversations.needsReply > 0 ? "warn" : undefined} onClick={() => goTo("livechat")} />
          <StatRow label="Escalated" value={a.conversations.escalated} tone={a.conversations.escalated > 0 ? "bad" : undefined} onClick={() => goTo("livechat")} />
          <StatRow label="Total" value={a.conversations.total} />
        </>}
      </RailCard>
      <RailCard title="Make answers better">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Add course/brochure <b>URLs</b> to the knowledge base — the AI turns them into tappable buttons.</li>
          <li>Short FAQ-style docs answer fastest; the router serves them without calling the AI.</li>
          <li>Tune personas, functions, and auto-routing in <b>AI Hub</b>.</li>
          <li>Watch real replies land in <b>Live Chat</b> — toggle the bot off per chat to take over.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// Chatbot Flows: live flow stats + plain-language building guide.
function FlowsRail({ flows }: { flows: FlowSummary[] }) {
  const active = flows.filter(f => f.active).length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Flow status">
        <StatRow label="Active flows" value={active} />
        <StatRow label="Inactive" value={flows.length - active} tone={flows.length - active > 0 ? "warn" : undefined} />
        <StatRow label="Trigger keywords" value={flows.reduce((n, f) => n + f.triggerKeywords.length, 0)} />
      </RailCard>
      <RailCard title="How a flow runs">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li><b>Trigger</b> — a customer message matches a keyword (e.g. &quot;hi&quot;, &quot;menu&quot;).</li>
          <li><b>Steps</b> — menus, questions, forms, and messages run in order.</li>
          <li><b>Fallback</b> — anything off-script is answered by the AI, then the menu resumes.</li>
        </ol>
      </RailCard>
      <RailCard title="Blocks you can use">
        <ul className="space-y-1 text-[11px] text-slate-500">
          {([["Buttons / List", "tap-to-choose menus"], ["Ask & save", "store the answer on the contact"], ["WhatsApp form", "multi-field native form"], ["Send template", "approved template mid-flow"], ["Reminder", "nudge when there's no reply"], ["Business hours", "different paths day vs. night"], ["Webhook", "notify your other systems"]] as [string, string][]).map(([n, d]) => (
            <li key={n}><b className="text-ink-700">{n}</b> — {d}</li>
          ))}
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Every waiting block can send a <b>no-reply reminder</b> (inside WhatsApp&apos;s 24h window).</li>
          <li>Problems show as a <b>red outline</b> on the block, in plain English.</li>
          <li>Keep one flow per job — a menu flow, a lead flow — easier to test and edit.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// WhatsApp Forms: publish pipeline + where the answers land.
function FormsRail({ goTo, forms }: { goTo: (t: Tab) => void; forms: { status: string }[] }) {
  const c = (s: string) => forms.filter(f => f.status === s).length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Form status">
        <StatRow label="Published — live" value={c("PUBLISHED")} />
        <StatRow label="Drafts" value={c("DRAFT")} tone={c("DRAFT") > 0 ? "warn" : undefined} />
        <StatRow label="Deprecated" value={c("DEPRECATED")} />
      </RailCard>
      <RailCard title="From build to lead">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li><b>Build</b> — name, title, and fields (text, phone, email, dropdown, date…).</li>
          <li><b>Publish</b> — pushed to Meta; the form opens natively inside WhatsApp.</li>
          <li><b>Use</b> — drag the <b>WhatsApp form</b> block into a chatbot flow.</li>
          <li><b>Collect</b> — every answer saves to the contact&apos;s attributes automatically.</li>
        </ol>
        <button onClick={() => goTo("flows")} className="text-[11px] font-bold text-brand-700 flex items-center gap-1">Open Chatbot Flows <ArrowRight className="w-3 h-3" /></button>
      </RailCard>
      <RailCard title="Where answers show up">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li><b>Live Chat</b> — right panel, under &quot;Details collected&quot;.</li>
          <li><b>Contacts</b> — as attributes you can filter and broadcast by.</li>
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Short forms convert best — 3–5 fields.</li>
          <li>Published forms can&apos;t be edited — create a new version, deprecate the old.</li>
          <li>Mark only truly essential fields as required.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// AI Hub: setup status + how the pieces fit together.
function AiHubRail({ goTo, agents, fns, prompts, autoRoute, tone }: { goTo: (t: Tab) => void; agents: AiAgentT[]; fns: AiFunctionT[]; prompts: AiPromptT[]; autoRoute: boolean | null; tone: boolean | null }) {
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Hub status">
        <StatRow label="AI agents" value={agents.length} />
        <StatRow label="Default agent" value={agents.find(a => a.active)?.name ?? "—"} />
        <StatRow label="Auto-routing" value={autoRoute === null ? "…" : autoRoute ? "ON" : "OFF"} tone={autoRoute === false ? "warn" : undefined} />
        <StatRow label="Persona tone" value={tone === null ? "…" : tone ? "ON" : "OFF"} />
        <StatRow label="Lead-capture functions" value={fns.length} />
        <StatRow label="Writing tools" value={prompts.length} />
      </RailCard>
      <RailCard title="How it fits together">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li>A customer asks something on WhatsApp.</li>
          <li><b>Auto-routing</b> picks the best agent for that topic.</li>
          <li>The agent answers using your <b>AI Knowledge Base</b>.</li>
          <li>Mid-chat, <b>lead capture</b> quietly saves details — name, course, city…</li>
        </ol>
        <button onClick={() => goTo("assistant")} className="text-[11px] font-bold text-brand-700 flex items-center gap-1">Open AI Knowledge Base <ArrowRight className="w-3 h-3" /></button>
      </RailCard>
      <RailCard title="Starter setup">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Two agents: <b>Sales</b> (courses, fees, admission) and <b>Support</b> (existing students).</li>
          <li>One <b>capture_lead</b> function saving name, course interest, and city.</li>
          <li>Writing tools: Friendly tone, Translate to Hindi, Shorten.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// Settings: workspace counts, roles, and go-live reminders.
function SettingsRail({ goTo }: { goTo: (t: Tab) => void }) {
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [qrCount, setQrCount] = useState<number | null>(null);
  useEffect(() => { fetch("/api/admin/team/members").then(r => r.json()).then(d => setTeamCount((d.members ?? []).length)).catch(() => setTeamCount(0)); }, []);
  useEffect(() => { fetch("/api/admin/quick-replies").then(r => r.json()).then(d => setQrCount((d.quickReplies ?? []).length)).catch(() => setQrCount(0)); }, []);
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Workspace">
        <StatRow label="People with portal access" value={teamCount ?? "…"} />
        <StatRow label="Quick replies" value={qrCount ?? "…"} />
      </RailCard>
      <RailCard title="Who can do what">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li><b>Admins</b> — everything, including numbers, team, and settings.</li>
          <li><b>Members</b> — Live Chat, broadcasts, flows, templates, contacts.</li>
          <li>Every action is recorded in the <b>activity log</b> on this page.</li>
        </ul>
      </RailCard>
      <RailCard title="Message automations">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li><b>Welcome</b> — sent once, the first time a contact ever messages you.</li>
          <li><b>Away</b> — sent outside your business hours.</li>
          <li><b>Quick replies</b> — type <b>/</b> in the Live Chat composer to use them.</li>
        </ul>
      </RailCard>
      <RailCard title="Go-live reminders" action="Checklist" onAction={() => goTo("home")}>
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Keep your WhatsApp two-step PIN recorded somewhere safe.</li>
          <li>Rotate the admin password once setup is done.</li>
          <li>The cron heartbeat sends queued broadcasts every 5 minutes.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// ── Broadcast ────────────────────────────────────────────────────────────────
// ── Broadcast section: manual sends + API broadcasting + auto-sends ───────────
function BroadcastTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [sub, setSub] = useState<"now" | "api" | "auto">("now");
  const seg = (active: boolean) => `px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 ${active ? "bg-brand-700 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`;
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button className={seg(sub === "now")} onClick={() => setSub("now")}><Send className="w-4 h-4" />Broadcast now</button>
        <button className={seg(sub === "api")} onClick={() => setSub("api")}><Globe className="w-4 h-4" />API broadcasting</button>
        <button className={seg(sub === "auto")} onClick={() => setSub("auto")}><Zap className="w-4 h-4" />Auto-sends</button>
      </div>
      {sub === "now" && <BroadcastNow goTo={goTo} />}
      {sub === "api" && <ApiBroadcasting />}
      {sub === "auto" && <AutomationsTab />}
    </div>
  );
}

function BroadcastNow({ goTo }: { goTo: (t: Tab) => void }) {
  const [audMode, setAudMode] = useState<"all" | "tag" | "attribute" | "recipients">("all");
  const [tag, setTag] = useState("");
  const [attrKey, setAttrKey] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [languageCode, setLanguageCode] = useState("en_US");
  const [variables, setVariables] = useState("{name}");
  const [headerImageUrl, setHeaderImageUrl] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [replyFlowId, setReplyFlowId] = useState("");
  const [flows, setFlows] = useState<{ id: string; name: string; active: boolean; triggerKeywords?: string[] }[]>([]);
  const [templates, setTemplates] = useState<{ name: string; status: string; language: string; category: string; components?: { type: string; format?: string; text?: string }[] }[]>([]);
  const [manualTemplate, setManualTemplate] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retargetNote, setRetargetNote] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/templates${channelId ? `?channelId=${channelId}` : ""}`).then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  }, [channelId]);

  // Flows available to start when a recipient replies ("bot on broadcast").
  useEffect(() => {
    fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows(d.flows ?? [])).catch(() => {});
  }, []);

  // A "Retarget →" click in Campaign history lands here with the segment prefilled.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("wa_retarget");
      if (!raw) return;
      sessionStorage.removeItem("wa_retarget");
      const { note, recipients } = JSON.parse(raw) as { note: string; recipients: { phone: string; fullName: string }[] };
      setAudMode("recipients");
      setRecipientsText(recipients.map(r => `${r.phone}${r.fullName ? "," + r.fullName : ""}`).join("\n"));
      setRetargetNote(note);
    } catch { /* malformed payload — start blank */ }
  }, []);
  useEffect(() => {
    if (audMode === "recipients") { setCount(null); return; }
    fetch(`/api/admin/broadcast?mode=${audMode}&tag=${encodeURIComponent(tag)}&key=${encodeURIComponent(attrKey)}&value=${encodeURIComponent(attrValue)}`).then(r => r.json()).then(d => setCount(d.count ?? null)).catch(() => setCount(null));
  }, [audMode, tag, attrKey, attrValue]);

  function parseRecipients() {
    return recipientsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const [phone, ...rest] = line.split(",");
      return { phone: phone.trim(), name: rest.join(",").trim() };
    }).filter(r => r.phone);
  }

  async function send() {
    setError(null); setResult(null);
    const problem = templateProblem();
    if (problem) { setError(problem); return; }
    // Confirm before a real blast — this fires to the whole audience and can't
    // be undone. Show the authoritative recipient count so it's never a surprise.
    const who = recipientCount === null
      ? "your selected audience"
      : `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? "" : "s"}`;
    if (!confirm(`Send "${templateName.trim()}" to ${who}? This sends real WhatsApp messages and can't be undone.`)) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = {
        mode: audMode === "recipients" ? "recipients" : "audience",
        templateName: templateName.trim(),
        languageCode: languageCode.trim() || "en_US",
        variables: variables.split(/\r?\n/).map(v => v.trim()).filter(Boolean),
        headerImageUrl: headerImageUrl.trim() || null,
        channelId,
        replyFlowId: replyFlowId || null,
      };
      if (audMode === "recipients") body.recipients = parseRecipients();
      else body.audience = {
        mode: audMode,
        tag: audMode === "tag" ? tag.trim() : undefined,
        key: audMode === "attribute" ? attrKey.trim() : undefined,
        value: audMode === "attribute" ? attrValue.trim() : undefined,
      };
      const res = await fetch("/api/admin/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || !d.success) setError(d.error || "Failed"); else setResult(d.message);
    } catch { setError("Connection error"); }
    finally { setSending(false); }
  }

  // One-off test send — exact same template/variables/header as the real
  // broadcast, but to a single typed-in number with nothing recorded.
  async function sendTest() {
    setTestMsg(null);
    const problem = templateProblem();
    if (problem) { setTestMsg({ ok: false, text: problem }); return; }
    const [phone, ...rest] = testPhone.split(",");
    if (phone.replace(/\D/g, "").length < 10) { setTestMsg({ ok: false, text: "Enter a number with country code, e.g. 919876543210" }); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/broadcast/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(), name: rest.join(",").trim() || undefined,
          templateName: templateName.trim(), languageCode: languageCode.trim() || "en_US",
          variables: variables.split(/\r?\n/).map(v => v.trim()).filter(Boolean),
          headerImageUrl: headerImageUrl.trim() || null, channelId,
        }),
      });
      const d = await res.json();
      setTestMsg(res.ok && d.success ? { ok: true, text: `Test sent to ${phone.trim()} ✓ — check the phone.` } : { ok: false, text: d.error || "Test send failed" });
    } catch { setTestMsg({ ok: false, text: "Connection error" }); }
    finally { setTesting(false); }
  }

  const recipientCount = audMode === "recipients" ? parseRecipients().length : count;

  // Selected template details — drive the variable inputs and header field so
  // the form can only produce payloads Meta will accept (no #132018).
  const approved = templates.filter(t => t.status === "APPROVED");
  const selected = !manualTemplate ? approved.find(t => t.name === templateName && t.language === languageCode) : undefined;
  const comps = selected?.components ?? [];
  const headerFormat = comps.find(c => c.type === "HEADER")?.format ?? null;
  const needsImage = headerFormat === "IMAGE";
  const bodyPreview = comps.find(c => c.type === "BODY")?.text ?? "";
  const varCount = selected ? new Set(Array.from(bodyPreview.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size : 0;
  const varsArr = Array.from({ length: varCount }, (_, i) => variables.split(/\r?\n/)[i] ?? "");
  const setVar = (i: number, val: string) => setVariables(varsArr.map((v, j) => (j === i ? val : v)).join("\n"));

  function pickTemplate(value: string) {
    if (value === "__manual") { setManualTemplate(true); setTemplateName(""); return; }
    setManualTemplate(false);
    const [n, l] = value.split("|");
    setTemplateName(n ?? ""); setLanguageCode(l || "en_US");
    setHeaderImageUrl("");                       // never carry a header into a template that lacks one
    const t = approved.find(x => x.name === n && x.language === l);
    const bt = t?.components?.find(c => c.type === "BODY")?.text ?? "";
    const nVars = new Set(Array.from(bt.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size;
    setVariables(Array.from({ length: nVars }, (_, i) => (i === 0 ? "{name}" : "")).join("\n"));
  }

  // Shared pre-send validation for both real sends and tests.
  function templateProblem(): string | null {
    if (!templateName.trim()) return "Pick an approved template first.";
    if (selected && needsImage && !headerImageUrl.trim()) return "This template has an image header — add or upload the image first.";
    if (selected && varCount > 0 && varsArr.some(v => !v.trim())) return `Fill all ${varCount} variable value(s) — the template's text has {{${varCount}}} placeholders.`;
    return null;
  }

  // Live WhatsApp-style preview of the selected template, mirrored into the rail.
  const filledBody = bodyPreview.replace(/\{\{(\d+)\}\}/g, (_, d) => varsArr[Number(d) - 1]?.trim() || `{{${d}}}`);
  const previewFooter = comps.find(c => c.type === "FOOTER")?.text ?? "";
  const previewButtons = ((comps.find(c => c.type === "BUTTONS") as { buttons?: { text?: string }[] } | undefined)?.buttons) ?? [];
  const previewCard = (
    <div className="bg-white rounded-card border border-line p-4">
      <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-2">Preview</p>
      {selected ? (
        <div className="bg-[#e5ddd5] rounded-control p-3">
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            {needsImage && (headerImageUrl.trim()
              ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headerImageUrl} alt="" className="w-full h-32 object-cover" />
              )
              : <div className="h-32 bg-slate-200 flex items-center justify-center text-slate-400"><ImageIcon className="w-6 h-6" /></div>)}
            <p className="px-3 py-2 text-[13px] text-slate-800 whitespace-pre-wrap break-words">{filledBody || "Your message appears here…"}</p>
            {previewFooter.trim() && <p className="px-3 pb-1 text-[11px] text-slate-400">{previewFooter}</p>}
            <p className="px-3 pb-1.5 text-right text-[10px] text-slate-300">10:30</p>
            {previewButtons.map((b, i) => (
              <div key={i} className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600">{b.text || "Button"}</div>
            ))}
          </div>
        </div>
      ) : <p className="text-xs text-ink-400">Pick a template above to preview the message your contacts will see.</p>}
    </div>
  );

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-2xl space-y-5">
      <h2 className="text-xl font-extrabold text-brand-dark">Broadcast</h2>

      {retargetNote && (
        <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-sm text-brand-700 flex items-center justify-between">
          <span><b>{retargetNote}</b> — recipients prefilled below. Pick a template and send.</span>
          <button onClick={() => { setRetargetNote(null); setRecipientsText(""); setAudMode("all"); }} className="text-brand-600 font-bold">×</button>
        </div>
      )}

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Who</p>
        <div className="flex gap-2 flex-wrap">
          {(["all", "tag", "attribute", "recipients"] as const).map(m => (
            <button key={m} onClick={() => setAudMode(m)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${audMode === m ? "border-brand-dark bg-brand-700 text-white" : "border-line text-slate-600"}`}>
              {m === "all" ? "All contacts" : m === "tag" ? "By tag" : m === "attribute" ? "By attribute" : "Paste list"}
            </button>
          ))}
        </div>
        {audMode === "tag" && <input className={`${inp} w-full`} placeholder="tag (e.g. webinar-june)" value={tag} onChange={e => setTag(e.target.value)} />}
        {audMode === "attribute" && (
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="attribute key (e.g. city)" value={attrKey} onChange={e => setAttrKey(e.target.value)} />
            <input className={inp} placeholder="value (e.g. Mumbai)" value={attrValue} onChange={e => setAttrValue(e.target.value)} />
          </div>
        )}
        {audMode === "recipients"
          ? <textarea className={`${inp} w-full font-mono`} rows={4} placeholder={"919876543210, Asha\n919812345678, Ravi"} value={recipientsText} onChange={e => setRecipientsText(e.target.value)} />
          : <p className="text-sm text-slate-600">{recipientCount === null ? "—" : <><b className="text-brand-dark">{recipientCount.toLocaleString()}</b> active contacts will receive this.</>}</p>}
      </section>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Message (approved template)</p>
          <ChannelSelect value={channelId} onChange={setChannelId} allLabel="Send from: default number" className={`${inp} !py-1.5 text-xs`} />
        </div>
        {!manualTemplate ? (
          <select className={`${inp} w-full`} value={selected ? `${selected.name}|${selected.language}` : ""} onChange={e => pickTemplate(e.target.value)}>
            <option value="">{approved.length ? "Choose an approved template…" : "No approved templates yet — create one in Templates"}</option>
            {approved.map(t => (
              <option key={`${t.name}-${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} · {t.language} · {t.category}{t.components?.some(c => c.type === "HEADER" && c.format === "IMAGE") ? " · 🖼 image" : ""}
              </option>
            ))}
            <option value="__manual">Other — type a template name manually…</option>
          </select>
        ) : (
          <div className="grid grid-cols-[1fr_7rem_auto] gap-2 items-center">
            <input className={inp} placeholder="template name" value={templateName} onChange={e => setTemplateName(e.target.value)} />
            <input className={inp} placeholder="en_US" value={languageCode} onChange={e => setLanguageCode(e.target.value)} />
            <button onClick={() => { setManualTemplate(false); setTemplateName(""); }} className="text-xs font-bold text-brand-700 hover:underline">use list</button>
          </div>
        )}

        {selected && bodyPreview && (
          <div className="bg-canvas rounded-control px-3 py-2 text-xs text-ink-600 whitespace-pre-wrap">{bodyPreview}</div>
        )}

        {selected ? (
          varCount === 0 ? (
            <p className="text-[11px] text-slate-400">This template has no variables — nothing else to fill in.</p>
          ) : (
            <div className="space-y-1.5">
              {varsArr.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 w-12 shrink-0">{`{{${i + 1}}}`}</span>
                  <input className={`${inp} flex-1`} placeholder={i === 0 ? "{name} — fills each contact's first name" : `Value for {{${i + 1}}}`} value={v} onChange={e => setVar(i, e.target.value)} />
                </div>
              ))}
              <p className="text-[11px] text-slate-400">Tip: <b>{"{name}"}</b> is replaced with each recipient&apos;s first name automatically.</p>
            </div>
          )
        ) : (
          <textarea className={`${inp} w-full font-mono`} rows={2} placeholder={"Variables, one per line\n{name}"} value={variables} onChange={e => setVariables(e.target.value)} />
        )}

        {(!selected || needsImage) && (
          <div className="space-y-1">
            {needsImage && <p className="text-[11px] font-bold text-amber-600">This template has an image header — an image is required.</p>}
            <div className="flex items-center gap-3">
              <input className={`${inp} flex-1`} placeholder={needsImage ? "Header image URL (required)" : "Header image URL (only if the template has an image header)"} value={headerImageUrl} onChange={e => setHeaderImageUrl(e.target.value)} />
              <ImageUpload onUploaded={setHeaderImageUrl} />
            </div>
          </div>
        )}
        {selected && headerFormat && headerFormat !== "IMAGE" && headerFormat !== "TEXT" && (
          <p className="text-[11px] text-amber-600">This template has a {headerFormat.toLowerCase()} header — broadcasting that header type isn&apos;t supported yet.</p>
        )}
      </section>

      <section className="bg-white rounded-card border border-line p-5 space-y-2">
        <p className="text-xs font-bold text-slate-400 uppercase">When they reply — start a flow <span className="text-slate-300 normal-case font-normal">(optional)</span></p>
        <p className="text-xs text-slate-500">Pick a chatbot flow to run automatically when a recipient replies to this broadcast — a tap on a template button or any message. Their first reply starts it (no trigger keyword needed); it stays armed for 7 days.</p>
        <select className={`${inp} w-full`} value={replyFlowId} onChange={e => setReplyFlowId(e.target.value)}>
          <option value="">No flow — replies go to Live Chat / AI as usual</option>
          {flows.filter(f => f.active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {replyFlowId && (() => {
          const f = flows.find(x => x.id === replyFlowId);
          return f ? <p className="text-[11px] text-brand-700 font-semibold">▶ Replies to this broadcast will start <b>{f.name}</b> from its first step.</p> : null;
        })()}
        {flows.filter(f => f.active).length === 0 && <p className="text-[11px] text-amber-600">No active flows yet — build one in the Flows tab first.</p>}
      </section>

      <section className="bg-white rounded-card border border-line p-5 space-y-2">
        <p className="text-xs font-bold text-slate-400 uppercase">Test before sending</p>
        <p className="text-xs text-slate-500">Sends this exact message to one number — not saved as a campaign, contact, or log entry.</p>
        <div className="flex items-center gap-2">
          <input
            className={`${inp} flex-1`} placeholder="919876543210, Name (optional)"
            value={testPhone} onChange={e => setTestPhone(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendTest(); }}
          />
          <button onClick={sendTest} disabled={testing} className="shrink-0 px-4 py-2 rounded-control border border-brand-700 text-brand-700 hover:bg-brand-50 text-sm font-bold flex items-center gap-1.5 disabled:opacity-60">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send test
          </button>
        </div>
        {testMsg && <p className={`text-xs font-semibold ${testMsg.ok ? "text-brand-700" : "text-red-600"}`}>{testMsg.text}</p>}
      </section>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {result && <div className="bg-brand-green/10 border border-brand-green/40 rounded-lg px-4 py-3 text-sm text-brand-dark font-semibold">{result}</div>}

      <button onClick={send} disabled={sending} className="w-full py-3 rounded-card bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send broadcast
      </button>
    </div>
    <BroadcastRail goTo={goTo} preview={previewCard} />
    </div>
  );
}

function ImageUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-slate-300 text-sm cursor-pointer ${busy ? "opacity-60" : ""}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Upload
      <input type="file" accept="image/*" className="hidden" onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return; setBusy(true);
        try { const fd = new FormData(); fd.append("file", f); const r = await fetch("/api/upload", { method: "POST", body: fd }); const d = await r.json(); if (d.url) onUploaded(d.url); } finally { setBusy(false); e.currentTarget.value = ""; }
      }} />
    </label>
  );
}

// ── AI Assistant ───────────────────────────────────────────────────────────────
type KbDoc = { id: string; title: string; sourceType: "pdf" | "docx" | "text" | "url"; status: "processing" | "ready" | "failed"; chunkCount: number; error?: string | null; createdAt: string; lastSyncedAt?: string | null; tag?: string | null };
type Conversation = { id: string; phone: string; name?: string | null; status: "active" | "paused" | "escalated"; botEnabled: boolean; lastMessage?: string | null; lastInboundAt?: string | null; lastOutboundAt?: string | null; needsReply?: boolean; labels?: string[]; assignedTo?: string | null; agentId?: string | null; channelId?: string | null; platform?: "whatsapp" | "instagram"; avatarUrl?: string | null; isComment?: boolean };

// Avatar that shows the profile image when available, falling back to the
// initial if there's no image or it fails to load (IG image URLs can expire).
function ConvAvatar({ url, label, size = 36 }: { url?: string | null; label: string; size?: number }) {
  const [err, setErr] = useState(false);
  const initial = (label || "?").slice(0, 1).toUpperCase();
  if (url && !err) return <img src={url} alt="" onError={() => setErr(true)} className="rounded-full object-cover bg-canvas" style={{ width: size, height: size }} />;
  return <div className="rounded-full bg-gradient-to-br from-brand-600 to-brand-900 text-white flex items-center justify-center font-bold shrink-0" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>{initial}</div>;
}

const PIPELINE: { icon: React.ReactNode; title: string; desc: string }[] = [
  { icon: <MessageSquare className="w-5 h-5" />, title: "Inbound", desc: "Customer sends a WhatsApp message" },
  { icon: <Database className="w-5 h-5" />, title: "Retrieve", desc: "Search business docs (pgvector) for relevant context" },
  { icon: <Sparkles className="w-5 h-5" />, title: "Draft", desc: "Gemini drafts a reply grounded in that context" },
  { icon: <ShieldCheck className="w-5 h-5" />, title: "Guardrails", desc: "Opt-out, grounding & escalation checks" },
  { icon: <Send className="w-5 h-5" />, title: "Reply", desc: "Delivered on WhatsApp (within 24h window)" },
];

function statusBadge(s: string) {
  const map: Record<string, string> = {
    ready: "bg-brand-green/15 text-brand-dark", active: "bg-brand-green/15 text-brand-dark",
    processing: "bg-amber-100 text-amber-700", paused: "bg-slate-100 text-slate-600",
    failed: "bg-red-100 text-red-700", escalated: "bg-red-100 text-red-700",
  };
  return `px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[s] ?? "bg-slate-100 text-slate-600"}`;
}

function AssistantTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [backendReady, setBackendReady] = useState(true);

  const load = useCallback(() => {
    fetch("/api/admin/kb").then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setDocs(d.documents ?? []); setEnabled(d.botEnabled ?? null); setBackendReady(true); })
      .catch(() => setBackendReady(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Bot className="w-5 h-5" /> AI Knowledge Base</h2>
          <p className="text-sm text-slate-500">Teach and test the AI here — knowledge base + dry-run testing. Customer conversations live in <b>Live Chat</b>.</p>
        </div>
        <span className={statusBadge(enabled ? "active" : enabled === false ? "paused" : "processing")}>
          {enabled === null ? "status unknown" : enabled ? "● live" : "○ paused"}
        </span>
      </div>

      {!backendReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <b>Backend not wired yet.</b> This view shows the planned flow. The knowledge base and conversations populate once the assistant backend (migrations + Gemini + webhook) is built — see <code className="bg-amber-100 px-1 rounded">AUTOMATION-PLAN.md</code>.
        </div>
      )}

      {/* Pipeline */}
      <section className="bg-white rounded-card border border-line p-5">
        <p className="text-xs font-bold text-slate-400 uppercase mb-4">How a reply is produced</p>
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {PIPELINE.map((s, i) => (
            <div key={s.title} className="flex items-stretch gap-1 shrink-0">
              <div className="w-36 shrink-0 rounded-lg border border-line bg-slate-50 p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-brand-dark font-bold text-sm">{s.icon}{s.title}</div>
                <p className="text-[11px] leading-snug text-slate-500">{s.desc}</p>
              </div>
              {i < PIPELINE.length - 1 && <div className="flex items-center text-slate-300"><ArrowRight className="w-4 h-4" /></div>}
            </div>
          ))}
        </div>
      </section>

      {/* Test the assistant (no WhatsApp send) */}
      <TestAssistantBox />

      {/* Knowledge base */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Knowledge base</p>
          <span className="text-xs text-slate-400">{docs.length} document{docs.length === 1 ? "" : "s"}</span>
        </div>
        <KbAddForm onAdded={load} disabled={!backendReady} />
        <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
          {docs.map(d => (
            <div key={d.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                {d.sourceType === "url" ? <Globe className="w-4 h-4 text-slate-400 shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-dark truncate">{d.title}</p>
                  <p className="text-[11px] text-slate-400">{d.sourceType.toUpperCase()}{d.tag ? ` · #${d.tag}` : ""} · {d.chunkCount} chunks{d.sourceType === "url" ? ` · auto-updates${d.lastSyncedAt ? ` · synced ${new Date(d.lastSyncedAt).toLocaleDateString()}` : ""}` : ""}{d.error ? ` · ${d.error}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <input className="w-24 border border-line rounded px-1.5 py-0.5 text-[11px] text-ink-700 placeholder:text-ink-300" placeholder="+ topic tag" title="Tag this doc so a flow can use it as primary knowledge (Enter to save)" defaultValue={d.tag ?? ""}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onBlur={e => { const v = e.target.value.trim(); if (v !== (d.tag ?? "")) fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retag: d.id, tag: v || null }) }).then(load).catch(() => {}); }} />
                <span className={statusBadge(d.status)}>{d.status}</span>
                {d.sourceType === "url" && <button title="Sync now — re-crawl this page" onClick={() => fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resync: d.id }) }).then(load).catch(() => {})} className="p-1.5 text-slate-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg"><RefreshCw className="w-4 h-4" /></button>}
                <button onClick={() => fetch("/api/admin/kb", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) }).then(load).catch(() => {})} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {docs.length === 0 && <p className="text-center text-slate-400 text-sm py-6">No documents yet — add PDFs, text, or a URL above to ground the assistant.</p>}
        </div>
      </section>

    </div>
    <KnowledgeRail goTo={goTo} />
    </div>
  );
}

type ThreadMessage = { id: string; role: "user" | "assistant"; body: string; source: "inbound" | "bot" | "agent"; createdAt: string };

// ── Live Chat: 3-pane chat workspace (list / thread / contact info) ──────────
function LiveChatTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "needs_reply" | "escalated" | "bot_off">("all");
  const [platform, setPlatform] = useState<"all" | "whatsapp" | "instagram">("all");
  const [view, setView] = useState<"chats" | "comments">("chats");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/conversations").then(r => r.ok ? r.json() : { conversations: [] })
      .then(d => setConvos(d.conversations ?? [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const q = search.trim().toLowerCase();
  const onPlatform = (c: Conversation, p: "whatsapp" | "instagram") => (c.platform ?? "whatsapp") === p;
  // Split comment threads (IG comment → AI reply) from real DM chats.
  const chatsCount = convos.filter(c => !c.isComment).length;
  const commentsCount = convos.filter(c => !!c.isComment).length;
  const inView = convos.filter(c => view === "comments" ? !!c.isComment : !c.isComment);
  const visible = inView
    .filter(c => platform === "all" ? true : onPlatform(c, platform))
    .filter(c => filter === "all" ? true : filter === "needs_reply" ? !!c.needsReply : filter === "escalated" ? c.status === "escalated" : !c.botEnabled)
    .filter(c => !q || (c.name ?? "").toLowerCase().includes(q) || c.phone.includes(q));
  const waCount = inView.filter(c => onPlatform(c, "whatsapp")).length;
  const igCount = inView.filter(c => onPlatform(c, "instagram")).length;

  const timeAgo = (iso: string | null) => {
    if (!iso) return "";
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
    return `${Math.floor(mins / (24 * 60))}d`;
  };

  return (
    <div className="-m-6 h-[calc(100vh-64px)] flex bg-white overflow-hidden">
      {/* Conversation list */}
      <aside className="w-80 shrink-0 border-r border-line flex flex-col min-h-0">
        <div className="p-4 pb-3 space-y-3 border-b border-line">
          <p className="text-[15px] font-bold text-ink-900">{view === "comments" ? "Comments" : "Live Chat"} <span className="text-xs font-normal text-ink-400">({visible.length})</span></p>
          {/* Chats vs Comments — comment threads (IG comment → AI reply) live in
              their own section so they don't clutter real DM conversations. */}
          <div className="flex gap-1 p-0.5 bg-canvas rounded-control">
            {([["chats", "Chats", chatsCount], ["comments", "Comments", commentsCount]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => { setView(k); setSelected(null); setPlatform("all"); }} className={`flex-1 px-2 py-1.5 rounded-[7px] text-[12px] font-bold flex items-center justify-center gap-1.5 transition-colors ${view === k ? "bg-white shadow-sm text-ink-900" : "text-ink-400 hover:text-ink-600"}`}>
                {k === "chats" ? <MessageSquare className="w-3 h-3" /> : <Instagram className="w-3 h-3 text-pink-600" />}
                {label} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="w-full border border-line rounded-control pl-8 pr-3 py-2 text-sm bg-canvas text-ink-900 placeholder:text-ink-400" placeholder="Search name or number" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {/* Platform toggle — only for Chats; comments are Instagram-only. */}
          {view === "chats" && (
          <div className="flex gap-1 p-0.5 bg-canvas rounded-control">
            {([["all", "All", inView.length], ["whatsapp", "WhatsApp", waCount], ["instagram", "Instagram", igCount]] as const).map(([k, label, n]) => (
              <button key={k} onClick={() => setPlatform(k)} className={`flex-1 px-2 py-1.5 rounded-[7px] text-[11px] font-bold flex items-center justify-center gap-1 transition-colors ${platform === k ? "bg-white shadow-sm text-ink-900" : "text-ink-400 hover:text-ink-600"}`}>
                {k === "whatsapp" && <MessageCircle className="w-3 h-3 text-green-600" />}
                {k === "instagram" && <Instagram className="w-3 h-3 text-pink-600" />}
                {label} <span className="opacity-60">{n}</span>
              </button>
            ))}
          </div>
          )}
          <div className="flex gap-1 flex-wrap">
            {([["all", "All"], ["needs_reply", "Needs reply"], ["escalated", "Escalated"], ["bot_off", "Human"]] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${filter === k ? "bg-ink-950 text-white" : "bg-canvas text-ink-400 hover:text-ink-600"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visible.map(c => (
            <button key={c.id} onClick={() => setSelected(c.id)}
              className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-line/60 transition-colors ${selected === c.id ? "bg-brand-50" : "hover:bg-canvas"}`}>
              <div className="relative shrink-0 mt-0.5">
                <ConvAvatar url={c.avatarUrl} label={c.name || c.phone} size={36} />
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white border border-line flex items-center justify-center" title={c.platform === "instagram" ? "Instagram" : "WhatsApp"}>
                  {c.platform === "instagram" ? <Instagram className="w-2.5 h-2.5 text-pink-600" /> : <MessageCircle className="w-2.5 h-2.5 text-green-600" />}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink-900 truncate">{c.name || c.phone}</p>
                  <span className="text-[10px] text-ink-400 shrink-0">{timeAgo(c.lastInboundAt ?? c.lastOutboundAt ?? null)}</span>
                </div>
                <p className="text-[12px] text-ink-400 truncate">{c.lastMessage ?? "—"}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {c.needsReply && <span className="w-2 h-2 rounded-full bg-brand-500" title="awaiting reply" />}
                  {c.status === "escalated" && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">ESCALATED</span>}
                  {!c.botEnabled && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-canvas text-ink-400">BOT OFF</span>}
                  {c.assignedTo && <span className="text-[9px] font-bold text-brand-700 truncate">@{c.assignedTo}</span>}
                </div>
              </div>
            </button>
          ))}
          {visible.length === 0 && <p className="text-center text-ink-400 text-sm py-10">No conversations{q || filter !== "all" ? " match this filter" : " yet"}.</p>}
        </div>
      </aside>

      {selected
        ? <ChatView key={selected} id={selected} onChanged={load} goTo={goTo} />
        : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-400 bg-canvas/40">
            <div className="w-14 h-14 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center"><MessageSquare className="w-6 h-6" /></div>
            <p className="text-sm font-medium">Select a conversation to start chatting</p>
          </div>
        )}
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
    <div className="border border-line rounded-control bg-canvas/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-ink-600 uppercase tracking-[0.06em] flex items-center gap-1.5"><LayoutTemplate className="w-3.5 h-3.5" /> Send approved template</p>
        <button onClick={onClose} className="text-ink-400 hover:text-ink-900"><X className="w-4 h-4" /></button>
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
          {hiddenCount > 0 && <p className="text-[10px] text-ink-400">{hiddenCount} template{hiddenCount > 1 ? "s" : ""} with media headers hidden — send those from the Broadcast tab.</p>}
          <div className="flex items-center justify-end">
            <button
              onClick={() => selected && onSend({ templateName: selected.name, languageCode: selected.language, bodyParams: vars.slice(0, varCount).map(v => v.trim()), preview: preview() })}
              disabled={busy || !selected || !filled}
              className="px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send template</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Middle thread + right contact-info pane for one conversation.
function ChatView({ id, onChanged, goTo }: { id: string; onChanged: () => void; goTo: (t: Tab) => void }) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [showButtons, setShowButtons] = useState(false);
  const [btns, setBtns] = useState<string[]>(["", "", ""]);
  const [quickReplies, setQuickReplies] = useState<{ id: string; shortcut: string; body: string }[]>([]);
  const [showQuick, setShowQuick] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  const [team, setTeam] = useState<{ name: string; email: string; title: string }[]>([]);
  const [aiPrompts, setAiPrompts] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [showAssist, setShowAssist] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [aiAgents, setAiAgents] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [actError, setActError] = useState("");
  const [showTemplate, setShowTemplate] = useState(false);
  const [contact, setContact] = useState<{ email: string | null; tags: string[]; attributes: Record<string, string> } | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCount = useRef(0);

  const load = useCallback(() => {
    fetch(`/api/admin/conversations/${id}`).then(r => r.json()).then(d => { setConv(d.conversation ?? null); setMessages(d.messages ?? []); }).catch(() => {});
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // Live thread: poll every 4s so inbound messages, AI replies, and flow
  // sends appear without a manual refresh.
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 4_000);
    return () => clearInterval(t);
  }, [load]);
  // Contact card (tags + attributes collected by flows/forms/AI functions).
  useEffect(() => {
    if (!conv?.phone) return;
    fetch(`/api/admin/contacts?search=${encodeURIComponent(conv.phone)}&limit=1`).then(r => r.json())
      .then(d => { const c = (d.contacts ?? [])[0]; setContact(c ? { email: c.email, tags: c.tags ?? [], attributes: c.attributes ?? {} } : null); })
      .catch(() => {});
  }, [conv?.phone]);
  // Stick to the bottom when new messages arrive (jump on first paint).
  useEffect(() => {
    if (messages.length !== prevCount.current) {
      bottomRef.current?.scrollIntoView({ behavior: prevCount.current === 0 ? "auto" : "smooth" });
      prevCount.current = messages.length;
    }
  }, [messages.length]);
  useEffect(() => { fetch("/api/admin/quick-replies").then(r => r.json()).then(d => setQuickReplies(d.quickReplies ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/team/members").then(r => r.json()).then(d => setTeam(d.members ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/ai/prompts").then(r => r.json()).then(d => setAiPrompts((d.prompts ?? []).filter((p: { active: boolean }) => p.active))).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAiAgents(d.agents ?? [])).catch(() => {}); }, []);

  async function applyAssist(promptId: string) {
    if (!reply.trim()) return;
    setAssisting(true);
    try {
      const d = await fetch("/api/admin/ai/transform", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ promptId, text: reply }) }).then(r => r.json());
      if (d.result) setReply(d.result);
    } finally { setAssisting(false); setShowAssist(false); }
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
  async function sendReply() {
    if (!reply.trim()) return;
    const buttons = btns.map(b => b.trim()).filter(Boolean);
    // Keep the draft on failure so the agent can retry without retyping.
    const ok = await act({ action: "reply", body: reply.trim(), ...(buttons.length ? { buttons } : {}) });
    if (ok) { setReply(""); setBtns(["", "", ""]); setShowButtons(false); }
  }
  async function sendTemplate(p: { templateName: string; languageCode: string; bodyParams: string[]; preview: string }) {
    const ok = await act({ action: "template", ...p });
    if (ok) setShowTemplate(false);
  }
  // Free-form replies only deliver inside Meta's 24h window; outside it the agent
  // must send an approved template. WhatsApp only — IG has no template path.
  const windowClosed = !!conv && conv.platform !== "instagram" &&
    (!conv.lastInboundAt || Date.now() - new Date(conv.lastInboundAt).getTime() > 24 * 60 * 60 * 1000);

  return (
    <>
      {/* ── Middle: thread ── */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="h-14 shrink-0 px-5 border-b border-line flex items-center justify-between gap-3 bg-white">
          <div className="min-w-0 flex items-center gap-3">
            <ConvAvatar url={conv?.avatarUrl} label={conv?.name || conv?.phone || "?"} size={36} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink-900 truncate leading-tight">{conv?.name || conv?.phone || "Conversation"}</p>
              {conv && <p className="font-mono text-[11px] text-ink-400 leading-tight">{conv.phone}</p>}
            </div>
            {conv && <span className={statusBadge(conv.status)}>{conv.status}</span>}
          </div>
          {conv && (
            <div className="flex items-center gap-2 shrink-0 text-xs">
              <button disabled={busy} onClick={() => act({ action: "bot", enabled: !conv.botEnabled })}
                className={`px-2.5 py-1.5 rounded-control border font-semibold ${conv.botEnabled ? "border-line text-ink-600 hover:bg-canvas" : "border-brand-700 bg-brand-700 text-white"}`}>
                {conv.botEnabled ? "Turn bot off" : "Turn bot on"}
              </button>
              {conv.status !== "escalated"
                ? <button disabled={busy} onClick={() => act({ action: "status", status: "escalated" })} className="px-2.5 py-1.5 rounded-control border border-red-200 text-red-600 font-semibold hover:bg-red-50">Escalate</button>
                : <button disabled={busy} onClick={() => act({ action: "status", status: "active" })} className="px-2.5 py-1.5 rounded-control border border-line text-ink-600 font-semibold hover:bg-canvas">Mark active</button>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 bg-canvas/60">
          {messages.map(m => {
            // Form lifecycle markers render as status cards, not plain bubbles.
            if (m.body === "[form-abandoned]") {
              return <div key={m.id} className="flex justify-center"><span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">⚠️ Form not completed</span></div>;
            }
            const isComment = m.body.startsWith("[comment] ");
            const body = isComment ? m.body.slice(10) : m.body;
            const submitted = body.startsWith("[form] ");
            const sentMatch = body.match(/^([\s\S]*?)\n\[form:\s*(.+?)\]\s*$/);
            return (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[72%] rounded-xl px-3.5 py-2 text-sm shadow-sm ${submitted ? "bg-emerald-50 border border-emerald-200 text-ink-900" : isComment ? "bg-pink-50 border border-pink-200 text-ink-900" : m.role === "user" ? "bg-white border border-line text-ink-900" : "bg-brand-100 text-ink-900"}`}>
                  {isComment && <p className="text-[10px] font-bold text-pink-600 mb-0.5 flex items-center gap-1"><Instagram className="w-3 h-3" /> {m.role === "user" ? "comment" : "comment reply"}</p>}
                  {submitted ? (
                    <div>
                      <p className="text-[11px] font-bold text-emerald-700 mb-1">✅ Form submitted</p>
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
                      <p className="whitespace-pre-wrap break-words">{sentMatch[1]}</p>
                      <p className="mt-1 text-[11px] font-bold text-brand-700">📋 Form sent · {sentMatch[2]}</p>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words">{body}</p>
                  )}
                  <p className={`text-[10px] mt-1 ${m.role === "user" ? "text-ink-400" : "text-brand-900/50"}`}>
                    {m.role === "user" ? "" : m.source === "bot" ? "AI · " : "agent · "}{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          {messages.length === 0 && <p className="text-center text-ink-400 text-sm py-10">No messages yet.</p>}
          <div ref={bottomRef} />
        </div>

        <div className="px-5 py-3 border-t border-line space-y-2 bg-white">
          {actError && (
            <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">
              ⚠ {actError}{/Invalid OAuth|access token|credentials not configured/i.test(actError) ? " — WhatsApp (Meta) credentials are not set yet, so messages can't actually send." : ""}
            </p>
          )}
          {windowClosed && (
            <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-3 py-2 flex items-center justify-between gap-2">
              <span>⏱ Outside WhatsApp&apos;s 24-hour window — free-form replies won&apos;t deliver. Send an approved template to re-open the chat (a paid, business-initiated message).</span>
              {!showTemplate && <button onClick={() => setShowTemplate(true)} className="shrink-0 px-2 py-1 rounded-control bg-amber-600 text-white font-bold hover:bg-amber-700">Send template</button>}
            </div>
          )}
          {showTemplate && conv && (
            <TemplateComposer channelId={conv.channelId} busy={busy} onClose={() => setShowTemplate(false)} onSend={sendTemplate} />
          )}
          {showQuick && quickReplies.length > 0 && (
            <div className="flex gap-1.5 flex-wrap max-h-24 overflow-y-auto">
              {quickReplies.map(q => (
                <button key={q.id} onClick={() => { setReply(q.body); setShowQuick(false); }} title={q.body} className="px-2 py-1 rounded-full border border-line text-[11px] font-bold text-ink-600 hover:border-brand-700">/{q.shortcut}</button>
              ))}
            </div>
          )}
          {showAssist && (
            <div className="flex gap-1.5 flex-wrap">
              {aiPrompts.length === 0 && <p className="text-[11px] text-ink-400">No AI prompts yet — add them in the AI Hub tab.</p>}
              {aiPrompts.map(p => (
                <button key={p.id} onClick={() => applyAssist(p.id)} disabled={assisting || !reply.trim()} className="px-2 py-1 rounded-full border border-brand-100 text-[11px] font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-40">✨ {p.name}</button>
              ))}
            </div>
          )}
          {showButtons && (
            <div className="grid grid-cols-3 gap-2">
              {btns.map((b, i) => (
                <input key={i} className={`${inp} text-xs`} maxLength={20} placeholder={`Button ${i + 1}`} value={b} onChange={e => setBtns(prev => prev.map((v, j) => (j === i ? e.target.value : v)))} />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea className={`${inp} flex-1 resize-none`} rows={2} placeholder="Type a reply… (type / for quick replies, ⌘↵ to send)" value={reply}
              onChange={e => { setReply(e.target.value); if (e.target.value === "/") setShowQuick(true); }}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(); }} />
            <button onClick={() => setShowQuick(s => !s)} title="Quick replies" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showQuick ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}>⚡</button>
            <button onClick={() => setShowAssist(s => !s)} disabled={assisting} title="AI assist (rewrite draft)" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showAssist ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}>{assisting ? <Loader2 className="w-4 h-4 animate-spin" /> : "✨"}</button>
            <button onClick={() => setShowButtons(s => !s)} title="Quick-reply buttons" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showButtons ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}>⊞</button>
            {conv?.platform !== "instagram" && (
              <button onClick={() => setShowTemplate(s => !s)} title="Send approved template (works outside the 24h window)" className={`px-2.5 py-2 rounded-control border text-sm font-bold ${showTemplate ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-400 hover:bg-canvas"}`}><LayoutTemplate className="w-4 h-4" /></button>
            )}
            <button onClick={sendReply} disabled={busy || !reply.trim()} className="px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold disabled:opacity-60 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
            </button>
          </div>
        </div>
      </section>

      {/* ── Right: contact info ── */}
      <aside className="w-80 shrink-0 border-l border-line overflow-y-auto bg-white">
        <div className="p-5 flex flex-col items-center text-center border-b border-line">
          <ConvAvatar url={conv?.avatarUrl} label={conv?.name || conv?.phone || "?"} size={64} />
          <p className="text-[15px] font-bold text-ink-900 mt-2">{conv?.name || "Unknown"}</p>
          <p className="font-mono text-xs text-ink-400">{conv?.phone}</p>
          {contact?.email && <p className="text-xs text-ink-400 mt-0.5">{contact.email}</p>}
          {conv?.phone && (
            <button onClick={() => setShowProfile(true)} className="mt-3 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Sales brief &amp; full profile
            </button>
          )}
        </div>

        <div className="p-4 space-y-4 text-sm">
          {conv && (
            <>
              <div>
                <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><Tag className="w-3.5 h-3.5" /> Labels</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(conv.labels ?? []).map(l => (
                    <span key={l} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
                      {l}
                      <button disabled={busy} onClick={() => act({ action: "labels", labels: (conv.labels ?? []).filter(x => x !== l) })} className="text-brand-700/50 hover:text-red-500">×</button>
                    </span>
                  ))}
                  <input
                    className="border border-line rounded-full px-2 py-0.5 text-[11px] w-20 focus:outline-none"
                    placeholder="+ label" value={labelInput} onChange={e => setLabelInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && labelInput.trim()) { act({ action: "labels", labels: [...(conv.labels ?? []), labelInput.trim()] }); setLabelInput(""); } }}
                  />
                </div>
              </div>

              <div>
                <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Assigned to</p>
                <select
                  disabled={busy}
                  className="w-full border border-line rounded-control px-2.5 py-1.5 text-xs focus:outline-none bg-white"
                  value={conv.assignedTo ?? ""}
                  onChange={e => act({ action: "assign", assignedTo: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {/* Keep a legacy free-text assignee selectable until reassigned */}
                  {conv.assignedTo && !team.some(m => m.name === conv.assignedTo) && (
                    <option value={conv.assignedTo}>{conv.assignedTo}</option>
                  )}
                  {team.map(m => (
                    <option key={m.email} value={m.name}>{m.name}{m.title ? ` — ${m.title}` : ""}</option>
                  ))}
                </select>
                {(() => { const m = team.find(x => x.name === conv.assignedTo); return m?.title ? <p className="text-[11px] text-ink-400 mt-1">{m.title}</p> : null; })()}
              </div>

              {aiAgents.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> AI persona</p>
                  <select
                    disabled={busy}
                    className="w-full border border-line rounded-control px-2.5 py-1.5 text-xs focus:outline-none bg-white"
                    value={conv.agentId ?? ""}
                    onChange={e => act({ action: "agent", agentId: e.target.value || null })}
                  >
                    <option value="">Auto / default{(() => { const a = aiAgents.find(x => x.active); return a ? ` (${a.name})` : ""; })()}</option>
                    {aiAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {contact && contact.tags.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Contact tags</p>
              <div className="flex gap-1.5 flex-wrap">
                {contact.tags.map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-canvas text-ink-600 text-[11px] font-semibold">{t}</span>)}
              </div>
            </div>
          )}

          {contact && Object.keys(contact.attributes).length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Details collected</p>
              <div className="border border-line rounded-control divide-y divide-line">
                {Object.entries(contact.attributes).map(([k, v]) => (
                  <div key={k} className="px-3 py-1.5 flex items-start justify-between gap-3">
                    <span className="text-[11px] text-ink-400 capitalize shrink-0">{k.replaceAll("_", " ")}</span>
                    <span className="text-[12px] text-ink-900 font-medium text-right break-words">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
      {showProfile && conv?.phone && <ContactProfile phone={conv.phone} onClose={() => setShowProfile(false)} onChanged={() => { load(); onChanged(); }} goTo={goTo} />}
    </>
  );
}

function KbAddForm({ onAdded, disabled }: { onAdded: () => void; disabled: boolean }) {
  const [mode, setMode] = useState<"file" | "text" | "url">("file");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(file?: File) {
    setBusy(true); setMsg(null);
    try {
      let res: Response;
      if (mode === "file" && file) {
        const fd = new FormData(); fd.append("file", file); fd.append("title", title || file.name); if (tag.trim()) fd.append("tag", tag.trim());
        res = await fetch("/api/admin/kb", { method: "POST", body: fd });
      } else {
        const body = mode === "url" ? { sourceType: "url", title: title || url, sourceRef: url, tag: tag.trim() || null } : { sourceType: "text", title: title || "Pasted text", content: text, tag: tag.trim() || null };
        res = await fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }));
        setMsg(d.error ? `Failed: ${d.error}` : "Failed to add.");
        return;
      }
      setTitle(""); setText(""); setUrl(""); setTag(""); onAdded();
    } catch { setMsg("Connection error."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {(["file", "text", "url"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${mode === m ? "border-brand-dark bg-brand-700 text-white" : "border-line text-slate-600"}`}>
            {m === "file" ? "File" : m === "text" ? "Text" : "URL"}
          </button>
        ))}
      </div>
      <input className={`${inp} w-full`} placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
      <input className={`${inp} w-full`} placeholder="Topic tag (optional, e.g. masterclass-jan) — lets a flow use these docs as its primary knowledge" value={tag} onChange={e => setTag(e.target.value)} />
      {mode === "text" && <textarea className={`${inp} w-full`} rows={3} placeholder="Paste business content (FAQ, policies, product info)…" value={text} onChange={e => setText(e.target.value)} />}
      {mode === "url" && <input className={`${inp} w-full`} placeholder="https://yourbusiness.com/faq" value={url} onChange={e => setUrl(e.target.value)} />}
      <div className="flex items-center gap-3">
        {mode === "file"
          ? <label className={`flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold cursor-pointer ${busy || disabled ? "opacity-60 pointer-events-none" : ""}`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Upload & ingest
              <input type="file" accept=".pdf,.doc,.docx,.txt,.md,.markdown,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) submit(f); e.currentTarget.value = ""; }} />
            </label>
          : <button onClick={() => submit()} disabled={busy || disabled} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add & ingest</button>}
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

// ── Test the assistant (dry run, no WhatsApp send) ───────────────────────────
type TestResult = { reply: string | null; escalate: boolean; reason: string | null; usedChunks: number; retrieved: { similarity: number; preview: string }[]; error?: string };

function TestAssistantBox() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/admin/assistant/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q.trim() }) });
      setResult(await res.json());
    } catch { setResult({ reply: null, escalate: true, reason: "connection error", usedChunks: 0, retrieved: [], error: "Connection error" }); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> Test the assistant (no message is sent)</p>
      <div className="flex gap-2">
        <input className={`${inp} flex-1`} placeholder="Ask like a customer would… e.g. What are your pricing plans?" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") run(); }} />
        <button onClick={run} disabled={busy || !q.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Test
        </button>
      </div>
      {result && (
        <div className="space-y-2">
          {result.error
            ? <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{result.error}</div>
            : result.escalate
              ? <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800"><b>Would escalate to a human.</b>{result.reason ? ` Reason: ${result.reason}` : ""}</div>
              : <div className="bg-brand-green/10 border border-brand-green/40 rounded-lg px-4 py-3 text-sm whitespace-pre-wrap">{result.reply}</div>}
          {result.retrieved?.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-semibold">Retrieved context ({result.usedChunks} used)</summary>
              <div className="mt-1.5 space-y-1">
                {result.retrieved.map((r, i) => (
                  <p key={i} className="bg-slate-50 rounded px-2 py-1.5"><b>{r.similarity}</b> — {r.preview}…</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// ── Templates ─────────────────────────────────────────────────────────────────
type WaTplComponent = {
  type: string; format?: string; text?: string;
  buttons?: { type: string; text?: string; url?: string; phone_number?: string; example?: unknown }[];
  cards?: { components?: WaTplComponent[] }[];
};
type WaTemplateRow = {
  id?: string; name: string; status: string; language: string; category: string;
  rejected_reason?: string | null;
  components?: WaTplComponent[];
};

type TplBtnType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";
type TplButton = { type: TplBtnType; text: string; url: string; phoneNumber: string; example: string };
type TplCard = { headerFormat: "IMAGE" | "VIDEO"; headerHandle: string; fileName: string; previewUrl: string; bodyText: string; buttons: TplButton[]; uploading: boolean };
type TplHeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

const newTplButton = (type: TplBtnType = "QUICK_REPLY"): TplButton =>
  ({ type, text: type === "URL" ? "Visit website" : type === "PHONE_NUMBER" ? "Call us" : "", url: "", phoneNumber: "", example: "" });
const newTplCard = (): TplCard =>
  ({ headerFormat: "IMAGE", headerHandle: "", fileName: "", previewUrl: "", bodyText: "", buttons: [newTplButton("QUICK_REPLY")], uploading: false });

function serializeTplButtons(btns: TplButton[]) {
  return btns.map(b =>
    b.type === "QUICK_REPLY" ? { type: b.type, text: b.text }
    : b.type === "URL" ? { type: b.type, text: b.text, url: b.url }
    : b.type === "PHONE_NUMBER" ? { type: b.type, text: b.text, phoneNumber: b.phoneNumber }
    : { type: b.type, example: b.example });
}

// Sample media goes to Meta's resumable upload API → header_handle for the submission.
async function uploadTplSample(file: File, channelId?: string | null): Promise<{ handle?: string; error?: string }> {
  const fd = new FormData(); fd.append("file", file);
  if (channelId) fd.append("channelId", channelId);
  try {
    const res = await fetch("/api/admin/templates/media", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { handle: d.handle } : { error: d.error || `HTTP ${res.status}` };
  } catch { return { error: "Could not reach the server" }; }
}

const fillTplVars = (text: string, ex: string[]) =>
  text.replace(/\{\{(\d+)\}\}/g, (_m, n) => ex[Number(n) - 1]?.trim() || `{{${n}}}`);

function SamplePicker({ accept, fileName, uploading, previewUrl, hint, onFile }: {
  accept: string; fileName: string; uploading: boolean; previewUrl: string; hint: string; onFile: (f: File) => void;
}) {
  return (
    <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-lg px-3 py-2 cursor-pointer hover:border-brand-dark/50 bg-slate-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {previewUrl ? <img src={previewUrl} alt="" className="w-10 h-10 rounded object-cover" /> : <UploadCloud className="w-5 h-5 text-slate-400 shrink-0" />}
      <span className="text-xs text-slate-500 flex-1 truncate">
        {uploading ? "Uploading sample to Meta…" : fileName ? `✓ ${fileName} — sample uploaded` : hint}
      </span>
      {uploading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />}
      <input type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

function TplButtonEditor({ btns, max, onChange }: { btns: TplButton[]; max: number; onChange: (b: TplButton[]) => void }) {
  const set = (i: number, patch: Partial<TplButton>) => onChange(btns.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  return (
    <div className="space-y-2">
      {btns.map((b, i) => (
        <div key={i} className="flex gap-2 items-center">
          <select className={`${inp} w-32 shrink-0`} value={b.type} onChange={e => set(i, { ...newTplButton(e.target.value as TplBtnType) })}>
            <option value="QUICK_REPLY">Quick reply</option>
            <option value="URL">URL</option>
            <option value="PHONE_NUMBER">Phone</option>
            <option value="COPY_CODE">Copy code</option>
          </select>
          {b.type === "COPY_CODE"
            ? <input className={`${inp} flex-1`} placeholder="Example code, e.g. SAVE20" maxLength={15} value={b.example} onChange={e => set(i, { example: e.target.value })} />
            : <input className={`${inp} w-40 shrink-0`} placeholder="Button text" maxLength={25} value={b.text} onChange={e => set(i, { text: e.target.value })} />}
          {b.type === "URL" && <input className={`${inp} flex-1`} placeholder="https://example.com" value={b.url} onChange={e => set(i, { url: e.target.value })} />}
          {b.type === "PHONE_NUMBER" && <input className={`${inp} flex-1`} placeholder="+919876543210" value={b.phoneNumber} onChange={e => set(i, { phoneNumber: e.target.value })} />}
          <button onClick={() => onChange(btns.filter((_, j) => j !== i))} className="p-1.5 text-slate-400 hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      ))}
      {btns.length < max && (
        <button onClick={() => onChange([...btns, newTplButton()])} className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline">
          <Plus className="w-3.5 h-3.5" /> Add button
        </button>
      )}
    </div>
  );
}

// WhatsApp-style live preview of the template being built.
function TplPreview({ mode, headerType, headerText, headerExample, headerPreviewUrl, headerFileName, bodyText, footerText, examples, buttons, cards }: {
  mode: "standard" | "carousel"; headerType: TplHeaderType; headerText: string; headerExample: string;
  headerPreviewUrl: string; headerFileName: string; bodyText: string; footerText: string; examples: string[];
  buttons: TplButton[]; cards: TplCard[];
}) {
  const btnRow = (b: TplButton, i: number) => (
    <div key={i} className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600 flex items-center justify-center gap-1">
      {b.type === "URL" && <Link2 className="w-3 h-3" />}{b.type === "PHONE_NUMBER" && <Phone className="w-3 h-3" />}{b.type === "COPY_CODE" && <Copy className="w-3 h-3" />}
      {b.type === "COPY_CODE" ? "Copy code" : b.text || "Button"}
    </div>
  );
  const mediaBox = (format: string, url: string, name: string) => (
    <div className="bg-slate-200 h-28 flex items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {format === "IMAGE" && url ? <img src={url} alt="" className="w-full h-full object-cover" /> :
        <span className="text-slate-400 flex flex-col items-center gap-1 text-[10px]">
          {format === "VIDEO" ? <Video className="w-6 h-6" /> : format === "DOCUMENT" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
          {name || format.toLowerCase()}
        </span>}
    </div>
  );
  return (
    <div className="bg-[#e5ddd5] rounded-card p-4 sticky top-4">
      <p className="text-[10px] font-bold text-slate-600 uppercase mb-2">Live preview</p>
      <div className="bg-white rounded-lg shadow-sm overflow-hidden max-w-[270px]">
        {mode === "standard" && headerType !== "NONE" && (
          headerType === "TEXT"
            ? <p className="px-3 pt-2 text-[13px] font-bold text-slate-800">{fillTplVars(headerText || "Header", [headerExample])}</p>
            : mediaBox(headerType, headerPreviewUrl, headerFileName)
        )}
        <p className="px-3 py-2 text-[13px] text-slate-800 whitespace-pre-wrap">{fillTplVars(bodyText, examples) || "Your message body appears here…"}</p>
        {footerText.trim() && <p className="px-3 pb-1.5 text-[11px] text-slate-400">{footerText}</p>}
        <p className="px-3 pb-1.5 text-right text-[10px] text-slate-300">10:30</p>
        {mode === "standard" && buttons.map(btnRow)}
      </div>
      {mode === "carousel" && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {cards.map((c, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden w-[170px] shrink-0">
              {mediaBox(c.headerFormat, c.previewUrl, c.fileName)}
              <p className="px-2 py-1.5 text-[11px] text-slate-800 min-h-[2rem]">{c.bodyText || `Card ${i + 1} text…`}</p>
              {c.buttons.map(btnRow)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<WaTemplateRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<"standard" | "carousel">("standard");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [headerType, setHeaderType] = useState<TplHeaderType>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExample, setHeaderExample] = useState("");
  const [headerHandle, setHeaderHandle] = useState("");
  const [headerFileName, setHeaderFileName] = useState("");
  const [headerPreviewUrl, setHeaderPreviewUrl] = useState("");
  const [headerUploading, setHeaderUploading] = useState(false);
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [examples, setExamples] = useState("");
  const [buttons, setButtons] = useState<TplButton[]>([]);
  const [clickTracking, setClickTracking] = useState(false);
  const [cards, setCards] = useState<TplCard[]>([newTplCard(), newTplCard()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<"ALL" | "PENDING" | "APPROVED" | "ACTION">("ALL");
  const [favs, setFavs] = useState<string[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);   // which number's WABA

  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem("wa_tpl_favs") || "[]")); } catch { /* fresh */ } }, []);
  const toggleFav = (n: string) => setFavs(f => {
    const next = f.includes(n) ? f.filter(x => x !== n) : [...f, n];
    localStorage.setItem("wa_tpl_favs", JSON.stringify(next));
    return next;
  });

  // Prefill the builder from an existing template (media samples must be re-uploaded).
  function copyTemplate(t: WaTemplateRow) {
    const comps = t.components ?? [];
    const fromMetaButtons = (bs: NonNullable<WaTplComponent["buttons"]>): TplButton[] => bs.map(b => ({
      ...newTplButton(b.type as TplBtnType), text: b.text ?? "", url: b.url ?? "", phoneNumber: b.phone_number ?? "",
      example: typeof b.example === "string" ? b.example : Array.isArray(b.example) ? String(b.example[0] ?? "") : "",
    }));
    setName(`${t.name}_copy`); setLanguage(t.language);
    setCategory(t.category === "UTILITY" ? "UTILITY" : "MARKETING");
    const body = comps.find(c => c.type === "BODY");
    setBodyText(body?.text ?? "");
    setFooterText(comps.find(c => c.type === "FOOTER")?.text ?? "");
    setExamples("");
    const carousel = comps.find(c => c.type === "CAROUSEL");
    if (carousel?.cards?.length) {
      setMode("carousel");
      setCards(carousel.cards.map(card => {
        const cc = card.components ?? [];
        return { ...newTplCard(),
          headerFormat: (cc.find(x => x.type === "HEADER")?.format === "VIDEO" ? "VIDEO" : "IMAGE") as "IMAGE" | "VIDEO",
          bodyText: cc.find(x => x.type === "BODY")?.text ?? "",
          buttons: fromMetaButtons(cc.find(x => x.type === "BUTTONS")?.buttons ?? []),
        };
      }));
    } else {
      setMode("standard");
      const h = comps.find(c => c.type === "HEADER");
      setHeaderType((h?.format as TplHeaderType) ?? "NONE");
      setHeaderText(h?.format === "TEXT" ? h.text ?? "" : "");
      setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
      setButtons(fromMetaButtons(comps.find(c => c.type === "BUTTONS")?.buttons ?? []));
      setCards([newTplCard(), newTplCard()]);
    }
    setMsg(`Copied "${t.name}" — media samples need a fresh upload before submitting.`);
    setShowBuilder(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetch(`/api/admin/templates${channelId ? `?channelId=${channelId}` : ""}`).then(r => r.json());
      setTemplates(d.templates ?? []); setNotice(d.notice ?? null);
    } catch { /* keep last list */ }
    setRefreshing(false);
  }, [channelId]);
  useEffect(() => { load(); }, [load]);

  async function pickHeaderFile(f: File) {
    setHeaderUploading(true); setMsg(null);
    const preview = headerType === "IMAGE" ? URL.createObjectURL(f) : "";
    const r = await uploadTplSample(f, channelId);
    setHeaderUploading(false);
    if (r.error || !r.handle) { setMsg(r.error ?? "Upload failed"); return; }
    setHeaderHandle(r.handle); setHeaderFileName(f.name); setHeaderPreviewUrl(preview);
  }

  async function pickCardFile(i: number, f: File) {
    setMsg(null);
    setCards(cs => cs.map((c, j) => (j === i ? { ...c, uploading: true } : c)));
    const preview = cards[i].headerFormat === "IMAGE" ? URL.createObjectURL(f) : "";
    const r = await uploadTplSample(f, channelId);
    setCards(cs => cs.map((c, j) => (j === i
      ? { ...c, uploading: false, ...(r.handle ? { headerHandle: r.handle, fileName: f.name, previewUrl: preview } : {}) }
      : c)));
    if (r.error) setMsg(r.error);
  }

  const setCard = (i: number, patch: Partial<TplCard>) => setCards(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const exampleList = examples.split(/\r?\n/).map(v => v.trim()).filter(Boolean);

  async function create() {
    setMsg(null);
    if (!name.trim() || !bodyText.trim()) { setMsg("Name and body are required."); return; }
    const bodyVarCount = Math.max(0, ...[...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])));
    if (bodyVarCount > 0 && exampleList.length < bodyVarCount) { setMsg(`Body uses {{${bodyVarCount}}} — provide ${bodyVarCount} example value(s), one per line.`); return; }
    const payload: Record<string, unknown> = {
      name: name.trim(), language: language.trim() || "en_US", category,
      bodyText, footerText: footerText.trim() || undefined, exampleValues: exampleList,
      channelId,
    };
    if (mode === "carousel") {
      if (cards.length < 2) { setMsg("A carousel needs at least 2 cards."); return; }
      for (const [i, c] of cards.entries()) {
        if (!c.headerHandle) { setMsg(`Card ${i + 1}: upload its ${c.headerFormat.toLowerCase()} first.`); return; }
        if (!c.bodyText.trim()) { setMsg(`Card ${i + 1}: body text is required.`); return; }
        if (c.buttons.some(b => b.type !== "COPY_CODE" && !b.text.trim())) { setMsg(`Card ${i + 1}: every button needs text.`); return; }
      }
      payload.carouselCards = cards.map(c => ({ headerFormat: c.headerFormat, headerHandle: c.headerHandle, bodyText: c.bodyText, buttons: serializeTplButtons(c.buttons) }));
    } else {
      payload.headerType = headerType;
      if (headerType === "TEXT") {
        if (!headerText.trim()) { setMsg("Header text is required for a text header."); return; }
        payload.headerText = headerText; payload.headerExample = headerExample;
      }
      if (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") {
        if (!headerHandle) { setMsg(`Upload a sample ${headerType.toLowerCase()} for the header first.`); return; }
        payload.headerHandle = headerHandle;
      }
      if (buttons.some(b => b.type !== "COPY_CODE" && !b.text.trim())) { setMsg("Every button needs text."); return; }
      if (buttons.some(b => b.type === "URL" && !b.url.trim())) { setMsg("URL buttons need a link."); return; }
      if (buttons.length) payload.buttons = serializeTplButtons(buttons);
      if (clickTracking && buttons.some(b => b.type === "URL")) payload.clickTracking = true;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Failed to submit");
      else {
        setMsg(`Submitted — status ${d.status}. Meta approval usually takes minutes to a few hours; hit Refresh to check.`);
        setName(""); setBodyText(""); setFooterText(""); setExamples(""); setButtons([]); setClickTracking(false);
        setHeaderType("NONE"); setHeaderText(""); setHeaderExample(""); setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl("");
        setCards([newTplCard(), newTplCard()]);
        load();
      }
    } finally { setBusy(false); }
  }

  async function remove(n: string) {
    if (!confirm(`Delete template "${n}" (all languages)? This can't be undone.`)) return;
    await fetch("/api/admin/templates", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, channelId }) });
    load();
  }

  const ACTIONABLE = ["REJECTED", "PAUSED", "DISABLED", "IN_APPEAL"];

  const tplType = (t: WaTemplateRow) => {
    const comps = t.components ?? [];
    if (comps.some(c => c.type === "CAROUSEL")) return "Carousel";
    const h = comps.find(c => c.type === "HEADER");
    if (h?.format && h.format !== "TEXT") return h.format.charAt(0) + h.format.slice(1).toLowerCase();
    return "Text";
  };

  const visibleTemplates = templates
    .filter(t => statusTab === "ALL" ? true : statusTab === "ACTION" ? ACTIONABLE.includes(t.status) : t.status === statusTab)
    .filter(t => {
      const q = query.trim().toLowerCase();
      return !q || t.name.includes(q) || t.status.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || tplType(t).toLowerCase().includes(q);
    })
    .sort((a, b) => Number(favs.includes(b.name)) - Number(favs.includes(a.name)));

  const segBtn = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold ${active ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">Template Messages</h2>
          <p className="text-sm text-slate-500">Build templates per Meta&apos;s guidelines — text, media headers, buttons, or carousels. Only APPROVED templates can be broadcast.</p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <ChannelSelect value={channelId} onChange={setChannelId} allLabel="Number: default" className={`${inp} !py-2 text-xs`} />
          <button onClick={load} disabled={refreshing} className="px-4 py-2 rounded-lg border border-brand-dark text-brand-dark text-sm font-bold flex items-center gap-2 disabled:opacity-60 hover:bg-brand-600/5">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Sync Status
          </button>
          <button onClick={() => setShowBuilder(v => !v)} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2">
            {showBuilder ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showBuilder ? "Close" : "New"}
          </button>
        </div>
      </div>

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{notice}</div>}

      {showBuilder && <div className="grid lg:grid-cols-[1fr_310px] gap-5 items-start">
        <section className="bg-white rounded-card border border-line p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase">New template</p>
            <div className="flex gap-1.5">
              <button className={segBtn(mode === "standard")} onClick={() => setMode("standard")}><MessageSquare className="w-3.5 h-3.5 inline mr-1" />Standard</button>
              <button className={segBtn(mode === "carousel")} onClick={() => setMode("carousel")}><GalleryHorizontalEnd className="w-3.5 h-3.5 inline mr-1" />Carousel</button>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_7rem_8rem] gap-2">
            <input className={inp} placeholder="name (lowercase_underscores)" value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
            <input className={inp} placeholder="en_US" value={language} onChange={e => setLanguage(e.target.value)} />
            <select className={inp} value={category} onChange={e => setCategory(e.target.value as "MARKETING" | "UTILITY")}>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
            </select>
          </div>

          {mode === "standard" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Header</p>
              <div className="flex gap-1.5 flex-wrap">
                {(["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as TplHeaderType[]).map(h => (
                  <button key={h} className={segBtn(headerType === h)} onClick={() => { setHeaderType(h); setHeaderHandle(""); setHeaderFileName(""); setHeaderPreviewUrl(""); }}>
                    {h === "NONE" ? "None" : h === "TEXT" ? "Text" : h === "IMAGE" ? <><ImageIcon className="w-3.5 h-3.5 inline mr-1" />Image</> : h === "VIDEO" ? <><Video className="w-3.5 h-3.5 inline mr-1" />Video</> : <><FileText className="w-3.5 h-3.5 inline mr-1" />Document</>}
                  </button>
                ))}
              </div>
              {headerType === "TEXT" && (
                <div className="grid grid-cols-2 gap-2">
                  <input className={inp} placeholder="Header text (60 chars, may use {{1}})" maxLength={60} value={headerText} onChange={e => setHeaderText(e.target.value)} />
                  {/\{\{1\}\}/.test(headerText) && <input className={inp} placeholder="Example for {{1}}" value={headerExample} onChange={e => setHeaderExample(e.target.value)} />}
                </div>
              )}
              {(headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") && (
                <SamplePicker
                  accept={headerType === "IMAGE" ? "image/jpeg,image/png" : headerType === "VIDEO" ? "video/mp4" : "application/pdf"}
                  fileName={headerFileName} uploading={headerUploading} previewUrl={headerPreviewUrl}
                  hint={`Upload a sample ${headerType.toLowerCase()} (${headerType === "IMAGE" ? "JPEG/PNG" : headerType === "VIDEO" ? "MP4" : "PDF"}) — reviewers see this; the actual media is chosen when you broadcast`}
                  onFile={pickHeaderFile}
                />
              )}
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-400 uppercase">{mode === "carousel" ? "Message bubble (shown above the cards)" : "Message body"}</p>
              <p className="text-[11px] text-slate-500">The main text your customer reads. Put <span className="font-mono text-slate-600">{"{{1}}"}</span>, <span className="font-mono text-slate-600">{"{{2}}"}</span> where you want fill-in-the-blanks (like a name or date) that you set each time you send.</p>
              <textarea className={`${inp} w-full`} rows={4} maxLength={1024} placeholder={"e.g. Hi {{1}}, your {{2}} class starts tomorrow at 7 PM — see you there!"} value={bodyText} onChange={e => setBodyText(e.target.value)} />
            </div>
            {/\{\{\d+\}\}/.test(bodyText) && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-600">Sample values <span className="font-normal text-slate-400">— one per line, in order ({"{{1}}"} first). Meta reviews these; your customers never see them.</span></p>
                <textarea className={`${inp} w-full font-mono`} rows={2} placeholder={"Asha\ntomorrow 7 PM"} value={examples} onChange={e => setExamples(e.target.value)} />
              </div>
            )}
            {mode === "standard" && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-600">Footer <span className="font-normal text-slate-400">(optional)</span></p>
                <p className="text-[11px] text-slate-500">A small grey line under the message — usually a sign-off or an opt-out note.</p>
                <input className={`${inp} w-full`} placeholder="e.g. Team AnalytixLabs · Reply STOP to opt out" maxLength={60} value={footerText} onChange={e => setFooterText(e.target.value)} />
              </div>
            )}
          </div>

          {mode === "standard" && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase">Buttons <span className="font-normal normal-case">(up to 10 — max 2 URL, 1 phone)</span></p>
              <TplButtonEditor btns={buttons} max={10} onChange={setButtons} />
              {buttons.some(b => b.type === "URL") && (
                <div className="flex items-start gap-3 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2.5">
                  <label className="flex items-center gap-2 shrink-0 cursor-pointer pt-0.5">
                    <input type="checkbox" checked={clickTracking} onChange={e => setClickTracking(e.target.checked)} className="accent-brand-700" />
                    <span className="text-xs font-bold text-brand-700 flex items-center gap-1"><MousePointerClick className="w-3.5 h-3.5" />Enable Click Tracking</span>
                  </label>
                  <p className="text-[11px] text-brand-700">
                    To track clicks we send users a link of the format {(process.env.NEXT_PUBLIC_SITE_URL || "https://your-domain").replace(/\/$/, "")}/r/xxxx which redirects to your URL on click. Click stats show on the campaign dashboard.
                  </p>
                </div>
              )}
            </div>
          )}

          {mode === "carousel" && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-slate-400 uppercase">Cards ({cards.length}/10) <span className="font-normal normal-case">— Meta requires every card to have the same structure</span></p>
              {cards.map((c, i) => (
                <div key={i} className="border border-line rounded-lg p-3 space-y-2 bg-slate-50/60">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500">Card {i + 1}</p>
                    <div className="flex items-center gap-2">
                      <select className={`${inp} text-xs py-1`} value={c.headerFormat} onChange={e => setCard(i, { headerFormat: e.target.value as "IMAGE" | "VIDEO", headerHandle: "", fileName: "", previewUrl: "" })}>
                        <option value="IMAGE">Image</option>
                        <option value="VIDEO">Video</option>
                      </select>
                      {cards.length > 2 && <button onClick={() => setCards(cs => cs.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600"><X className="w-4 h-4" /></button>}
                    </div>
                  </div>
                  <SamplePicker
                    accept={c.headerFormat === "IMAGE" ? "image/jpeg,image/png" : "video/mp4"}
                    fileName={c.fileName} uploading={c.uploading} previewUrl={c.previewUrl}
                    hint={`Upload card ${c.headerFormat.toLowerCase()} (${c.headerFormat === "IMAGE" ? "JPEG/PNG" : "MP4"})`}
                    onFile={f => pickCardFile(i, f)}
                  />
                  <input className={`${inp} w-full`} placeholder="Card text (160 chars)" maxLength={160} value={c.bodyText} onChange={e => setCard(i, { bodyText: e.target.value })} />
                  <TplButtonEditor btns={c.buttons} max={2} onChange={b => setCard(i, { buttons: b })} />
                </div>
              ))}
              {cards.length < 10 && (
                <button onClick={() => setCards(cs => [...cs, newTplCard()])} className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Add card
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button onClick={create} disabled={busy} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Submit to Meta for approval
            </button>
            {msg && <span className="text-xs text-slate-500">{msg}</span>}
          </div>
        </section>

        <TplPreview
          mode={mode} headerType={headerType} headerText={headerText} headerExample={headerExample}
          headerPreviewUrl={headerPreviewUrl} headerFileName={headerFileName}
          bodyText={bodyText} footerText={footerText} examples={exampleList} buttons={buttons} cards={cards}
        />
      </div>}

      <div className="bg-white rounded-card border border-line overflow-hidden">
        <div className="px-4 pt-4 space-y-3">
          <input className={`${inp} w-full max-w-sm`} placeholder="Search templates (status, name etc.)" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="flex gap-6 text-sm font-semibold border-b border-slate-100">
            {([["ALL", "All"], ["PENDING", "Pending"], ["APPROVED", "Approved"], ["ACTION", "Action Required"]] as const).map(([k, label]) => {
              const count = k === "ALL" ? templates.length
                : k === "ACTION" ? templates.filter(t => ACTIONABLE.includes(t.status)).length
                : templates.filter(t => t.status === k).length;
              return (
                <button key={k} onClick={() => setStatusTab(k)}
                  className={`pb-2 -mb-px border-b-2 flex items-center gap-1.5 ${statusTab === k ? "border-brand-dark text-brand-dark" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
                  {label}<span className="text-[10px] bg-slate-100 rounded-full px-1.5 py-0.5 font-bold">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {visibleTemplates.map(t => (
            <div key={`${t.name}-${t.language}`} className="px-4 py-3 flex items-center gap-4 hover:bg-slate-50">
              <div className="w-52 min-w-0 shrink-0">
                <p className="font-mono text-xs font-semibold text-brand-dark truncate">{t.name}</p>
                {t.status === "REJECTED" && t.rejected_reason && <p className="text-[11px] text-red-500 truncate">Rejected: {t.rejected_reason.replaceAll("_", " ").toLowerCase()}</p>}
              </div>
              <span className="w-24 shrink-0 text-[11px] font-bold text-slate-400 uppercase">{t.category}</span>
              <span className={`w-24 shrink-0 text-[11px] font-bold ${t.status === "APPROVED" ? "text-brand-600" : ACTIONABLE.includes(t.status) ? "text-red-500" : "text-amber-500"}`}>{t.status}</span>
              <span className="w-20 shrink-0 text-[11px] font-bold text-slate-500 uppercase">{tplType(t)}</span>
              <span className="w-16 shrink-0 text-[11px] text-slate-400">{t.language}</span>
              <div className="flex-1" />
              <button onClick={() => toggleFav(t.name)} title="Favourite" className={`p-1.5 rounded-lg hover:bg-slate-100 ${favs.includes(t.name) ? "text-amber-400" : "text-slate-300 hover:text-slate-500"}`}>
                <Star className="w-4 h-4" fill={favs.includes(t.name) ? "currentColor" : "none"} />
              </button>
              <button onClick={() => copyTemplate(t)} title="Duplicate into builder" className="p-1.5 text-slate-400 hover:text-brand-dark hover:bg-slate-100 rounded-lg"><Copy className="w-4 h-4" /></button>
              <button onClick={() => remove(t.name)} title="Delete" className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {visibleTemplates.length === 0 && (
            <p className="px-4 py-8 text-center text-slate-400 text-sm">
              {templates.length === 0 ? "No templates yet — hit + New to build your first one." : "Nothing matches this filter."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── WhatsApp Forms (Meta Flows — native in-chat forms) ────────────────────────
type WaFormRow = { id: string; name: string; status: string; categories: string[]; validationErrors: string[]; previewUrl: string | null };
type UiFormFieldType = "text" | "email" | "phone" | "number" | "textarea" | "dropdown" | "radio" | "checkbox" | "date" | "optin";
type UiFormField = { type: UiFormFieldType; label: string; required: boolean; options: string };

const FORM_FIELD_TYPES: { v: UiFormFieldType; label: string }[] = [
  { v: "text", label: "Text" }, { v: "email", label: "Email" }, { v: "phone", label: "Phone" },
  { v: "number", label: "Number" }, { v: "textarea", label: "Long text" }, { v: "dropdown", label: "Dropdown" },
  { v: "radio", label: "Single choice" }, { v: "checkbox", label: "Multi choice" },
  { v: "date", label: "Date" }, { v: "optin", label: "Opt-in tick" },
];
const isChoice = (t: UiFormFieldType) => t === "dropdown" || t === "radio" || t === "checkbox";

type FormResp = { id: string; phone: string; formId: string | null; status: string; data: Record<string, string> | null; sentAt: string; submittedAt: string | null };
function FormResponsesPanel() {
  const [responses, setResponses] = useState<FormResp[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { fetch("/api/admin/form-responses").then(r => r.json()).then(d => setResponses(d.responses ?? [])).catch(() => {}); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const submitted = responses.filter(r => r.status === "submitted").length;
  const abandoned = responses.filter(r => r.status === "abandoned").length;
  const badge = (s: string) => s === "submitted" ? "bg-emerald-50 text-emerald-700" : s === "abandoned" ? "bg-amber-50 text-amber-700" : "bg-canvas text-ink-400";
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="text-sm font-bold text-ink-900 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-brand-700" /> Form responses</span>
        <span className="text-[11px] text-ink-400">{submitted} submitted · {abandoned} abandoned · {open ? "hide" : "show"}</span>
      </button>
      {open && (responses.length ? (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {responses.map(r => (
            <div key={r.id} className="border border-line rounded-control px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink-900 truncate">{r.phone || "—"}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${badge(r.status)}`}>{r.status.toUpperCase()}</span>
              </div>
              {r.data && Object.keys(r.data).length > 0 && <p className="text-[11px] text-ink-500 mt-0.5 break-words">{Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
              <p className="text-[10px] text-ink-400 mt-0.5">{new Date(r.submittedAt ?? r.sentAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-ink-400">No form responses yet.</p>)}
    </section>
  );
}

function FormsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [forms, setForms] = useState<WaFormRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState<UiFormField[]>([
    { type: "text", label: "Full name", required: true, options: "" },
    { type: "phone", label: "Mobile number", required: true, options: "" },
  ]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);   // which number's WABA
  const [editingId, setEditingId] = useState<string | null>(null);   // editing a draft in place
  const [cloneNote, setCloneNote] = useState<string | null>(null);   // editing a copy of a published form

  function resetBuilder() {
    setName(""); setTitle(""); setEditingId(null); setCloneNote(null);
    setFields([{ type: "text", label: "Full name", required: true, options: "" }, { type: "phone", label: "Mobile number", required: true, options: "" }]);
  }

  // Open an existing form in the builder. Drafts edit in place; published forms
  // are immutable on Meta, so we pre-fill a COPY that saves as a new form.
  async function openEdit(f: WaFormRow) {
    setMsg(null); setBusy("load:" + f.id);
    try {
      const d = await fetch(`/api/admin/waforms?def=${f.id}${channelId ? `&channelId=${channelId}` : ""}`).then(r => r.json());
      if (d.error) { setMsg(d.error); return; }
      const published = f.status === "PUBLISHED";
      setName(published ? `${f.name} copy` : f.name);
      setTitle(d.title || "");
      setFields((d.fields ?? []).map((x: { type: UiFormFieldType; label: string; required: boolean; options?: string[] }) => ({ type: x.type, label: x.label, required: x.required, options: (x.options ?? []).join(", ") })));
      setEditingId(published ? null : f.id);
      setCloneNote(published ? f.name : null);
      setShowBuilder(true);
    } finally { setBusy(null); }
  }

  // Save edits to an existing draft (re-uploads its Flow JSON).
  async function update(publish: boolean) {
    setMsg(null);
    if (!fields.some(f => f.label.trim())) { setMsg("Add at least one field."); return; }
    setBusy(publish ? "publish" : "draft");
    try {
      const res = await fetch("/api/admin/waforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId, name: name.trim(), title: title.trim() || name.trim(), publish, channelId,
          fields: fields.filter(f => f.label.trim()).map(f => ({ type: f.type, label: f.label.trim(), required: f.required, options: f.options.split(",").map(s => s.trim()).filter(Boolean) })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed"); return; }
      if (d.validationErrors?.length) setMsg(`Saved as draft, but Meta flagged: ${d.validationErrors.join(" · ")}`);
      else if (d.publishError) setMsg(`Saved — publishing failed: ${d.publishError}`);
      else setMsg(d.status === "PUBLISHED" ? "Updated & published ✓" : "Draft updated ✓");
      resetBuilder();
      load();
    } finally { setBusy(null); }
  }

  // Rename a form (works on published too — only content is locked once live).
  async function renameForm(f: WaFormRow) {
    const next = prompt("Rename form", f.name);
    if (next == null || !next.trim() || next.trim() === f.name) return;
    setBusy("rename:" + f.id); setMsg(null);
    try {
      const res = await fetch("/api/admin/waforms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, rename: next.trim(), channelId }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Rename failed"); else { setMsg("Renamed ✓"); load(); }
    } finally { setBusy(null); }
  }

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetch(`/api/admin/waforms${channelId ? `?channelId=${channelId}` : ""}`).then(r => r.json());
      setForms(d.forms ?? []); setNotice(d.notice ?? null);
    } catch { /* keep last list */ }
    setRefreshing(false);
  }, [channelId]);
  useEffect(() => { load(); }, [load]);

  const setField = (i: number, patch: Partial<UiFormField>) => setFields(fs => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  async function create(publish: boolean) {
    setMsg(null);
    if (!name.trim()) { setMsg("Give the form a name."); return; }
    if (!fields.some(f => f.label.trim())) { setMsg("Add at least one field."); return; }
    setBusy(publish ? "publish" : "draft");
    try {
      const res = await fetch("/api/admin/waforms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), title: title.trim() || name.trim(), publish, channelId,
          fields: fields.filter(f => f.label.trim()).map(f => ({ type: f.type, label: f.label.trim(), required: f.required, options: f.options.split(",").map(s => s.trim()).filter(Boolean) })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Failed"); return; }
      if (d.validationErrors?.length) setMsg(`Created as draft, but Meta flagged: ${d.validationErrors.join(" · ")}`);
      else if (d.publishError) setMsg(`Created as draft — publishing failed: ${d.publishError}`);
      else setMsg(d.status === "PUBLISHED" ? "Published — the form is live. Use it from the WhatsApp form block in your chatbot flows." : "Draft created — publish when ready.");
      resetBuilder();
      load();
    } finally { setBusy(null); }
  }

  async function publish(id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/waforms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, publish: true, channelId }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Publish failed"); else setMsg("Published — the form is live.");
      load();
    } finally { setBusy(null); }
  }

  async function remove(f: WaFormRow) {
    if (!confirm(`${f.status === "PUBLISHED" ? "Deprecate" : "Delete"} form "${f.name}"?`)) return;
    await fetch("/api/admin/waforms", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, channelId }) });
    load();
  }

  const statusPill = (s: string) =>
    s === "PUBLISHED" ? "bg-brand-100 text-brand-700" : s === "DRAFT" ? "bg-amber-100 text-amber-700"
    : s === "DEPRECATED" ? "bg-canvas text-ink-400" : "bg-red-100 text-red-600";

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-4xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-ink-900">WhatsApp Forms</h2>
          <p className="text-[13px] text-ink-400">Native forms that open inside WhatsApp — collect name, email, choices and dates without the customer leaving the chat. Answers save to contact attributes automatically.</p>
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          <ChannelSelect value={channelId} onChange={setChannelId} allLabel="Number: default" className={`${inp} !py-2 text-xs`} />
          <button onClick={load} disabled={refreshing} className="px-4 py-2 rounded-control border border-brand-700 text-brand-700 text-[13px] font-semibold flex items-center gap-2 disabled:opacity-60 hover:bg-brand-50">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} /> Sync
          </button>
          <button onClick={() => { resetBuilder(); setShowBuilder(v => !v); }} className={btnPrimary}>
            {showBuilder ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showBuilder ? "Close" : "New form"}
          </button>
        </div>
      </div>

      <FormResponsesPanel />

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-control px-4 py-3 text-sm text-amber-800">{notice}</div>}
      {msg && <div className="bg-brand-50 border border-brand-100 rounded-control px-4 py-3 text-sm text-brand-900">{msg}</div>}

      {showBuilder && (
        <div className="grid lg:grid-cols-[1fr_290px] gap-4 items-start">
          <section className="bg-white rounded-card border border-line p-5 space-y-4">
            <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">{editingId ? "Edit form" : cloneNote ? "Edit a copy" : "New form"}</p>
            {cloneNote && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">Editing a copy of <b>{cloneNote}</b>. Published forms can&apos;t be changed on WhatsApp, so this saves as a <b>new</b> form.</p>}
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Form name (internal)" value={name} onChange={e => setName(e.target.value)} />
              <input className={inp} maxLength={30} placeholder="Title shown on the form (30 chars)" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">Fields</p>
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className={`${inp} w-32 shrink-0`} value={f.type} onChange={e => setField(i, { type: e.target.value as UiFormFieldType })}>
                    {FORM_FIELD_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                  <input className={`${inp} flex-1`} maxLength={f.type === "optin" ? 120 : 30} placeholder={f.type === "optin" ? "Opt-in text, e.g. Send me updates on WhatsApp" : "Field label, e.g. Which course?"} value={f.label} onChange={e => setField(i, { label: e.target.value })} />
                  {isChoice(f.type) && <input className={`${inp} flex-1`} placeholder="Options, comma-separated" value={f.options} onChange={e => setField(i, { options: e.target.value })} />}
                  <label className="flex items-center gap-1 text-[11px] text-ink-400 shrink-0 cursor-pointer">
                    <input type="checkbox" className="accent-brand-700" checked={f.required} onChange={e => setField(i, { required: e.target.checked })} /> req
                  </label>
                  <button onClick={() => setFields(fs => fs.filter((_, j) => j !== i))} className="p-1 text-ink-400 hover:text-red-500 shrink-0"><X className="w-4 h-4" /></button>
                </div>
              ))}
              {fields.length < 15 && (
                <button onClick={() => setFields(fs => [...fs, { type: "text", label: "", required: false, options: "" }])} className="text-xs font-semibold text-brand-700 flex items-center gap-1 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Add field
                </button>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={() => (editingId ? update(true) : create(true))} disabled={!!busy} className={btnPrimary}>
                {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {editingId ? "Update & publish" : "Create & publish"}
              </button>
              <button onClick={() => (editingId ? update(false) : create(false))} disabled={!!busy} className="px-4 py-2 rounded-control border border-line text-ink-600 text-[13px] font-semibold flex items-center gap-2 hover:bg-canvas disabled:opacity-60">
                {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {editingId ? "Save draft" : "Save as draft"}
              </button>
            </div>
            <p className="text-[11px] text-ink-400">Forms publish instantly (Meta validates — no review queue). Answers land on the contact as attributes named after each field.</p>
          </section>

          {/* Phone-style preview */}
          <div className="bg-[#e5ddd5] rounded-card p-4 sticky top-4">
            <p className="text-[10px] font-bold text-ink-600 uppercase mb-2">Preview</p>
            <div className="bg-white rounded-xl overflow-hidden shadow-sm">
              <div className="bg-brand-700 text-white text-[12px] font-semibold px-3 py-2">{title.trim() || name.trim() || "Form"}</div>
              <div className="p-3 space-y-2.5">
                {fields.filter(f => f.label.trim()).map((f, i) => (
                  <div key={i}>
                    <p className="text-[10px] font-semibold text-ink-600 mb-0.5">{f.label}{f.required && <span className="text-red-500"> *</span>}</p>
                    {isChoice(f.type)
                      ? <div className="space-y-1">{f.options.split(",").map(s => s.trim()).filter(Boolean).slice(0, 4).map(o => (
                          <div key={o} className="flex items-center gap-1.5 text-[10px] text-ink-400">
                            <span className={`inline-block w-3 h-3 border border-line ${f.type === "checkbox" ? "rounded" : "rounded-full"}`} />{o}
                          </div>
                        ))}</div>
                      : f.type === "optin"
                        ? <div className="flex items-center gap-1.5 text-[10px] text-ink-400"><span className="inline-block w-3 h-3 border border-line rounded" />{f.label}</div>
                        : <div className="border border-line rounded-lg px-2 py-1.5 text-[10px] text-ink-400">{f.type === "date" ? "📅 Select date" : f.type === "textarea" ? "Type here…" : `Enter ${f.type}`}</div>}
                  </div>
                ))}
                {!fields.some(f => f.label.trim()) && <p className="text-[10px] text-ink-400 text-center py-4">Add fields to see them here</p>}
                <button className="w-full py-1.5 rounded-full bg-brand-700 text-white text-[11px] font-bold">Submit</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-card border border-line divide-y divide-line">
        {forms.map(f => (
          <div key={f.id} className="px-4 py-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-control bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><ClipboardList className="w-[18px] h-[18px]" /></div>
            <div className="min-w-0 flex-1">
              <button onClick={() => renameForm(f)} disabled={busy === "rename:" + f.id} title="Click to rename" className="text-sm font-semibold text-ink-900 truncate text-left hover:underline disabled:opacity-60">{f.name}</button>
              {f.validationErrors.length > 0 && <p className="text-[11px] text-red-500 truncate">Fix before publishing: {f.validationErrors.join(" · ")}</p>}
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${statusPill(f.status)}`}>{f.status}</span>
            {f.previewUrl && (
              <a href={f.previewUrl} target="_blank" rel="noreferrer" title="Open Meta's interactive preview"
                className="p-1.5 text-ink-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg shrink-0"><ExternalLink className="w-4 h-4" /></a>
            )}
            {f.status !== "DEPRECATED" && (
              <button onClick={() => openEdit(f)} disabled={busy === "load:" + f.id}
                className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 disabled:opacity-60">
                {busy === "load:" + f.id ? "…" : f.status === "PUBLISHED" ? "Edit a copy" : "Edit"}
              </button>
            )}
            {f.status === "DRAFT" && f.validationErrors.length === 0 && (
              <button onClick={() => publish(f.id)} disabled={busy === f.id}
                className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold shrink-0 disabled:opacity-60">
                {busy === f.id ? "…" : "Publish"}
              </button>
            )}
            <button onClick={() => remove(f)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {forms.length === 0 && <p className="px-4 py-8 text-center text-ink-400 text-sm">{notice ? "Forms appear here once Meta credentials are set." : "No forms yet — hit New form to build your first one."}</p>}
      </div>

      <p className="text-[11px] text-ink-400">To send a form in a chatbot: open <b>Chatbot Flows</b> → drag the <b>WhatsApp form</b> block → pick a published form. The flow waits for the submission and then continues.</p>
    </div>
    <FormsRail goTo={goTo} forms={forms} />
    </div>
  );
}

// ── Analytics ─────────────────────────────────────────────────────────────────
type AnalyticsData = {
  contacts: { active: number; optedOut: number };
  campaigns: { total: number; automations: number };
  conversations: { total: number; active: number; escalated: number; needsReply: number };
  kb: { documents: number; ready: number };
  messaging: { sentToday: number; totals: { sent: number; delivered: number; read: number; failed: number } };
  daily: { date: string; sent: number; delivered: number; read: number; failed: number }[];
};

// ── Lightweight SVG charts (no chart library) ────────────────────────────────
function buildArea(values: number[], w: number, h: number, pad: number) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => ({
    x: n <= 1 ? w / 2 : (i / (n - 1)) * w,
    y: h - pad - (v / max) * (h - pad * 2),
  }));
  let line = pts.length ? `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}` : "";
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2;
    line += ` C ${cx.toFixed(1)} ${pts[i].y.toFixed(1)} ${cx.toFixed(1)} ${pts[i + 1].y.toFixed(1)} ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`;
  }
  return { pts, line, area: pts.length ? `${line} L ${w} ${h} L 0 ${h} Z` : "", max };
}

// Smooth area/line chart with a highlighted peak (HTML overlay keeps the dot +
// tooltip crisp while the line stretches to full width).
function AreaChart({ daily }: { daily: AnalyticsData["daily"] }) {
  const W = 720, H = 200, PAD = 18;
  const values = daily.map(d => d.sent);
  const { pts, line, area, max } = buildArea(values, W, H, PAD);
  const peakIdx = values.length ? values.indexOf(Math.max(...values)) : -1;
  const peak = peakIdx >= 0 ? pts[peakIdx] : null;
  const grid = [0, 0.5, 1].map(f => H - PAD - f * (H - PAD * 2));
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }}>
        <defs>
          <linearGradient id="waArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0783FD" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0783FD" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((y, i) => <line key={i} x1="0" y1={y} x2={W} y2={y} stroke="#EEF2F7" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        {area && <path d={area} fill="url(#waArea)" />}
        {line && <path d={line} fill="none" stroke="#0783FD" strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {peak && max > 1 && <line x1={peak.x} y1={peak.y} x2={peak.x} y2={H} stroke="#0783FD" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" vectorEffect="non-scaling-stroke" />}
      </svg>
      {peak && max > 1 && (
        <>
          <span className="absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-700 shadow" style={{ left: `${(peak.x / W) * 100}%`, top: peak.y }} />
          <span className="absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink-900 px-2 py-1 text-[10px] font-bold text-white shadow-lg" style={{ left: `${(peak.x / W) * 100}%`, top: peak.y - 8 }}>
            {values[peakIdx].toLocaleString()} · {daily[peakIdx]?.date.slice(5)}
          </span>
        </>
      )}
      <div className="mt-2 flex justify-between text-[9px] text-ink-400">
        {daily.filter((_, i) => i % 2 === 0 || i === daily.length - 1).map(d => <span key={d.date}>{d.date.slice(5)}</span>)}
      </div>
    </div>
  );
}

// Donut with center label + legend (delivery breakdown of the last 14 days).
function DeliveryDonut({ segments, centerValue, centerLabel }: { segments: { label: string; value: number; color: string }[]; centerValue: string; centerLabel: string }) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const R = 56, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" className="-rotate-90">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#F1F5F9" strokeWidth="16" />
          {segments.map((s, i) => {
            const len = (s.value / total) * C;
            const el = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={s.color} strokeWidth="16" strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`} strokeDashoffset={(-offset).toFixed(2)} />;
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-bold text-ink-900 tnum leading-none">{centerValue}</span>
          <span className="text-[10px] text-ink-400 mt-1">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex-1 space-y-2.5">
        {segments.map(s => (
          <li key={s.label} className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-2 text-ink-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="font-bold text-ink-900 tnum">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/admin/analytics").then(r => r.json()).then(d => { setData(d.analytics ?? null); setNotice(d.notice ?? null); }).catch(() => {});
  }, []);

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");

  // Secondary KPIs (the first metric is the green hero card below).
  const cards: { label: string; value: string; sub?: string; icon: React.ReactNode }[] = data ? [
    { label: "Sent today", value: data.messaging.sentToday.toLocaleString(), sub: `cap ${process.env.NEXT_PUBLIC_WA_DAILY_LIMIT ?? "900"}`, icon: <Send className="w-[18px] h-[18px]" /> },
    { label: "Delivery rate", value: pct(data.messaging.totals.delivered, data.messaging.totals.sent), sub: `${data.messaging.totals.delivered.toLocaleString()} delivered (14d)`, icon: <CircleCheck className="w-[18px] h-[18px]" /> },
    { label: "Read rate", value: pct(data.messaging.totals.read, data.messaging.totals.sent), sub: `${data.messaging.totals.read.toLocaleString()} read (14d)`, icon: <MessageSquare className="w-[18px] h-[18px]" /> },
    { label: "Campaigns", value: data.campaigns.total.toLocaleString(), sub: `${data.campaigns.automations} automations`, icon: <Send className="w-[18px] h-[18px]" /> },
    { label: "Conversations", value: data.conversations.total.toLocaleString(), sub: `${data.conversations.escalated} escalated · ${data.conversations.needsReply} awaiting`, icon: <MessageSquare className="w-[18px] h-[18px]" /> },
    { label: "Failed (14d)", value: data.messaging.totals.failed.toLocaleString(), icon: <AlertTriangle className="w-[18px] h-[18px]" /> },
    { label: "KB documents", value: data.kb.documents.toLocaleString(), sub: `${data.kb.ready} ready`, icon: <Database className="w-[18px] h-[18px]" /> },
  ] : [];

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink-900">Analytics overview</h2>
        <p className="text-[13px] text-ink-400">Messaging performance across WhatsApp &amp; Instagram</p>
      </div>
      {notice && <div className="bg-amber-50 border border-amber-200 rounded-control px-4 py-3 text-sm text-amber-800">{notice}</div>}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Green hero card — the one signature green surface per the brief. */}
            <div className="relative overflow-hidden rounded-card p-5 bg-gradient-to-br from-brand-600 to-brand-900 text-white">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-control bg-white/15 flex items-center justify-center"><Users className="w-[18px] h-[18px]" /></div>
              </div>
              <p className="text-[28px] font-bold mt-3 leading-none tnum">{data.contacts.active.toLocaleString()}</p>
              <p className="text-[13px] font-medium text-white/80 mt-1.5">Active contacts</p>
              <p className="text-[11px] text-white/60 mt-0.5">{data.contacts.optedOut.toLocaleString()} opted out</p>
            </div>
            {cards.map(c => (
              <div key={c.label} className="bg-white rounded-card border border-line p-5 transition-colors hover:border-[#D4D4D8]">
                <div className="w-9 h-9 rounded-control bg-brand-50 text-brand-700 flex items-center justify-center">{c.icon}</div>
                <p className="text-[28px] font-bold text-ink-900 mt-3 leading-none tnum tracking-[-0.02em]">{c.value}</p>
                <p className="text-[13px] font-medium text-ink-600 mt-1.5">{c.label}</p>
                {c.sub && <p className="text-[11px] text-ink-400 mt-0.5">{c.sub}</p>}
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Messages trend — smooth area chart with peak callout */}
            <section className="lg:col-span-2 bg-white rounded-card border border-line p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Messages sent</p>
                  <p className="text-[12px] text-ink-400">Last 14 days · {data.messaging.totals.sent.toLocaleString()} total</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">{pct(data.messaging.totals.delivered, data.messaging.totals.sent)} delivered</span>
              </div>
              <AreaChart daily={data.daily} />
            </section>

            {/* Delivery breakdown — donut */}
            <section className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-semibold text-ink-900 mb-5">Delivery breakdown</p>
              <DeliveryDonut
                centerValue={pct(data.messaging.totals.delivered, data.messaging.totals.sent)}
                centerLabel="delivered"
                segments={[
                  { label: "Read", value: data.messaging.totals.read, color: "#0783FD" },
                  { label: "Delivered", value: Math.max(0, data.messaging.totals.delivered - data.messaging.totals.read), color: "#4DA3FF" },
                  { label: "Pending", value: Math.max(0, data.messaging.totals.sent - data.messaging.totals.delivered - data.messaging.totals.failed), color: "#CFE6FF" },
                  { label: "Failed", value: data.messaging.totals.failed, color: "#F97066" },
                ]}
              />
            </section>
          </div>
        </>
      )}
      {!data && !notice && <p className="text-center text-ink-400 text-sm py-8">Loading…</p>}
    </div>
  );
}

// ── Contacts ─────────────────────────────────────────────────────────────────
type ContactRow = { id: string; phone: string; name: string; email: string | null; tags: string[]; status: string; source: string | null; createdAt: string };

// ── Advanced filters (AiSensy-style) ──
type AttrFilter = { key: string; op: "is" | "is_not" | "contains"; value: string };
type AdvFilters = { seenFrom: string; seenTo: string; createdFrom: string; createdTo: string; attrs: AttrFilter[] };
const EMPTY_ADV: AdvFilters = { seenFrom: "", seenTo: "", createdFrom: "", createdTo: "", attrs: [] };
const advActive = (a: AdvFilters) => !!(a.seenFrom || a.seenTo || a.createdFrom || a.createdTo || a.attrs.some(x => x.key.trim()));

// ── CSV upload + auto column mapping ──
type ImportRow = { phone: string; name?: string; email?: string; tags?: string[]; attributes?: Record<string, string> };

// Minimal CSV parser — handles quoted fields and CRLF.
function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const CSV_COL: Record<string, string[]> = {
  phone: ["phone", "mobile", "mobile number", "mobile_no", "whatsapp", "whatsapp number", "number", "contact", "contact number", "phone number", "msisdn"],
  name: ["name", "full name", "fullname", "first name", "contact name", "customer name", "lead name"],
  email: ["email", "e-mail", "email id", "email address"],
  tags: ["tags", "tag", "labels", "label", "groups", "segment"],
};
const looksLikePhone = (s: string) => /^\+?\d[\d\s()-]{7,}$/.test(s.trim());

// Auto-detects the header row and maps columns: known headers → fields, every
// other headed column → a contact attribute. Headerless files fall back to
// positional phone,name,tags.
function mapCsvRows(cells: string[][]): { rows: ImportRow[]; mapping: string[] } {
  if (!cells.length) return { rows: [], mapping: [] };
  const head = cells[0].map(c => c.trim().toLowerCase());
  const find = (names: string[]) => head.findIndex(h => names.includes(h));
  let pi = find(CSV_COL.phone);
  let ni = find(CSV_COL.name);
  const ei = find(CSV_COL.email);
  let ti = find(CSV_COL.tags);
  const hasHeader = pi >= 0 || ni >= 0 || ei >= 0 || ti >= 0 || !looksLikePhone(cells[0][0] ?? "");
  if (pi < 0) pi = 0;
  if (!hasHeader) { if (ni < 0) ni = 1; if (ti < 0) ti = 2; }

  const attrCols: { idx: number; key: string }[] = [];
  if (hasHeader) {
    cells[0].forEach((h, idx) => {
      if (idx !== pi && idx !== ni && idx !== ei && idx !== ti && h.trim()) attrCols.push({ idx, key: h.trim() });
    });
  }
  const dataRows = hasHeader ? cells.slice(1) : cells;
  const rows: ImportRow[] = dataRows.map(r => {
    const attributes: Record<string, string> = {};
    for (const a of attrCols) { const v = (r[a.idx] ?? "").trim(); if (v) attributes[a.key] = v; }
    return {
      phone: (r[pi] ?? "").trim(),
      name: ni >= 0 ? (r[ni] ?? "").trim() : "",
      email: ei >= 0 ? ((r[ei] ?? "").trim() || undefined) : undefined,
      tags: ti >= 0 ? (r[ti] ?? "").split(/[;|]/).map(t => t.trim()).filter(Boolean) : [],
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
  }).filter(r => looksLikePhone(r.phone));
  const mapping = [
    `phone ← ${hasHeader ? `"${cells[0][pi]?.trim() || "column 1"}"` : "column 1"}`,
    ni >= 0 ? `name ← ${hasHeader ? `"${cells[0][ni]?.trim()}"` : "column 2"}` : null,
    ei >= 0 ? `email ← "${cells[0][ei]?.trim()}"` : null,
    ti >= 0 ? `tags ← ${hasHeader ? `"${cells[0][ti]?.trim()}"` : "column 3"}` : null,
    ...attrCols.map(a => `attribute "${a.key}"`),
  ].filter(Boolean) as string[];
  return { rows, mapping };
}

// ── Lead profile drawer — everything a sales/marketing person needs on one lead ──
type SalesBrief = { temperature: "hot" | "warm" | "cold"; summary: string; interestedIn: string; intent: string; objections: string; nextStep: string; talkingPoints: string[] };
type CrmLead = { id: string; stage: string | null; owner: string | null; score: number | null; source: string | null; fields: { label: string; value: string }[] };
type LeadProfile = {
  contact: { id: string; phone: string; name: string; email: string | null; tags: string[]; attributes: Record<string, string>; status: string; source: string | null; createdAt: string };
  conversation: { id: string; status: string; botEnabled: boolean; assignedTo: string | null; labels: string[]; lastInboundAt: string | null; lastOutboundAt: string | null } | null;
  messages: { role: string; body: string; source: string; createdAt: string }[];
  msgCounts: { inbound: number; outbound: number };
  campaigns: { name: string; status: string; sentAt: string }[];
  clicks: { url: string; clicks: number; at: string | null }[];
};

function ContactProfile({ phone, onClose, onChanged, goTo }: { phone: string; onClose: () => void; onChanged: () => void; goTo: (t: Tab) => void }) {
  const [p, setP] = useState<LeadProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [attrKey, setAttrKey] = useState("");
  const [attrVal, setAttrVal] = useState("");
  const [edit, setEdit] = useState<{ name: string; email: string } | null>(null);
  const [brief, setBrief] = useState<SalesBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [crm, setCrm] = useState<{ configured: boolean; lead: CrmLead | null } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/contacts/profile?phone=${encodeURIComponent(phone)}`).then(r => r.json()).then(d => setP(d.contact ? d : null)).catch(() => {});
  }, [phone]);
  // CRM snapshot (LeadSquared) — best-effort, silent when LSQ isn't configured.
  useEffect(() => {
    setCrm(null); setBrief(null); setBriefErr(null);
    fetch(`/api/admin/contacts/crm?phone=${encodeURIComponent(phone)}`).then(r => r.json()).then(setCrm).catch(() => {});
  }, [phone]);

  async function genBrief() {
    setBriefBusy(true); setBriefErr(null);
    try {
      const d = await fetch("/api/admin/contacts/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) }).then(r => r.json());
      if (d.brief) setBrief(d.brief); else setBriefErr(d.error || "Could not generate the brief.");
    } catch { setBriefErr("Connection error."); }
    finally { setBriefBusy(false); }
  }
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch("/api/admin/contacts/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ...body }) });
      load(); onChanged();
    } finally { setBusy(false); }
  }

  async function toggleOptout() {
    if (!p) return;
    const active = p.contact.status === "active";
    if (active && !confirm(`Opt ${p.contact.name || phone} out? They'll stop receiving all broadcasts.`)) return;
    setBusy(true);
    try {
      await fetch("/api/admin/optouts", {
        method: active ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(active ? { phone, reason: "added by team" } : { phone }),
      });
      load(); onChanged();
    } finally { setBusy(false); }
  }

  const c = p?.contact;
  const adAttrs = c ? Object.entries(c.attributes).filter(([k]) => k.startsWith("ad_")) : [];
  const leadAttrs = c ? Object.entries(c.attributes).filter(([k]) => !k.startsWith("ad_")) : [];
  const reads = p?.campaigns.filter(x => x.status === "read").length ?? 0;
  const lastActive = p?.conversation?.lastInboundAt;
  const sectionTitle = "text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]";
  const logStatus = (s: string) =>
    s === "read" ? "bg-brand-100 text-brand-700" : s === "delivered" ? "bg-brand-50 text-brand-700"
    : s === "sent" ? "bg-canvas text-ink-600" : s === "failed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700";

  return (
    <>
      <div className="fixed inset-0 bg-ink-950/20 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-[460px] max-w-full bg-white border-l border-line shadow-2xl z-50 overflow-y-auto">
        {!c ? <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div> : (
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-lg font-bold shrink-0">
                {(c.name || c.phone).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {edit ? (
                  <div className="space-y-1.5">
                    <input className={`${inp} w-full`} placeholder="Name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
                    <input className={`${inp} w-full`} placeholder="email@example.com" value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={() => { patch({ name: edit.name.trim(), email: edit.email.trim() || null }); setEdit(null); }} className="px-3 py-1 rounded-lg bg-brand-700 text-white text-xs font-bold">Save</button>
                      <button onClick={() => setEdit(null)} className="text-xs text-slate-400 font-bold">cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-base font-extrabold text-ink-900 truncate">{c.name || "Unnamed lead"}
                      <button onClick={() => setEdit({ name: c.name, email: c.email ?? "" })} className="ml-2 text-[11px] font-bold text-brand-700 hover:underline">edit</button>
                    </p>
                    <p className="text-xs font-mono text-ink-600">{c.phone}</p>
                    <p className="text-[11px] text-slate-400 truncate">{c.email || "no email"} · {c.source?.toUpperCase() ?? "—"} · lead since {new Date(c.createdAt).toLocaleDateString()}</p>
                  </>
                )}
              </div>
              <button onClick={onClose} className="p-1.5 text-ink-400 hover:text-ink-900 shrink-0"><X className="w-4 h-4" /></button>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={() => { onClose(); goTo("livechat"); }} className="flex-1 px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center justify-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Open chat</button>
              <button disabled={busy} onClick={toggleOptout} className={`flex-1 px-3 py-2 rounded-control border text-xs font-bold ${c.status === "active" ? "border-red-200 text-red-600 hover:bg-red-50" : "border-brand-200 text-brand-700 hover:bg-brand-50"}`}>
                {c.status === "active" ? "Opt out" : "Re-subscribe"}
              </button>
            </div>

            {/* AI sales brief */}
            <div className="rounded-control border border-brand-100 bg-brand-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-brand-700 uppercase tracking-[0.06em] flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Sales brief</p>
                <button disabled={briefBusy} onClick={genBrief} className="text-[11px] font-bold text-brand-700 hover:underline flex items-center gap-1 disabled:opacity-50">
                  {briefBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {brief ? "Regenerate" : "Generate"}
                </button>
              </div>
              {briefErr && <p className="text-[11px] text-red-600">{briefErr}</p>}
              {!brief && !briefBusy && !briefErr && <p className="text-xs text-slate-500">One tap to summarise this lead for your call — their interest, intent, objections, and the best next step.</p>}
              {briefBusy && !brief && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the conversation…</p>}
              {brief && (
                <div className="space-y-1.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${brief.temperature === "hot" ? "bg-red-100 text-red-700" : brief.temperature === "warm" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {brief.temperature === "hot" ? "🔥 HOT" : brief.temperature === "warm" ? "🌤 WARM" : "❄️ COLD"} LEAD
                  </span>
                  <p className="text-xs text-ink-900">{brief.summary}</p>
                  <div className="text-xs text-ink-700 space-y-0.5">
                    <p><span className="font-semibold text-slate-500">Interested in:</span> {brief.interestedIn}</p>
                    <p><span className="font-semibold text-slate-500">Intent:</span> {brief.intent}</p>
                    <p><span className="font-semibold text-slate-500">Objections:</span> {brief.objections}</p>
                    <p><span className="font-semibold text-brand-700">Next step:</span> {brief.nextStep}</p>
                  </div>
                  {brief.talkingPoints.length > 0 && (
                    <ul className="list-disc pl-4 text-xs text-ink-700 space-y-0.5">
                      {brief.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  )}
                  <p className="text-[10px] text-slate-400 pt-0.5">AI-generated from this lead&apos;s chat — verify before acting.</p>
                </div>
              )}
            </div>

            {/* LeadSquared CRM snapshot */}
            {crm?.lead && (() => {
              const rows: [string, string][] = [
                ...(crm.lead.stage ? [["Stage", crm.lead.stage] as [string, string]] : []),
                ...(crm.lead.owner ? [["Owner", crm.lead.owner] as [string, string]] : []),
                ...(crm.lead.score != null ? [["Score", String(crm.lead.score)] as [string, string]] : []),
                ...(crm.lead.source ? [["Source", crm.lead.source] as [string, string]] : []),
                ...crm.lead.fields.map(f => [f.label, f.value] as [string, string]),
              ];
              return (
                <div className="space-y-2">
                  <p className={`${sectionTitle} flex items-center gap-1.5`}><Database className="w-3.5 h-3.5" /> LeadSquared CRM</p>
                  <div className="border border-line rounded-control divide-y divide-line">
                    {rows.map(([k, v]) => (
                      <div key={k} className="px-3 py-1.5 flex items-start justify-between gap-3">
                        <span className="text-[11px] font-semibold text-slate-400 pt-0.5">{k}</span>
                        <span className="text-xs text-ink-900 text-right flex-1">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Engagement summary */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Msgs from lead", value: p?.msgCounts.inbound ?? 0 },
                { label: "Replies to lead", value: p?.msgCounts.outbound ?? 0 },
                { label: "Campaigns read", value: `${reads}/${p?.campaigns.length ?? 0}` },
              ].map(s => (
                <div key={s.label} className="bg-canvas rounded-control p-2.5 text-center">
                  <p className="text-base font-extrabold text-ink-900">{s.value}</p>
                  <p className="text-[10px] text-slate-500 font-semibold">{s.label}</p>
                </div>
              ))}
            </div>
            {lastActive && <p className="text-[11px] text-slate-400 -mt-2">Last heard from: {new Date(lastActive).toLocaleString()}</p>}

            {/* Ad attribution */}
            {adAttrs.length > 0 && (
              <div className="bg-brand-50 border border-brand-100 rounded-control px-3 py-2.5">
                <p className="text-[11px] font-bold text-brand-700 uppercase mb-1">Came from a Meta ad</p>
                {adAttrs.map(([k, v]) => <p key={k} className="text-xs text-brand-900"><span className="font-mono text-brand-700">{k.replace("ad_", "")}</span>: {v}</p>)}
              </div>
            )}

            {/* Lead details (attributes) */}
            <div className="space-y-2">
              <p className={sectionTitle}>Lead details — collected by AI, flows & forms</p>
              {leadAttrs.length === 0 && <p className="text-xs text-slate-400">Nothing collected yet — details appear here as the AI, chatbot flows, and WhatsApp forms learn about this lead.</p>}
              {leadAttrs.length > 0 && (
                <div className="border border-line rounded-control divide-y divide-line">
                  {leadAttrs.map(([k, v]) => (
                    <div key={k} className="px-3 py-1.5 flex items-start justify-between gap-3">
                      <span className="text-[11px] font-semibold text-slate-400 pt-0.5">{k}</span>
                      <span className="text-xs text-ink-900 text-right flex-1">{v}</span>
                      <button disabled={busy} onClick={() => { const next = { ...c.attributes }; delete next[k]; patch({ attributes: next }); }} className="text-ink-300 hover:text-red-500 text-xs">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input className={`${inp} w-28 !py-1.5 text-xs`} placeholder="field" value={attrKey} onChange={e => setAttrKey(e.target.value)} />
                <input className={`${inp} flex-1 !py-1.5 text-xs`} placeholder="value (e.g. Data Science)" value={attrVal} onChange={e => setAttrVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && attrKey.trim() && attrVal.trim()) { patch({ attributes: { ...c.attributes, [attrKey.trim()]: attrVal.trim() } }); setAttrKey(""); setAttrVal(""); } }} />
                <button disabled={busy || !attrKey.trim() || !attrVal.trim()} onClick={() => { patch({ attributes: { ...c.attributes, [attrKey.trim()]: attrVal.trim() } }); setAttrKey(""); setAttrVal(""); }} className="px-2.5 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50">+</button>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <p className={sectionTitle}>Tags</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {c.tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
                    {t}<button disabled={busy} onClick={() => patch({ tags: c.tags.filter(x => x !== t) })} className="text-brand-700/50 hover:text-red-500">×</button>
                  </span>
                ))}
                <input className="border border-line rounded-full px-2.5 py-0.5 text-[11px] w-24 focus:outline-none" placeholder="+ tag" value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && tagInput.trim()) { patch({ tags: [...c.tags, tagInput.trim()] }); setTagInput(""); } }} />
              </div>
            </div>

            {/* Conversation snapshot */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className={sectionTitle}>Conversation</p>
                {p?.conversation && <button onClick={() => { onClose(); goTo("livechat"); }} className="text-[11px] font-bold text-brand-700 hover:underline">Open in Live Chat →</button>}
              </div>
              {!p?.conversation ? <p className="text-xs text-slate-400">No conversation yet — they haven&apos;t messaged you, or you haven&apos;t broadcast to them.</p> : (
                <>
                  <p className="text-[11px] text-slate-500">
                    {p.conversation.status === "escalated" ? "🔴 Escalated to a human" : p.conversation.botEnabled ? "🤖 AI is replying" : "👤 Human handling (bot off)"}
                    {p.conversation.assignedTo ? ` · assigned to ${p.conversation.assignedTo}` : ""}
                  </p>
                  <div className="border border-line rounded-control divide-y divide-line max-h-44 overflow-y-auto">
                    {p.messages.map((m, i) => (
                      <div key={i} className="px-3 py-1.5">
                        <p className="text-[10px] font-bold text-slate-400">{m.role === "user" ? c.name || "Lead" : m.source === "agent" ? "Team" : "AI"} · {new Date(m.createdAt).toLocaleString()}</p>
                        <p className="text-xs text-ink-900 line-clamp-2">{m.body}</p>
                      </div>
                    ))}
                    {p.messages.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">No messages yet.</p>}
                  </div>
                </>
              )}
            </div>

            {/* Campaign history */}
            <div className="space-y-2">
              <p className={sectionTitle}>Campaigns received</p>
              {(p?.campaigns.length ?? 0) === 0 ? <p className="text-xs text-slate-400">No broadcasts sent to this lead yet.</p> : (
                <div className="border border-line rounded-control divide-y divide-line">
                  {p?.campaigns.map((x, i) => (
                    <div key={i} className="px-3 py-1.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink-900 truncate">{x.name}</p>
                        <p className="text-[10px] text-slate-400">{new Date(x.sentAt).toLocaleString()}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${logStatus(x.status)}`}>{x.status.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Link clicks */}
            {(p?.clicks.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className={sectionTitle}>Links they tapped</p>
                <div className="border border-line rounded-control divide-y divide-line">
                  {p?.clicks.map((l, i) => (
                    <div key={i} className="px-3 py-1.5">
                      <p className="text-xs text-brand-700 truncate">{l.url}</p>
                      <p className="text-[10px] text-slate-400">{l.clicks}× {l.at ? `· first on ${new Date(l.at).toLocaleString()}` : ""}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function ContactsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "optedout">("all");
  const [showFilter, setShowFilter] = useState(false);
  const [offset, setOffset] = useState(0);
  const [perPage, setPerPage] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [addPhone, setAddPhone] = useState("");
  const [addName, setAddName] = useState("");
  const [addTags, setAddTags] = useState("");
  const [csvPreview, setCsvPreview] = useState<{ fileName: string; rows: ImportRow[]; mapping: string[]; skipped: number } | null>(null);
  const [adv, setAdv] = useState<AdvFilters>(EMPTY_ADV);          // draft (being edited)
  const [applied, setApplied] = useState<AdvFilters>(EMPTY_ADV);  // active (drives the query)
  const [importing, setImporting] = useState(false);
  const [importConsent, setImportConsent] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [quota, setQuota] = useState<{ sentToday: number } | null>(null);

  const dailyLimit = parseInt(process.env.NEXT_PUBLIC_WA_DAILY_LIMIT ?? "900", 10);

  const load = useCallback(() => {
    const params = new URLSearchParams({ search, offset: String(offset), limit: String(perPage) });
    if (tagFilter.trim()) params.set("tag", tagFilter.trim());
    if (applied.createdFrom) params.set("createdFrom", applied.createdFrom);
    if (applied.createdTo) params.set("createdTo", applied.createdTo);
    if (applied.seenFrom) params.set("seenFrom", applied.seenFrom);
    if (applied.seenTo) params.set("seenTo", applied.seenTo);
    const attrs = applied.attrs.filter(a => a.key.trim());
    if (attrs.length) params.set("attrs", JSON.stringify(attrs));
    fetch(`/api/admin/contacts?${params}`).then(r => r.json()).then(d => { setContacts(d.contacts ?? []); setTotal(d.total ?? 0); }).catch(() => {});
  }, [search, tagFilter, offset, perPage, applied]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); setSelected(new Set()); }, [search, tagFilter, perPage, applied]);
  useEffect(() => {
    fetch("/api/admin/analytics").then(r => r.json()).then(d => { if (d?.messaging) setQuota({ sentToday: d.messaging.sentToday ?? 0 }); }).catch(() => {});
  }, []);

  const visible = statusFilter === "all" ? contacts : contacts.filter(c => c.status === statusFilter);
  const allChecked = visible.length > 0 && visible.every(c => selected.has(c.id));

  const toggleAll = () => setSelected(s => {
    const next = new Set(s);
    if (allChecked) visible.forEach(c => next.delete(c.id)); else visible.forEach(c => next.add(c.id));
    return next;
  });
  const toggleOne = (id: string) => setSelected(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  function broadcastSelected() {
    const recipients = contacts.filter(c => selected.has(c.id) && c.status === "active").map(c => ({ phone: c.phone, fullName: c.name }));
    if (!recipients.length) { setMsg("Select at least one active contact."); return; }
    sessionStorage.setItem("wa_retarget", JSON.stringify({ note: `Selected contacts (${recipients.length})`, recipients }));
    goTo("broadcast");
  }

  function exportCsv() {
    const rows = selected.size ? contacts.filter(c => selected.has(c.id)) : visible;
    const body = ["phone,name,email,tags,status,source", ...rows.map(c =>
      [c.phone, `"${(c.name || "").replaceAll('"', '""')}"`, c.email ?? "", `"${c.tags.join(";")}"`, c.status, c.source ?? ""].join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = "contacts.csv"; a.click(); URL.revokeObjectURL(a.href);
  }

  async function importRows(rows: ImportRow[], consent = true) {
    setImporting(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: rows, consent }) });
      const d = await res.json();
      setMsg(res.ok
        ? `Imported ${d.inserted}, skipped ${d.skipped} (duplicates)${d.invalid ? `, ${d.invalid} invalid number${d.invalid === 1 ? "" : "s"}` : ""}.${consent ? "" : " Marked not-opted-in — excluded from broadcasts until they opt in."}`
        : (d.error || "Import failed"));
      if (res.ok) { setCsvPreview(null); setAddPhone(""); setAddName(""); setAddTags(""); load(); }
      return res.ok;
    } finally { setImporting(false); }
  }

  async function addContact() {
    if (!addPhone.trim()) { setMsg("Phone is required."); return; }
    const ok = await importRows([{ phone: addPhone.trim(), name: addName.trim(), tags: addTags.split(/[;,]/).map(t => t.trim()).filter(Boolean) }], true);
    if (ok) setShowAdd(false);
  }

  // CSV file picked — parse, auto-map columns, show the preview for confirmation.
  async function onCsvFile(f: File) {
    setMsg(null);
    try {
      const cells = parseCsvText(await f.text());
      const { rows, mapping } = mapCsvRows(cells);
      const dataCount = Math.max(0, cells.length - (rows.length === cells.length ? 0 : 1));
      if (!rows.length) { setMsg("No rows with a valid phone number found in this file."); setCsvPreview(null); return; }
      setCsvPreview({ fileName: f.name, rows, mapping, skipped: Math.max(0, dataCount - rows.length) });
    } catch { setMsg("Could not read that file — make sure it's a CSV."); }
  }

  // Quick-range helpers for the filter chips.
  const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const isoStartOf = (unit: "day" | "week" | "month") => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (unit === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (unit === "month") d.setDate(1);
    return d.toISOString();
  };
  const setAdvField = (patch: Partial<AdvFilters>) => setAdv(a => ({ ...a, ...patch }));
  const setAttr = (i: number, patch: Partial<AttrFilter>) => setAdv(a => ({ ...a, attrs: a.attrs.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  const page = Math.floor(offset / perPage) + 1;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const toolbarBtn = "px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5";

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-extrabold text-brand-dark">Contacts <span className="text-sm font-normal text-slate-400">({total.toLocaleString()})</span></h2>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Daily quota <span className="ml-1 px-2 py-0.5 rounded-full bg-brand-green/15 text-brand-dark font-bold">{dailyLimit.toLocaleString()}/24h</span></span>
          {quota && <span>Remaining today <b className="text-brand-dark">{Math.max(0, dailyLimit - quota.sentToday).toLocaleString()}</b></span>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${inp} w-64`} placeholder="Search name or mobile number" value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={() => setShowFilter(v => !v)} className={`${toolbarBtn} ${showFilter || tagFilter || statusFilter !== "all" || advActive(applied) ? "border-brand-dark text-brand-dark" : ""}`}>
          <Filter className="w-4 h-4" /> Filter{advActive(applied) ? " ·" : ""}
        </button>
        <div className="flex-1" />
        <button onClick={broadcastSelected} disabled={selected.size === 0}
          className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-40">
          <Send className="w-4 h-4" /> BROADCAST{selected.size > 0 ? ` (${selected.size})` : ""}
        </button>
        <button onClick={() => { setShowAdd(v => !v); setShowImport(false); }} className={toolbarBtn}><Plus className="w-4 h-4" /> Add Contact</button>
        <button onClick={() => { setShowImport(v => !v); setShowAdd(false); }} className={toolbarBtn}><UploadCloud className="w-4 h-4" /> Import</button>
        <button onClick={exportCsv} className={toolbarBtn} title="Export selected (or current view) as CSV"><Download className="w-4 h-4" /> Export</button>
      </div>

      {showFilter && (() => {
        const chip = "px-2.5 py-1.5 rounded-lg border border-line text-xs font-semibold text-slate-500 hover:bg-slate-50";
        const dateVal = (s: string) => (s ? s.slice(0, 10) : "");
        const endOfDay = (d: string) => (d ? `${d}T23:59:59` : "");
        return (
          <div className="bg-white rounded-card border border-line p-5 space-y-4">
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-2">
                Last Seen
                {(adv.seenFrom || adv.seenTo) && <button onClick={() => setAdvField({ seenFrom: "", seenTo: "" })} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button className={chip} onClick={() => setAdvField({ seenFrom: isoDaysAgo(1), seenTo: "" })}>In 24hr</button>
                <button className={chip} onClick={() => setAdvField({ seenFrom: isoStartOf("week"), seenTo: "" })}>This Week</button>
                <button className={chip} onClick={() => setAdvField({ seenFrom: isoStartOf("month"), seenTo: "" })}>This Month</button>
                <input type="date" className={inp} value={dateVal(adv.seenFrom)} onChange={e => setAdvField({ seenFrom: e.target.value })} />
                <input type="date" className={inp} value={dateVal(adv.seenTo)} onChange={e => setAdvField({ seenTo: endOfDay(e.target.value) })} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5 flex items-center gap-2">
                Created At
                {(adv.createdFrom || adv.createdTo) && <button onClick={() => setAdvField({ createdFrom: "", createdTo: "" })} className="text-slate-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>}
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <button className={chip} onClick={() => setAdvField({ createdFrom: isoStartOf("day"), createdTo: "" })}>Today</button>
                <button className={chip} onClick={() => setAdvField({ createdFrom: isoStartOf("week"), createdTo: "" })}>This Week</button>
                <button className={chip} onClick={() => setAdvField({ createdFrom: isoStartOf("month"), createdTo: "" })}>This Month</button>
                <input type="date" className={inp} value={dateVal(adv.createdFrom)} onChange={e => setAdvField({ createdFrom: e.target.value })} />
                <input type="date" className={inp} value={dateVal(adv.createdTo)} onChange={e => setAdvField({ createdTo: endOfDay(e.target.value) })} />
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Attributes</p>
              <div className="space-y-2">
                {adv.attrs.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={`${inp} w-44`} placeholder="attribute, e.g. course" value={a.key} onChange={e => setAttr(i, { key: e.target.value })} />
                    <select className={`${inp} w-28`} value={a.op} onChange={e => setAttr(i, { op: e.target.value as AttrFilter["op"] })}>
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                      <option value="contains">contains</option>
                    </select>
                    <input className={`${inp} flex-1 max-w-xs`} placeholder="value, e.g. Data Analytics" value={a.value} onChange={e => setAttr(i, { value: e.target.value })} />
                    {i < adv.attrs.length - 1 && <span className="text-xs text-slate-400 font-semibold">and</span>}
                    <button onClick={() => setAdv(x => ({ ...x, attrs: x.attrs.filter((_, j) => j !== i) }))} className="p-1 text-slate-300 hover:text-red-500"><X className="w-4 h-4" /></button>
                  </div>
                ))}
                <button onClick={() => setAdv(x => ({ ...x, attrs: [...x.attrs, { key: "", op: "is", value: "" }] }))} className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline">
                  <Plus className="w-3.5 h-3.5" /> Add condition
                </button>
              </div>
            </div>

            <div className="flex items-end gap-3 flex-wrap pt-1 border-t border-slate-100">
              <div className="pt-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Tag</p>
                <input className={inp} placeholder="e.g. leads" value={tagFilter} onChange={e => setTagFilter(e.target.value)} />
              </div>
              <div className="pt-3">
                <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Status</p>
                <select className={inp} value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}>
                  <option value="all">All</option>
                  <option value="active">Active</option>
                  <option value="optedout">Opted out</option>
                </select>
              </div>
              <div className="flex-1" />
              <button onClick={() => setApplied(adv)} className="px-5 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">Apply</button>
              <button onClick={() => { setAdv(EMPTY_ADV); setApplied(EMPTY_ADV); setTagFilter(""); setStatusFilter("all"); }}
                className="px-3 py-2 text-sm font-semibold text-slate-400 hover:text-red-500">Clear All</button>
            </div>
          </div>
        );
      })()}

      {showAdd && (
        <div className="bg-white rounded-card border border-line p-4 flex items-end gap-2 flex-wrap">
          <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Mobile *</p><input className={inp} placeholder="919876543210" value={addPhone} onChange={e => setAddPhone(e.target.value)} /></div>
          <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Name</p><input className={inp} placeholder="Asha Verma" value={addName} onChange={e => setAddName(e.target.value)} /></div>
          <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Tags</p><input className={inp} placeholder="leads; webinar-june" value={addTags} onChange={e => setAddTags(e.target.value)} /></div>
          <button onClick={addContact} disabled={importing} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
          </button>
        </div>
      )}

      {showImport && (
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-[11px] font-bold text-slate-400 uppercase">Bulk import — upload a CSV, columns are mapped automatically</p>
          {!csvPreview ? (
            <>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-card py-8 cursor-pointer hover:border-brand-dark/50 hover:bg-slate-50"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onCsvFile(f); }}>
                <UploadCloud className="w-8 h-8 text-slate-300" />
                <span className="text-sm font-semibold text-slate-500">Drop your CSV here or click to browse</span>
                <span className="text-[11px] text-slate-400">We auto-detect phone, name, email & tags columns — every other column becomes a contact attribute</span>
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onCsvFile(f); e.target.value = ""; }} />
              </label>
              <p className="text-[11px] text-slate-400">Duplicates (by phone) are skipped. Tags inside a cell can be separated by <code className="bg-slate-100 px-1 rounded">;</code></p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-brand-dark">{csvPreview.fileName} — {csvPreview.rows.length.toLocaleString()} contacts ready{csvPreview.skipped > 0 ? `, ${csvPreview.skipped} rows skipped (no valid phone)` : ""}</p>
                <button onClick={() => setCsvPreview(null)} className="p-1.5 text-slate-400 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {csvPreview.mapping.map(m => <span key={m} className="px-2 py-0.5 rounded-full bg-brand-green/10 text-brand-dark text-[11px] font-semibold">{m}</span>)}
              </div>
              <div className="border border-slate-100 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-400 text-left"><tr><th className="px-3 py-1.5">Phone</th><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Tags</th><th className="px-3 py-1.5">Attributes</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {csvPreview.rows.slice(0, 3).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-mono">{r.phone}</td>
                        <td className="px-3 py-1.5">{r.name || "—"}</td>
                        <td className="px-3 py-1.5">{r.tags?.join(", ") || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-400">{r.attributes ? Object.entries(r.attributes).map(([k, v]) => `${k}: ${v}`).join(" · ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="mb-3 flex items-start gap-2.5 rounded-lg border border-line bg-canvas p-3 text-xs text-ink-600">
                <input type="checkbox" checked={importConsent} onChange={e => setImportConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-700" />
                <span>These contacts <b className="text-brand-dark">opted in</b> to receive WhatsApp messages from us. Required to include them in broadcasts — sending to non-opted-in numbers is the top cause of Meta number bans. Leave unchecked to import them for 1:1 chats only.</span>
              </label>
              <button onClick={() => importRows(csvPreview.rows, importConsent)} disabled={importing} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Import {csvPreview.rows.length.toLocaleString()} contacts
              </button>
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-xs text-slate-500">{msg}</p>}

      <div className="bg-white rounded-card border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="pl-4 pr-2 py-2.5 w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-brand-dark" /></th>
              <th className="px-3 py-2.5 font-semibold">Name</th>
              <th className="px-3 py-2.5 font-semibold">Mobile Number</th>
              <th className="px-3 py-2.5 font-semibold">Tags</th>
              <th className="px-3 py-2.5 font-semibold">Source</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map(c => (
              <tr key={c.id} className={`hover:bg-slate-50 ${selected.has(c.id) ? "bg-brand-green/5" : ""}`}>
                <td className="pl-4 pr-2 py-2.5"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="accent-brand-dark" /></td>
                <td className="px-3 py-2.5 font-semibold text-brand-dark cursor-pointer hover:underline" onClick={() => setProfilePhone(c.phone)}>{c.name || "—"}</td>
                <td className="px-3 py-2.5 font-mono text-xs cursor-pointer" onClick={() => setProfilePhone(c.phone)}>{c.phone}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 flex-wrap">
                    {c.tags.slice(0, 3).map(t => <span key={t} className="px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 text-[11px] font-semibold">{t}</span>)}
                    {c.tags.length > 3 && <span className="text-[11px] text-slate-400">+{c.tags.length - 3}</span>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500 uppercase">{c.source ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${c.status === "active" ? "bg-brand-green/15 text-brand-dark" : "bg-red-100 text-red-600"}`}>{c.status === "active" ? "Active" : "Opted out"}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">{contacts.length === 0 ? "No contacts yet — Add Contact or Import a list." : "Nothing matches this filter."}</td></tr>}
          </tbody>
        </table>
        {profilePhone && <ContactProfile phone={profilePhone} onClose={() => setProfilePhone(null)} onChanged={load} goTo={goTo} />}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
          <span>{total === 0 ? "0" : `${offset + 1}–${Math.min(offset + perPage, total)}`} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-3">
            <select className="border border-slate-300 rounded-lg px-2 py-1 text-xs" value={perPage} onChange={e => setPerPage(Number(e.target.value))}>
              {[25, 50, 100].map(n => <option key={n} value={n}>{n} per page</option>)}
            </select>
            <button onClick={() => setOffset(o => Math.max(0, o - perPage))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <span className="font-semibold">{page}/{lastPage}</span>
            <button onClick={() => setOffset(o => o + perPage)} disabled={page >= lastPage} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Campaign history + detail dashboard (funnel, clicks, replies) ─────────────
type Funnel = { total: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
type DayPoint = { date: string; sent: number; delivered: number; read: number; clicked: number };
type CampaignStats = {
  funnel: Funnel; clicked: number; replied: number; perDay: DayPoint[];
  info: { name: string; templateName: string; sentOn: string; status: string; totalRecipients: number; ctaUrl: string | null; clickTracking: boolean };
};

function Donut({ pct, label }: { pct: number; label: string }) {
  const r = 42, c = 2 * Math.PI * r;
  return (
    <div className="relative w-32 h-32">
      <svg viewBox="0 0 110 110" className="w-32 h-32 -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle cx="55" cy="55" r={r} fill="none" stroke="#0553ad" strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${(Math.min(100, Math.max(0, pct)) / 100) * c} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-extrabold text-brand-dark">{Math.round(pct)}%</span>
        <span className="text-[10px] text-slate-400 font-semibold">{label}</span>
      </div>
    </div>
  );
}

// Per-day area chart (pure SVG — clicked area + read line, AiSensy-style).
function PerDayChart({ days }: { days: DayPoint[] }) {
  if (days.length === 0) return <p className="text-sm text-slate-400 py-10 text-center">No daily activity logged yet.</p>;
  const W = 600, H = 190, PX = 36, PB = 26, PT = 12;
  const maxY = Math.max(1, ...days.map(d => Math.max(d.clicked, d.read, d.delivered)));
  const x = (i: number) => PX + (days.length === 1 ? (W - PX - 8) / 2 : (i * (W - PX - 8)) / (days.length - 1));
  const y = (v: number) => PT + (H - PB - PT) * (1 - v / maxY);
  const path = (key: keyof DayPoint) => days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key] as number).toFixed(1)}`).join(" ");
  const area = `${path("clicked")} L${x(days.length - 1).toFixed(1)},${H - PB} L${x(0).toFixed(1)},${H - PB} Z`;
  const gridY = [0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {gridY.map(g => (
          <g key={g}>
            <line x1={PX} x2={W - 8} y1={y(maxY * g)} y2={y(maxY * g)} stroke="#e2e8f0" strokeDasharray="3 3" />
            <text x={PX - 5} y={y(maxY * g) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{Math.round(maxY * g)}</text>
          </g>
        ))}
        <path d={area} fill="#0553ad" opacity="0.25" />
        <path d={path("clicked")} fill="none" stroke="#0553ad" strokeWidth="2" />
        <path d={path("read")} fill="none" stroke="#0783fd" strokeWidth="1.5" strokeDasharray="4 3" />
        {days.map((d, i) => i % labelEvery === 0 ? (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">
            {new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </text>
        ) : null)}
      </svg>
      <div className="flex justify-center gap-5 text-[11px] text-slate-500 mt-1">
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-brand-700 inline-block" /> clicked</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-brand-500 inline-block" /> read</span>
      </div>
    </div>
  );
}

function CampaignsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [campaigns, setCampaigns] = useState<{ id: string; templateName: string; status: string; totalRecipients: number; sentCount: number; failedCount: number; createdAt: string }[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [retargeting, setRetargeting] = useState(false);
  useEffect(() => { fetch("/api/admin/campaigns").then(r => r.json()).then(d => setCampaigns(d.campaigns ?? [])).catch(() => {}); }, []);

  function openDetail(id: string) {
    setDetailId(id); setStats(null);
    fetch(`/api/admin/campaigns/${id}/funnel`).then(r => r.json()).then(d => { if (d.funnel) setStats(d as CampaignStats); }).catch(() => {});
  }

  // Pull the segment's recipients and jump to Broadcast prefilled (AiSensy-style retargeting).
  async function retarget(campaignId: string, segment: string, label: string) {
    setRetargeting(true);
    try {
      const d = await fetch(`/api/admin/campaigns/${campaignId}/funnel?segment=${segment}`).then(r => r.json());
      const recipients: { phone: string; fullName: string }[] = d.recipients ?? [];
      if (!recipients.length) { alert(`No recipients in "${label}".`); return; }
      sessionStorage.setItem("wa_retarget", JSON.stringify({ note: `Retarget: ${label} (${recipients.length} recipients)`, recipients }));
      goTo("broadcast");
    } finally { setRetargeting(false); }
  }

  // ── Detail view ──
  if (detailId) {
    const f = stats?.funnel;
    const total = f?.total ?? 0;
    const cumSent = f ? f.sent + f.delivered + f.read : 0;       // status column is exclusive → cumulative for display
    const cumDelivered = f ? f.delivered + f.read : 0;
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    const tiles: { label: string; n: number; pct: number; icon: React.ReactNode; hot?: boolean }[] = f ? [
      { label: "Overview", n: total, pct: 100, icon: <BarChart3 className="w-3.5 h-3.5" /> },
      { label: "Sent", n: cumSent, pct: pct(cumSent), icon: <Check className="w-3.5 h-3.5" /> },
      { label: "Delivered", n: cumDelivered, pct: pct(cumDelivered), icon: <CircleCheck className="w-3.5 h-3.5" /> },
      { label: "Read", n: f.read, pct: pct(f.read), icon: <MessageSquare className="w-3.5 h-3.5" /> },
      { label: "Clicked", n: stats!.clicked, pct: pct(stats!.clicked), icon: <MousePointerClick className="w-3.5 h-3.5" />, hot: true },
      { label: "Replied", n: stats!.replied, pct: pct(stats!.replied), icon: <Reply className="w-3.5 h-3.5" /> },
      { label: "Failed", n: f.failed, pct: pct(f.failed), icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    ] : [];
    const SEGMENTS: { label: string; segment: string; n: number }[] = f ? [
      { label: "Read, not replied", segment: "read", n: f.read },
      { label: "Delivered, not read", segment: "delivered_not_read", n: f.delivered },
      { label: "Sent, no receipt", segment: "sent_not_delivered", n: f.sent },
      { label: "Failed", segment: "failed", n: f.failed },
    ] : [];
    return (
      <div className="max-w-4xl space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setDetailId(null)} className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft className="w-5 h-5 text-slate-500" /></button>
          <h2 className="text-xl font-extrabold text-brand-dark uppercase tracking-wide">{stats?.info.name ?? "Campaign"}</h2>
        </div>

        {!stats ? <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-300" /></div> : (
          <>
            <div className="bg-white rounded-card border border-line px-2 py-3 flex flex-wrap">
              {tiles.map(t => (
                <div key={t.label} className={`px-4 py-1.5 text-center border-b-2 ${t.hot ? "border-brand-700 bg-brand-50 rounded-t-lg" : "border-transparent"}`}>
                  <p className="text-sm font-extrabold text-brand-dark">{t.pct}% <span className="font-normal text-slate-400 text-xs">({t.n.toLocaleString()})</span></p>
                  <p className={`text-[11px] font-semibold flex items-center justify-center gap-1 ${t.hot ? "text-brand-700" : "text-slate-400"}`}>{t.icon}{t.label}</p>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-[1fr_200px] gap-5">
              <div className="bg-white rounded-card border border-line p-5 grid grid-cols-2 gap-x-6 gap-y-4">
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Campaign name</p><p className="text-sm font-semibold text-brand-dark font-mono">{stats.info.templateName}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Sent on</p><p className="text-sm font-semibold text-brand-dark">{new Date(stats.info.sentOn).toLocaleString()}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">CTA (URL)</p><p className="text-sm font-semibold text-brand-dark truncate">{stats.info.ctaUrl ?? "—"}</p></div>
                <div><p className="text-[10px] font-bold text-slate-400 uppercase">Recipients</p><p className="text-sm font-semibold text-brand-dark">{stats.info.totalRecipients.toLocaleString()} · {stats.info.status}</p></div>
                {!stats.info.clickTracking && <p className="col-span-2 text-[11px] text-slate-400">Click data appears for templates submitted with click tracking enabled.</p>}
              </div>
              <div className="bg-white rounded-card border border-line p-4 flex items-center justify-center">
                <Donut pct={total ? (stats.clicked / total) * 100 : 0} label="clicked" />
              </div>
            </div>

            <div className="bg-white rounded-card border border-line p-5">
              <p className="text-sm font-extrabold text-brand-dark mb-3">Audience (per day)</p>
              <PerDayChart days={stats.perDay} />
            </div>

            <div className="bg-white rounded-card border border-line p-5 space-y-2">
              <p className="text-sm font-extrabold text-brand-dark">Smart retargeting</p>
              {SEGMENTS.map(s => (
                <div key={s.segment} className="flex items-center gap-3 text-xs">
                  <span className="w-40 shrink-0 text-slate-500 font-medium">{s.label}</span>
                  <span className="w-12 font-bold text-slate-600">{s.n}</span>
                  {s.n > 0 && (
                    <button disabled={retargeting} onClick={() => retarget(detailId, s.segment, s.label.toLowerCase())}
                      className="px-2 py-0.5 rounded-full border border-brand-dark text-brand-dark font-bold hover:bg-brand-600 hover:text-white">
                      Retarget →
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List view ──
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Campaign history</h2>
        <p className="text-sm text-slate-500">Click a campaign for its full dashboard — delivery funnel, clicks, replies, and behavioral retargeting.</p>
      </div>
      <div className="space-y-2">
        {campaigns.map(c => (
          <button key={c.id} onClick={() => openDetail(c.id)} className="w-full bg-white rounded-card border border-line p-4 flex items-center justify-between text-left hover:border-brand-dark/40">
            <div><p className="font-mono text-sm font-semibold text-brand-dark">{c.templateName}</p><p className="text-[11px] text-slate-400">{new Date(c.createdAt).toLocaleString()}</p></div>
            <div className="text-right text-xs text-slate-600 flex items-center gap-3">
              <div><span className="px-2 py-0.5 rounded-full bg-slate-100 font-semibold">{c.status}</span><p className="mt-1">{c.sentCount}/{c.totalRecipients} sent{c.failedCount ? ` · ${c.failedCount} failed` : ""}</p></div>
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </div>
          </button>
        ))}
        {campaigns.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No campaigns yet.</p>}
      </div>
    </div>
  );
}

// ── Automations ────────────────────────────────────────────────────────────────
// ── API broadcasting: portal-defined rules for externally-fired events ────────
type UiCond = { source: "payload" | "contact_attr" | "contact_tag" | "contact_field"; key: string; op: "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt"; value: string };
type UiRule = {
  id?: string; campaignId?: string | null; name: string; active: boolean; eventKey: string;
  conditions: UiCond[]; templateName: string; languageCode: string; variables: string[];
  headerImageUrl: string | null; delayValue: number; delayUnit: string;
  windowStartHour: number | null; windowEndHour: number | null; frequencyCapHours: number;
  channelId: string | null;
};
const NEW_RULE: UiRule = {
  name: "", active: true, eventKey: "", conditions: [], templateName: "", languageCode: "en_US",
  variables: [], headerImageUrl: null, delayValue: 0, delayUnit: "minutes",
  windowStartHour: null, windowEndHour: null, frequencyCapHours: 0, channelId: null,
};
const COND_SOURCES: { v: UiCond["source"]; label: string }[] = [
  { v: "payload", label: "Event data" },
  { v: "contact_attr", label: "Contact attribute" },
  { v: "contact_tag", label: "Contact tag" },
  { v: "contact_field", label: "Contact field" },
];
const COND_OPS: { v: UiCond["op"]; label: string }[] = [
  { v: "equals", label: "is" }, { v: "not_equals", label: "is not" }, { v: "contains", label: "contains" },
  { v: "exists", label: "exists" }, { v: "gt", label: ">" }, { v: "lt", label: "<" },
];

function ApiBroadcasting() {
  const [rules, setRules] = useState<UiRule[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ name: string; status: string; language: string }[]>([]);
  const [editing, setEditing] = useState<UiRule | null>(null);
  const [varsText, setVarsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Dry-run tester
  const [tEvent, setTEvent] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tData, setTData] = useState("{\n  \"course\": \"Data Science\"\n}");
  const [tBusy, setTBusy] = useState(false);
  const [tResults, setTResults] = useState<{ rule: string; outcome: string; detail?: string; sendAfter?: string; variables?: string[] }[] | null>(null);
  const [tErr, setTErr] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = useCallback(() => {
    fetch("/api/admin/api-rules").then(r => r.json()).then(d => { setRules(d.rules ?? []); setNotice(d.notice ?? null); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/templates").then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {}); }, []);

  function openEdit(r?: UiRule) {
    const rule = r ?? NEW_RULE;
    setEditing({ ...rule, conditions: rule.conditions.map(c => ({ ...c })) });
    setVarsText((r?.variables ?? []).join("\n"));
    setMsg(null);
  }
  const setEd = (patch: Partial<UiRule>) => setEditing(e => (e ? { ...e, ...patch } : e));
  const setCond = (i: number, patch: Partial<UiCond>) => setEditing(e => (e ? { ...e, conditions: e.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : e));

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.eventKey.trim() || !editing.templateName.trim()) { setMsg("Name, event key and template are required."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/api-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, eventKey: editing.eventKey.trim(), variables: varsText.split(/\r?\n/).map(v => v.trim()).filter(Boolean) }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setEditing(null); load(); }
    } finally { setSaving(false); }
  }
  async function toggleRule(r: UiRule) {
    await fetch("/api/admin/api-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, active: !r.active }) });
    load();
  }
  async function removeRule(id: string) {
    if (!confirm("Delete this rule? Already-queued sends are cancelled.")) return;
    await fetch("/api/admin/api-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function dryRun() {
    setTErr(null); setTResults(null);
    if (!tEvent.trim() || !tPhone.trim()) { setTErr("Event name and phone are required."); return; }
    let data: Record<string, unknown> = {};
    if (tData.trim()) { try { data = JSON.parse(tData); } catch { setTErr("Test data is not valid JSON."); return; } }
    setTBusy(true);
    try {
      const res = await fetch("/api/admin/api-rules/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: tEvent.trim(), phone: tPhone.trim(), data }) });
      const d = await res.json();
      if (!res.ok) setTErr(d.error || "Test failed"); else setTResults(d.results ?? []);
    } finally { setTBusy(false); }
  }

  const curl = `curl -X POST ${origin}/api/events \\
  -H "Authorization: Bearer $BROADCAST_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"demo_booked","phone":"919876543210","name":"Asha","data":{"course":"Data Science","slot":"7 PM"}}'`;

  const hourOpts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">API broadcasting</h2>
          <p className="text-sm text-slate-500">Your systems fire one event — the rules you define here decide what gets sent, to whom, and when.</p>
        </div>
        <button onClick={() => openEdit()} className="shrink-0 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> New rule</button>
      </div>

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{notice} — apply migration <code className="font-mono">0012_api_rules.sql</code> in Supabase.</div>}

      <section className="bg-slate-900 rounded-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Endpoint — fire from your backend, CRM, or website</p>
          <button onClick={() => { navigator.clipboard.writeText(curl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="px-2.5 py-1 rounded-lg bg-white/10 text-white text-[11px] font-bold flex items-center gap-1.5 hover:bg-white/20">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? "Copied" : "Copy cURL"}
          </button>
        </div>
        <pre className="text-[11px] leading-relaxed text-brand-500 font-mono overflow-x-auto whitespace-pre">{curl}</pre>
        <p className="text-[11px] text-slate-400">
          Auth: <code className="text-slate-300">Bearer BROADCAST_API_KEY</code> (env). Everything inside <code className="text-slate-300">data</code> is available to rule conditions and template variables as <code className="text-slate-300">{"{{payload.field}}"}</code>.
        </p>
      </section>

      {editing && (
        <section className="bg-white rounded-card border-2 border-brand-dark/30 p-5 space-y-4">
          <p className="text-xs font-bold text-slate-400 uppercase">{editing.id ? "Edit rule" : "New rule"}</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Rule name, e.g. Demo booked → confirmation" value={editing.name} onChange={e => setEd({ name: e.target.value })} />
            <input className={inp} placeholder="event key, e.g. demo_booked" value={editing.eventKey} onChange={e => setEd({ eventKey: e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_") })} />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase">Conditions <span className="font-normal normal-case">— all must pass (leave empty to always fire)</span></p>
            {editing.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className={`${inp} w-40`} value={c.source} onChange={e => setCond(i, { source: e.target.value as UiCond["source"] })}>
                  {COND_SOURCES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
                <input className={`${inp} w-40`} placeholder={c.source === "payload" ? "field, e.g. course" : c.source === "contact_tag" ? "tag name" : c.source === "contact_field" ? "name | email | source" : "attribute key"} value={c.key} onChange={e => setCond(i, { key: e.target.value })} />
                <select className={`${inp} w-28`} value={c.op} onChange={e => setCond(i, { op: e.target.value as UiCond["op"] })}>
                  {COND_OPS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                {c.op !== "exists" && <input className={`${inp} flex-1`} placeholder="value" value={c.value} onChange={e => setCond(i, { value: e.target.value })} />}
                <button onClick={() => setEditing(e => (e ? { ...e, conditions: e.conditions.filter((_, j) => j !== i) } : e))} className="p-1 text-slate-300 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
            <button onClick={() => setEditing(e => (e ? { ...e, conditions: [...e.conditions, { source: "payload", key: "", op: "equals", value: "" }] } : e))}
              className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add condition</button>
          </div>

          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Template</p>
              <input className={`${inp} w-full`} list="rule-tpls" placeholder="approved template name" value={editing.templateName} onChange={e => setEd({ templateName: e.target.value })} />
              <datalist id="rule-tpls">{templates.filter(t => t.status === "APPROVED").map(t => <option key={`${t.name}-${t.language}`} value={t.name} />)}</datalist>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Language</p>
              <input className={`${inp} w-full`} value={editing.languageCode} onChange={e => setEd({ languageCode: e.target.value })} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Template variables <span className="font-normal normal-case">— one per line, in {"{{1}}, {{2}}"} order</span></p>
            <textarea className={`${inp} w-full font-mono`} rows={3} placeholder={"{{contact.name}}\n{{payload.course}}\n{{payload.slot}}"} value={varsText} onChange={e => setVarsText(e.target.value)} />
            <p className="text-[11px] text-slate-400 mt-1">Tokens: <code className="bg-slate-100 px-1 rounded">{"{{payload.x}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{contact.name}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{contact.attr.key}}"}</code> — or plain literal text.</p>
          </div>

          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Delay</p>
              <div className="flex gap-1.5">
                <input type="number" min={0} className={`${inp} w-20`} value={editing.delayValue} onChange={e => setEd({ delayValue: parseInt(e.target.value || "0", 10) })} />
                <select className={inp} value={editing.delayUnit} onChange={e => setEd({ delayUnit: e.target.value })}>
                  <option value="minutes">min</option><option value="hours">hours</option><option value="days">days</option>
                </select>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Send window (IST)</p>
              <div className="flex gap-1.5 items-center">
                <select className={inp} value={editing.windowStartHour ?? ""} onChange={e => setEd({ windowStartHour: e.target.value === "" ? null : parseInt(e.target.value, 10) })}>
                  <option value="">anytime</option>
                  {hourOpts(0, 23).map(h => <option key={h} value={h}>{h}:00</option>)}
                </select>
                <span className="text-xs text-slate-400">to</span>
                <select className={inp} value={editing.windowEndHour ?? ""} onChange={e => setEd({ windowEndHour: e.target.value === "" ? null : parseInt(e.target.value, 10) })}>
                  <option value="">—</option>
                  {hourOpts(1, 24).map(h => <option key={h} value={h}>{h}:00</option>)}
                </select>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Frequency cap</p>
              <div className="flex gap-1.5 items-center">
                <input type="number" min={0} className={`${inp} w-20`} value={editing.frequencyCapHours} onChange={e => setEd({ frequencyCapHours: parseInt(e.target.value || "0", 10) })} />
                <span className="text-xs text-slate-400">hours (0 = off)</span>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Send from</p>
              <ChannelSelect value={editing.channelId} onChange={v => setEd({ channelId: v })} allLabel="Default number" />
            </div>
            <div className="flex-1" />
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save rule
              </button>
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm font-semibold text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </section>
      )}

      <div className="space-y-2">
        {rules.map(r => (
          <div key={r.id} className={`bg-white rounded-card border p-4 flex items-center gap-4 ${r.active ? "border-line" : "border-slate-100 opacity-60"}`}>
            <button onClick={() => toggleRule(r)} title={r.active ? "Deactivate" : "Activate"}
              className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${r.active ? "bg-brand-green" : "bg-slate-200"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${r.active ? "left-4.5 right-0.5" : "left-0.5"}`} style={{ left: r.active ? "1.125rem" : "0.125rem" }} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-brand-dark truncate">{r.name}</p>
              <p className="text-[11px] text-slate-400 truncate">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-slate-500">{r.eventKey}</span>
                {" → "}<span className="font-mono">{r.templateName}</span>
                {r.conditions.length > 0 && ` · ${r.conditions.length} condition${r.conditions.length > 1 ? "s" : ""}`}
                {r.delayValue > 0 && ` · after ${r.delayValue} ${r.delayUnit}`}
                {r.windowStartHour !== null && r.windowEndHour !== null && ` · ${r.windowStartHour}:00–${r.windowEndHour}:00 IST`}
                {r.frequencyCapHours > 0 && ` · max 1/${r.frequencyCapHours}h`}
              </p>
            </div>
            <button onClick={() => openEdit(r)} className="px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-slate-500 hover:bg-slate-50 shrink-0">Edit</button>
            <button onClick={() => removeRule(r.id!)} className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {rules.length === 0 && !notice && <p className="text-center text-slate-400 text-sm py-6">No rules yet — create one above, then fire the event from your system.</p>}
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Test an event (dry run — nothing is sent or queued)</p>
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="event, e.g. demo_booked" value={tEvent} onChange={e => setTEvent(e.target.value)} />
          <input className={inp} placeholder="phone, e.g. 919876543210" value={tPhone} onChange={e => setTPhone(e.target.value)} />
        </div>
        <textarea className={`${inp} w-full font-mono`} rows={3} placeholder='{"course": "Data Science"}' value={tData} onChange={e => setTData(e.target.value)} />
        <button onClick={dryRun} disabled={tBusy} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
          {tBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Dry run
        </button>
        {tErr && <p className="text-xs text-red-500">{tErr}</p>}
        {tResults && (
          <div className="space-y-2">
            {tResults.length === 0 && <p className="text-xs text-slate-400">No active rules listen to this event.</p>}
            {tResults.map((r, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${r.outcome === "dry_run_match" ? "border-brand-100 bg-brand-50" : "border-amber-200 bg-amber-50"}`}>
                <p className="font-bold text-slate-700">{r.rule} — {r.outcome === "dry_run_match" ? "✓ would send" : `skipped (${r.detail})`}</p>
                {r.outcome === "dry_run_match" && (
                  <p className="text-slate-500 mt-0.5">
                    at {r.sendAfter ? new Date(r.sendAfter).toLocaleString() : "now"}
                    {r.variables?.length ? ` · variables: ${r.variables.map(v => `"${v}"`).join(", ")}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AutomationsTab() {
  const [list, setList] = useState<{ id: string; name: string | null; templateName: string; autoSendTrigger: string; triggerKey: string | null; delayValue: number; delayUnit: string }[]>([]);
  const [trigger, setTrigger] = useState("api_event");
  const [triggerKey, setTriggerKey] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [delayValue, setDelayValue] = useState(0);
  const [delayUnit, setDelayUnit] = useState("minutes");
  const [variables, setVariables] = useState("{name}");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => { fetch("/api/admin/automations").then(r => r.json()).then(d => setList(d.automations ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!templateName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger, triggerKey: triggerKey.trim() || null, templateName: templateName.trim(), variables: variables.split(/\r?\n/).map(v => v.trim()).filter(Boolean), delayValue, delayUnit }) });
      setTemplateName(""); setTriggerKey(""); load();
    } finally { setSaving(false); }
  }
  async function disable(id: string) { await fetch("/api/admin/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled: false }) }); load(); }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Auto-sends</h2>
        <p className="text-sm text-slate-500">Simple fixed-template triggers (welcome on contact added, legacy named events). For conditional sends with payload variables, windows and caps, use <b>API broadcasting</b>.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">New automation</p>
        <div className="grid grid-cols-2 gap-2">
          <select className={inp} value={trigger} onChange={e => setTrigger(e.target.value)}>
            <option value="contact_added">When a contact is added</option>
            <option value="api_event">On API event (named)</option>
          </select>
          <input className={inp} placeholder="event name (for api_event)" value={triggerKey} onChange={e => setTriggerKey(e.target.value)} disabled={trigger !== "api_event"} />
        </div>
        <input className={`${inp} w-full`} placeholder="approved template name" value={templateName} onChange={e => setTemplateName(e.target.value)} />
        <textarea className={`${inp} w-full font-mono`} rows={2} placeholder="{name}" value={variables} onChange={e => setVariables(e.target.value)} />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-slate-500">Delay</span>
          <input type="number" min={0} className={`${inp} w-20`} value={delayValue} onChange={e => setDelayValue(parseInt(e.target.value || "0", 10))} />
          <select className={inp} value={delayUnit} onChange={e => setDelayUnit(e.target.value)}><option value="minutes">min</option><option value="hours">hours</option><option value="days">days</option></select>
          <button onClick={add} disabled={saving} className="ml-auto px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save</button>
        </div>
      </section>

      <div className="space-y-2">
        {list.map(a => (
          <div key={a.id} className="bg-white rounded-card border border-line p-4 flex items-center justify-between">
            <div><p className="text-sm font-semibold text-brand-dark">{a.autoSendTrigger}{a.triggerKey ? ` · ${a.triggerKey}` : ""}</p><p className="text-[11px] text-slate-400 font-mono">{a.templateName} · after {a.delayValue} {a.delayUnit}</p></div>
            <button onClick={() => disable(a.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {list.length === 0 && <p className="text-center text-slate-400 text-sm py-6">No automations yet.</p>}
      </div>
    </div>
  );
}

// ── Opt-outs ────────────────────────────────────────────────────────────────────
function OptoutsTab() {
  const [list, setList] = useState<{ phone: string; reason: string | null; createdAt?: string }[]>([]);
  const [phone, setPhone] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(() => { fetch("/api/admin/optouts").then(r => r.json()).then(d => setList(d.optouts ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  async function add() { if (!phone.trim()) return; await fetch("/api/admin/optouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: phone.trim(), reason: "added by team" }) }); setPhone(""); load(); }
  async function remove(p: string) {
    if (!confirm(`Remove ${p} from the opt-out list? They will start receiving broadcasts again.`)) return;
    await fetch("/api/admin/optouts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: p }) });
    load();
  }
  const visible = list.filter(o => !search.trim() || o.phone.includes(search.replace(/\D/g, "")));
  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-xl space-y-4">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Opt-outs</h2>
        <p className="text-sm text-slate-500">Numbers that asked to stop hearing from you. Every broadcast, auto-send, and AI reply skips them automatically.</p>
      </div>
      <div className="flex gap-2">
        <input className={`${inp} flex-1`} placeholder="Number to suppress — e.g. 919876543210" value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} />
        <button onClick={add} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">Add</button>
      </div>
      {list.length > 5 && (
        <input className={`${inp} w-full`} placeholder="Search the list…" value={search} onChange={e => setSearch(e.target.value)} />
      )}
      <div className="bg-white rounded-card border border-line divide-y divide-slate-100">
        {visible.map(o => (
          <div key={o.phone} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-mono text-ink-900">{o.phone}</p>
              <p className="text-[11px] text-slate-400">
                {o.reason === "inbound STOP" ? "Replied STOP themselves" : o.reason || "Added manually"}
                {o.createdAt ? ` · ${new Date(o.createdAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <button onClick={() => remove(o.phone)} className="text-xs text-red-500 hover:underline shrink-0">Remove</button>
          </div>
        ))}
        {visible.length === 0 && <p className="text-center text-slate-400 text-sm py-6">{list.length === 0 ? "No opt-outs — when someone replies STOP they appear here automatically." : "No matches."}</p>}
      </div>
    </div>
    <OptoutsRail list={list} />
    </div>
  );
}

// Opt-outs: split by source + the compliance story in plain language.
function OptoutsRail({ list }: { list: { reason: string | null }[] }) {
  const viaStop = list.filter(o => o.reason === "inbound STOP").length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Suppression list">
        <StatRow label="Total opted out" value={list.length} />
        <StatRow label="Replied STOP themselves" value={viaStop} />
        <StatRow label="Added by your team" value={list.length - viaStop} />
      </RailCard>
      <RailCard title="How it works — automatic">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>A customer replying <b>STOP</b>, <b>UNSUBSCRIBE</b>, <b>CANCEL</b>, or <b>OPT OUT</b> is suppressed instantly and gets a confirmation.</li>
          <li>Every broadcast, auto-send, and AI reply <b>skips this list</b> — nothing for you to remember.</li>
          <li>Replying <b>START</b> opts them back in automatically, with a welcome-back message.</li>
          <li>Skipped sends show up in each campaign&apos;s funnel, so the numbers always add up.</li>
        </ul>
      </RailCard>
      <RailCard title="Why this protects your number">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Messaging people who said stop leads to <b>blocks and reports</b> — Meta lowers your number&apos;s quality rating and can shrink your daily sending limit.</li>
          <li>Honouring STOP keeps the <b>green quality rating</b> that unlocks higher messaging tiers.</li>
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Keep &quot;Reply STOP to opt out&quot; in template footers — it builds trust and avoids spam reports.</li>
          <li>Add a number manually when someone asks to stop via call or email.</li>
          <li>Only remove a number when the person clearly asked to hear from you again.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// ── Meta Ads: campaigns, insights, and CTWA lead attribution ──────────────────
type AdsData = {
  connected: boolean;
  accountId: string;
  pageId: string;
  account: { name: string; currency: string; status: number } | null;
  error: string | null;
  campaigns: { id: string; name: string; effectiveStatus: string; objective: string; dailyBudget: number | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }[];
  attribution: { adId: string; headline: string; contacts: number; leads: number }[];
  portalCampaignIds?: string[];
};
type AdDraftSummary = { id: string; name: string; updatedAt: string };
type AdsDrill = {
  adsets: { id: string; name: string; effectiveStatus: string; dailyBudget: number | null; optimizationGoal: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }[];
  ads: { id: string; name: string; effectiveStatus: string; thumbnailUrl: string | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }[];
};

function AdsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [data, setData] = useState<AdsData | null>(null);
  const [preset, setPreset] = useState<"today" | "last_7d" | "last_30d">("last_7d");
  const [accountInput, setAccountInput] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; value: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [building, setBuilding] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<{ id: string; data: Record<string, unknown> } | null>(null);
  const [drafts, setDrafts] = useState<AdDraftSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [detail, setDetail] = useState<{ level: "campaign" | "adset" | "ad"; id: string; name: string } | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { fetch("/api/admin/me").then(r => r.json()).then(d => setIsAdmin(d.user?.role !== "member")).catch(() => {}); }, []);

  const loadDrafts = useCallback(() => { fetch("/api/admin/meta/drafts").then(r => r.json()).then(d => setDrafts(d.drafts ?? [])).catch(() => {}); }, []);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  async function openDraft(id: string) {
    const d = await fetch(`/api/admin/meta/drafts?id=${id}`).then(r => r.json()).catch(() => null);
    if (d?.draft) { setResumeDraft({ id: d.draft.id, data: d.draft.data ?? {} }); setBuilding(true); }
  }
  async function deleteDraft(id: string) {
    await fetch(`/api/admin/meta/drafts?id=${id}`, { method: "DELETE" }).catch(() => {});
    loadDrafts();
  }
  function newAd() { setResumeDraft(null); setBuilding(true); }

  const load = useCallback(() => {
    fetch(`/api/admin/meta?preset=${preset}`).then(r => r.json()).then(d => { setData(d); setBlocked(false); }).catch(() => setBlocked(true));
  }, [preset]);
  useEffect(() => { load(); }, [load]);

  async function connect() {
    if (!accountInput.trim()) return;
    setBusy("connect"); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: accountInput.trim() }) }).then(r => r.json());
      if (d.error && !d.success) setMsg(d.error);
      else if (!d.connected) setMsg(`Account saved — but Meta says: "${d.error}". Finish steps 2 and 3 below, then hit Retry.`);
      setAccountInput("");
      load();
    } catch { setBlocked(true); }
    finally { setBusy(""); }
  }

  async function act(campaignId: string, action: "pause" | "resume" | "budget" | "duplicate", dailyBudget?: number) {
    setBusy(campaignId); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, action, dailyBudget }) }).then(r => r.json());
      if (d.error) setMsg(d.error); else load();
    } finally { setBusy(""); setBudgetEdit(null); }
  }

  const cur = data?.account?.currency ?? "";
  const money = (n: number) => `${cur === "INR" ? "₹" : cur ? cur + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const timeAgo = (iso: string) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const totals = (data?.campaigns ?? []).reduce(
    (t, c) => ({ spend: t.spend + c.spend, impressions: t.impressions + c.impressions, clicks: t.clicks + c.clicks, conversations: t.conversations + c.conversations }),
    { spend: 0, impressions: 0, clicks: 0, conversations: 0 },
  );
  const leadsTotal = (data?.attribution ?? []).reduce((n, a) => n + a.leads, 0);
  const statusPill = (s: string) =>
    s === "ACTIVE" ? "bg-brand-100 text-brand-700" : s === "PAUSED" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700";

  const campaignCard = (c: AdsData["campaigns"][number]) => (
    <div key={c.id} className="bg-white rounded-card border border-line p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-900 truncate">{c.name}</p>
          <p className="text-[11px] text-slate-400">{c.objective.toLowerCase().replace(/_/g, " ")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${statusPill(c.effectiveStatus)}`}>{c.effectiveStatus}</span>
          {isAdmin && (c.effectiveStatus === "ACTIVE"
            ? <button disabled={busy === c.id} onClick={() => act(c.id, "pause")} className="px-3 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas disabled:opacity-50">Pause</button>
            : c.effectiveStatus === "PAUSED" && <button disabled={busy === c.id} onClick={() => act(c.id, "resume")} className="px-3 py-1 rounded-lg bg-brand-700 text-white text-[11px] font-bold disabled:opacity-50">Resume</button>)}
          {isAdmin && <button disabled={busy === c.id} title="Duplicate (copy created paused)" onClick={() => { if (confirm(`Duplicate "${c.name}"? The copy is created PAUSED.`)) act(c.id, "duplicate"); }} className="px-2 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas disabled:opacity-50"><Copy className="w-3 h-3" /></button>}
          <button onClick={() => setDetail({ level: "campaign", id: c.id, name: c.name })} className="px-3 py-1 rounded-lg bg-ink-950 text-white text-[11px] font-bold">Open</button>
        </div>
      </div>
      <button onClick={() => setDetail({ level: "campaign", id: c.id, name: c.name })} className="w-full grid grid-cols-4 gap-2 text-center">
        {[
          ["Spend", money(c.spend)], ["CPC", c.cpc ? money(c.cpc) : "—"],
          ["CTR", c.ctr ? `${Number(c.ctr).toFixed(2)}%` : "—"], ["Chats", c.conversations.toLocaleString()],
        ].map(([l, v]) => (
          <div key={l} className="bg-canvas rounded-control py-1.5 hover:bg-brand-50">
            <p className="text-sm font-bold text-ink-900">{v}</p>
            <p className="text-[10px] text-slate-400 font-semibold">{l}</p>
          </div>
        ))}
      </button>
      {isAdmin && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          Daily budget:
          {budgetEdit?.id === c.id ? (
            <>
              <input className="border border-line rounded-control px-2 py-1 w-24 text-xs" autoFocus value={budgetEdit.value} onChange={e => setBudgetEdit({ id: c.id, value: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter" && Number(budgetEdit.value) > 0) act(c.id, "budget", Number(budgetEdit.value)); if (e.key === "Escape") setBudgetEdit(null); }} />
              <button disabled={busy === c.id || !(Number(budgetEdit.value) > 0)} onClick={() => act(c.id, "budget", Number(budgetEdit.value))} className="font-bold text-brand-700 disabled:opacity-50">Save</button>
              <button onClick={() => setBudgetEdit(null)} className="text-slate-400 font-bold">cancel</button>
            </>
          ) : (
            <>
              <b className="text-ink-900">{c.dailyBudget != null ? `${money(c.dailyBudget)}/day` : "set at ad-set level"}</b>
              {c.dailyBudget != null && <button onClick={() => setBudgetEdit({ id: c.id, value: String(c.dailyBudget) })} className="font-bold text-brand-700 hover:underline">change</button>}
            </>
          )}
        </div>
      )}
    </div>
  );

  // ── Request blocked client-side (almost always an ad blocker) ──
  if (blocked) {
    return (
      <div className="max-w-2xl space-y-4">
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> Meta Ads</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-card px-5 py-4 text-sm text-amber-900 space-y-2">
          <p className="font-bold">An ad blocker is blocking this page.</p>
          <p>Your browser extension (uBlock Origin, AdBlock, Brave Shields, Privacy Badger, etc.) is blocking the request because the address contains advertising-related words. This is a browser issue, not a problem with the platform — every other tab works.</p>
          <p className="font-semibold">To fix it, do one of these:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click your ad-blocker icon → <b>pause / disable on waba.analytixlabs.co.in</b>, then reload.</li>
            <li>Or open this page in an <b>Incognito window</b> with extensions off.</li>
          </ul>
          <button onClick={() => { setBlocked(false); load(); }} className="mt-1 px-4 py-2 rounded-control bg-amber-600 text-white text-xs font-bold">I&apos;ve disabled it — retry</button>
        </div>
      </div>
    );
  }

  // ── Not connected: friendly 3-step wizard ──
  if (data && (!data.accountId || !data.connected)) {
    return (
      <div className="max-w-2xl space-y-5">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> Meta Ads</h2>
          <p className="text-sm text-slate-500">Run and monitor your Facebook &amp; Instagram ads right here — and see exactly which ad brings WhatsApp leads, not just clicks.</p>
        </div>

        {data.accountId && !data.connected && (
          <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">
            Account <b>act_{data.accountId}</b> is saved, but Meta replied: <i>{data.error ?? "unknown error"}</i>.
            {" "}Usually this means step 2 or 3 below isn&apos;t done yet — or Meta is having an outage.
            <button onClick={load} className="ml-2 font-bold underline">Retry</button>
          </div>
        )}
        {msg && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">{msg}</div>}

        <section className="bg-white rounded-card border border-line p-5 space-y-4">
          <p className="text-xs font-bold text-slate-400 uppercase">Connect your ad account — 3 steps, one time</p>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-brand-700 text-white text-xs font-bold flex items-center justify-center shrink-0">1</div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-semibold text-ink-900">Paste your ad account ID</p>
              <p className="text-xs text-slate-500">Open <b>adsmanager.facebook.com</b> — the ID is the number after <code className="bg-canvas px-1 rounded">act=</code> in the address bar.</p>
              <div className="flex gap-2">
                <input className={`${inp} flex-1`} placeholder="e.g. 1234567890" value={accountInput} onChange={e => setAccountInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") connect(); }} />
                <button onClick={connect} disabled={busy === "connect" || !accountInput.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">
                  {busy === "connect" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect"}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-canvas text-ink-600 text-xs font-bold flex items-center justify-center shrink-0">2</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">Give the system user access to the ad account</p>
              <p className="text-xs text-slate-500">Business settings → Users → System users → <b>whatsapp-api</b> → Assign assets → <b>Ad accounts</b> → pick your account → Full control.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-canvas text-ink-600 text-xs font-bold flex items-center justify-center shrink-0">3</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">Add ads permissions to the token</p>
              <p className="text-xs text-slate-500">Generate a new token for <b>whatsapp-api</b> with <code className="bg-canvas px-1 rounded">ads_read</code> + <code className="bg-canvas px-1 rounded">ads_management</code> added to the existing WhatsApp scopes, then update <code className="bg-canvas px-1 rounded">META_WA_ACCESS_TOKEN</code> in Vercel and redeploy.</p>
            </div>
          </div>
        </section>

        <p className="text-xs text-slate-400">Reading insights can&apos;t break anything — your WhatsApp setup keeps working exactly as is. Campaign controls (pause/budget) are admin-only.</p>
      </div>
    );
  }

  // ── Full-page ad builder (replaces the dashboard while creating) ──
  if (building) {
    return <CreateAdBuilder currency={cur} hasPage={!!data?.pageId}
      draftId={resumeDraft?.id ?? null} draftData={resumeDraft?.data ?? null}
      onClose={() => { setBuilding(false); loadDrafts(); }}
      onCreated={() => { setBuilding(false); setData(null); load(); loadDrafts(); }} />;
  }

  // ── Connected dashboard ──
  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> Meta Ads</h2>
          {data?.account && <p className="text-sm text-slate-500">{data.account.name} · {data.account.currency} · {data.account.status === 1 ? <span className="text-brand-700 font-semibold">● active</span> : <span className="text-amber-600 font-semibold">status {data.account.status}</span>}</p>}
        </div>
        <div className="flex gap-2 items-center">
          {([["today", "Today"], ["last_7d", "7 days"], ["last_30d", "30 days"]] as ["today" | "last_7d" | "last_30d", string][]).map(([k, label]) => (
            <button key={k} onClick={() => { setPreset(k); setData(null); }} className={`px-3 py-1.5 rounded-full text-xs font-bold ${preset === k ? "bg-ink-950 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
          ))}
          <button onClick={() => { setData(null); load(); }} className="p-2 rounded-control border border-line text-ink-600 hover:bg-canvas"><RefreshCw className="w-3.5 h-3.5" /></button>
          {isAdmin && <button onClick={newAd} className={btnPrimary}><Plus className="w-4 h-4" /> Create ad</button>}
        </div>
      </div>

      {msg && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{msg}</div>}
      {data && !data.pageId && isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800 flex items-center gap-2 flex-wrap">
          <span>To <b>create ads from here</b>, save the Facebook Page your WhatsApp number is connected to:</span>
          <input className="border border-amber-300 rounded-control px-2 py-1 text-xs w-40 bg-white" placeholder="Page ID (numeric)" value={pageInput} onChange={e => setPageInput(e.target.value)} />
          <button onClick={async () => { const d = await fetch("/api/admin/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: pageInput.trim() }) }).then(r => r.json()); if (d.error) setMsg(d.error); else { setPageInput(""); load(); } }} className="px-3 py-1 rounded-control bg-amber-600 text-white text-xs font-bold">Save</button>
        </div>
      )}
      {data?.error && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">Meta error while loading campaigns: {data.error}</div>}

      {detail ? (
        <AdNodeDetail node={detail} preset={preset} currency={cur} isAdmin={isAdmin}
          onBack={() => setDetail(null)}
          onOpen={(level, id, name) => setDetail({ level, id, name })} />
      ) : !data ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : <>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Spend", value: money(totals.spend) },
          { label: "Impressions", value: totals.impressions.toLocaleString() },
          { label: "Clicks", value: totals.clicks.toLocaleString() },
          { label: "WhatsApp chats started", value: totals.conversations.toLocaleString() },
        ].map(c => (
          <div key={c.label} className="bg-white border border-line rounded-card p-4">
            <p className="text-xl font-extrabold text-ink-900 truncate">{c.value}</p>
            <p className="text-[11px] text-slate-500 font-medium">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Drafts — auto-saved, never live until you launch them */}
      {drafts.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-bold text-slate-400 uppercase">Drafts — saved, not running</p>
          <div className="bg-white rounded-card border border-line divide-y divide-line">
            {drafts.map(dr => (
              <div key={dr.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{dr.name}</p>
                  <p className="text-[11px] text-slate-400">Last edited {timeAgo(dr.updatedAt)}</p>
                </div>
                <button onClick={() => openDraft(dr.id)} className="px-3 py-1 rounded-lg bg-brand-700 text-white text-[11px] font-bold">Continue</button>
                <button onClick={() => { if (confirm(`Delete draft "${dr.name}"?`)) deleteDraft(dr.id); }} className="px-2 py-1 rounded-lg border border-line text-[11px] font-bold text-slate-500 hover:text-red-600 hover:border-red-200"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(() => {
        const portalIds = new Set(data.portalCampaignIds ?? []);
        const byStatus = (c: AdsData["campaigns"][number]) =>
          statusFilter === "all" ? true : statusFilter === "active" ? c.effectiveStatus === "ACTIVE" : c.effectiveStatus !== "ACTIVE";
        const visible = data.campaigns.filter(byStatus);
        const portalCamps = visible.filter(c => portalIds.has(c.id));
        const metaCamps = visible.filter(c => !portalIds.has(c.id));
        const activeCount = data.campaigns.filter(c => c.effectiveStatus === "ACTIVE").length;
        const pausedCount = data.campaigns.length - activeCount;
        return (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-bold text-slate-400 uppercase">Campaigns — click any card for full analytics</p>
              <div className="flex gap-1">
                {([["all", `All ${data.campaigns.length}`], ["active", `Active ${activeCount}`], ["paused", `Paused ${pausedCount}`]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setStatusFilter(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${statusFilter === k ? "bg-ink-950 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
                ))}
              </div>
            </div>

            {data.campaigns.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8 bg-white rounded-card border border-line">No campaigns yet — hit <b>Create ad</b> to build one here, or create one in Ads Manager and it appears with live numbers.</p>
            ) : visible.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-6 bg-white rounded-card border border-line">No {statusFilter} campaigns.</p>
            ) : (
              <div className="space-y-4">
                {portalCamps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-brand-700 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Created in this portal · {portalCamps.length}</p>
                    {portalCamps.map(campaignCard)}
                  </div>
                )}
                {metaCamps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> From Meta Ads Manager · {metaCamps.length}</p>
                    {metaCamps.map(campaignCard)}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })()}

      <section className="bg-white rounded-card border border-line p-5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Leads from your ads — our data, not Meta&apos;s</p>
          {leadsTotal > 0 && <button onClick={() => goTo("contacts")} className="text-[11px] font-bold text-brand-700 hover:underline">View in Contacts →</button>}
        </div>
        {data.attribution.length === 0 ? (
          <p className="text-xs text-slate-400 py-3">
            When someone taps a <b>Click-to-WhatsApp ad</b> and messages you, they&apos;re automatically stamped with the ad they came from — and show up here with how many became real leads. Nothing to configure.
          </p>
        ) : (
          <div className="divide-y divide-line">
            <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase"><span>Ad</span><span className="text-right">Chats</span><span className="text-right">Leads</span><span className="text-right">Lead rate</span></div>
            {data.attribution.map(a => (
              <div key={a.adId} className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 py-2 text-sm items-center">
                <span className="font-semibold text-ink-900 truncate">{a.headline}</span>
                <span className="text-right">{a.contacts}</span>
                <span className="text-right font-bold text-brand-700">{a.leads}</span>
                <span className="text-right text-slate-500">{a.contacts ? Math.round((a.leads / a.contacts) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <AdRulesPanel campaigns={data.campaigns.map(x => ({ id: x.id, name: x.name }))} isAdmin={isAdmin} currency={cur} />
      </>}

    </div>
    <AdsRail leads={leadsTotal} chats={totals.conversations} spend={totals.spend ? money(totals.spend) : null} />
    </div>
  );
}

// Meta Ads rail: cost-per-lead headline + how attribution works + tips.
function AdsRail({ leads, chats, spend }: { leads: number; chats: number; spend: string | null }) {
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="The number that matters">
        <StatRow label="WhatsApp chats from ads" value={chats} />
        <StatRow label="Became real leads" value={leads} />
        {spend && <StatRow label="Spend this period" value={spend} />}
        <p className="text-[11px] text-slate-400 pt-1">Meta tells you what an ad <b>costs</b> — your portal tells you what it <b>produces</b>. Judge ads by leads, not clicks.</p>
      </RailCard>
      <RailCard title="How attribution works">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li>Someone taps your <b>Click-to-WhatsApp ad</b> and lands in your chat.</li>
          <li>Meta tags that first message with the ad it came from.</li>
          <li>We stamp the contact (<b>ad_id</b>, headline) — visible in Live Chat &amp; Contacts.</li>
          <li>When the AI or a form captures their details, they count as a <b>lead</b> for that ad.</li>
        </ol>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Pause an ad when its <b>lead rate</b> stays well below your other ads — clicks without leads burn budget.</li>
          <li>Filter Contacts by <b>ad_id</b> to broadcast follow-ups to one ad&apos;s audience.</li>
          <li>Budget changes apply within minutes; Meta may take a few hours to re-learn after big jumps.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// Search-as-you-type picker for geo / interest targeting (create-ad wizard).
type TargetItem = { key: string; name: string; type?: string; audience?: number; radius?: number; context?: string };

const GEO_TYPE_LABELS: Record<string, string> = {
  country: "Country", region: "State / region", city: "City", subcity: "District", neighborhood: "Local area", metro_area: "Metro area", geo_market: "Market", zip: "PIN / ZIP",
};
const geoTypeLabel = (t?: string) => (t && GEO_TYPE_LABELS[t]) || t || "";
function TargetPicker({ kind, picked, onPick, onRemove, placeholder }: { kind: "geo" | "interest" | "locale"; picked: TargetItem[]; onPick: (x: TargetItem) => void; onRemove: (key: string) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TargetItem[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/admin/meta/search?kind=${kind}&q=${encodeURIComponent(q.trim())}`).then(r => r.json()).then(d => setResults(d.results ?? [])).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [q, kind]);
  return (
    <div className="space-y-1.5">
      {picked.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {picked.map(p => (
            <span key={p.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold" title={p.context}>
              {p.name}{p.type && p.type !== kind ? <span className="font-normal text-brand-700/60">· {kind === "geo" ? geoTypeLabel(p.type) : p.type}</span> : null}{p.context ? <span className="font-normal text-brand-700/50">· {p.context}</span> : null}
              <button onClick={() => onRemove(p.key)} className="text-brand-700/50 hover:text-red-500">×</button>
            </span>
          ))}
        </div>
      )}
      <input className={`${inp} w-full`} placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} />
      {results.length > 0 && (
        <div className="border border-line rounded-control divide-y divide-line max-h-44 overflow-y-auto bg-white">
          {results.map(r => (
            <button key={r.key} onClick={() => { onPick(r); setQ(""); setResults([]); }} className="w-full text-left px-3 py-1.5 hover:bg-canvas">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-semibold text-ink-900">{r.name}</span>
                <span className="text-[10px] text-slate-400">{kind === "geo" ? geoTypeLabel(r.type) : r.type}{r.audience ? ` · ~${r.audience >= 1e6 ? (r.audience / 1e6).toFixed(1) + "M" : Math.round(r.audience / 1e3) + "K"} people` : ""}</span>
              </div>
              {r.context && <p className="text-[10px] text-slate-400 leading-tight">{r.context}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── One unified location model ────────────────────────────────────────────────
// A location is either a whole country (no radius) or a radius around a point
// (any place — city, local area, metro, mall, college). Radius locations target
// Meta custom_locations (lat/lng + km); the map shows exactly what's covered.
type GeoResult = { name: string; context: string; lat: number; lng: number; type: string; countryCode?: string };
type LocationItem = { id: string; kind: "country" | "radius"; name: string; context?: string; countryCode?: string; lat?: number; lng?: number; radius?: number };
const DEFAULT_LOCATION: LocationItem = { id: "country:IN", kind: "country", name: "India", countryCode: "IN" };

// Client-only Leaflet map (needs `window`) — clean labelled tiles + true circle.
const RadiusLeafletMap = dynamic(() => import("./RadiusLeafletMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-canvas"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></div>,
});
function RadiusMap({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  return (
    <div className="w-full h-52 rounded-control overflow-hidden border border-line">
      <RadiusLeafletMap lat={lat} lng={lng} radius={radius} />
    </div>
  );
}

// One search bar for everything: countries, cities, local areas, PINs, and any
// landmark (metro, college, mall). Countries become a plain target; everything
// else becomes a radius location with a slider + map.
function LocationPicker({ locations, setLocations }: { locations: LocationItem[]; setLocations: Dispatch<SetStateAction<LocationItem[]>> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/admin/meta/search?kind=place&q=${encodeURIComponent(q.trim())}`).then(r => r.json()).then(d => setResults(d.results ?? [])).catch(() => {}).finally(() => setSearching(false));
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (r: GeoResult) => {
    const isCountry = r.type === "country";
    const item: LocationItem = isCountry
      ? { id: `country:${r.countryCode ?? r.name}`, kind: "country", name: r.name, countryCode: r.countryCode }
      : { id: `radius:${r.lat.toFixed(4)},${r.lng.toFixed(4)}`, kind: "radius", name: r.name, context: r.context, lat: r.lat, lng: r.lng, radius: 10 };
    setLocations(ls => {
      if (ls.some(l => l.id === item.id)) return ls;
      // Adding a specific radius area? Drop the default whole-country target so
      // you don't accidentally end up targeting the entire country + the area.
      const base = (item.kind === "radius" && ls.length === 1 && ls[0].id === DEFAULT_LOCATION.id) ? [] : ls;
      return [...base, item];
    });
    setQ(""); setResults([]);
  };
  const remove = (id: string) => setLocations(ls => ls.filter(l => l.id !== id));
  const setRadius = (id: string, radius: number) => setLocations(ls => ls.map(l => l.id === id ? { ...l, radius } : l));

  const radiusItems = locations.filter(l => l.kind === "radius");
  const countryItems = locations.filter(l => l.kind === "country");

  return (
    <div className="space-y-2">
      {/* chips */}
      {locations.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {countryItems.map(l => (
            <span key={l.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
              {l.name}<span className="font-normal text-brand-700/60">· Country</span>
              <button onClick={() => remove(l.id)} className="text-brand-700/50 hover:text-red-500">×</button>
            </span>
          ))}
        </div>
      )}
      {/* single search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input className={`${inp} w-full pl-8`} placeholder="Search a country, city, local area, PIN, or any place (e.g. Saket, IIT Delhi, Phoenix Mall)…" value={q} onChange={e => setQ(e.target.value)} />
        {searching && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" />}
      </div>
      {results.length > 0 && (
        <div className="border border-line rounded-control divide-y divide-line max-h-52 overflow-y-auto bg-white">
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)} className="w-full text-left px-3 py-1.5 hover:bg-canvas flex items-center gap-2">
              {r.type === "country" ? <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <MapPin className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-900 truncate">{r.name} <span className="font-normal text-[10px] text-slate-400">{r.type === "country" ? "Country" : "+ radius"}</span></p>
                {r.context && <p className="text-[10px] text-slate-400 leading-tight truncate">{r.context}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* radius areas — each with slider + coverage map */}
      {radiusItems.map(l => (
        <div key={l.id} className="rounded-control border border-line p-2.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-ink-900 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-brand-700 shrink-0" /> {l.name}</p>
              {l.context && <p className="text-[10px] text-slate-400 truncate">{l.context}</p>}
            </div>
            <button onClick={() => remove(l.id)} className="text-[11px] font-bold text-red-500 hover:text-red-600 shrink-0">Remove</button>
          </div>
          <RadiusMap lat={l.lat!} lng={l.lng!} radius={l.radius ?? 10} />
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-700 font-semibold whitespace-nowrap">Radius</span>
            <input type="range" min={1} max={80} value={l.radius ?? 10} onChange={e => setRadius(l.id, Number(e.target.value))} className="flex-1 accent-brand-700" />
            <span className="text-brand-700 font-bold w-12 text-right">{l.radius ?? 10} km</span>
          </div>
        </div>
      ))}

      {countryItems.length > 0 && radiusItems.length > 0 && (
        <p className="text-[11px] text-amber-600">You have a whole country and specific areas selected — Meta will target <b>both</b>. Remove the country to target only the pinned areas.</p>
      )}
      {locations.length === 0 && <p className="text-[11px] text-slate-400">Add at least one location.</p>}
    </div>
  );
}

// Guided 4-step Click-to-WhatsApp campaign builder. Everything is created
// PAUSED by default — nothing spends until explicitly launched live.
const OBJECTIVES: { key: "OUTCOME_ENGAGEMENT" | "OUTCOME_SALES" | "OUTCOME_LEADS" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS"; label: string; hint: string }[] = [
  { key: "OUTCOME_ENGAGEMENT", label: "Engagement", hint: "Most WhatsApp chats — best for lead gen (recommended)" },
  { key: "OUTCOME_LEADS", label: "Leads", hint: "Optimise for people likely to become leads" },
  { key: "OUTCOME_SALES", label: "Sales", hint: "Optimise for people likely to convert / buy" },
  { key: "OUTCOME_TRAFFIC", label: "Traffic", hint: "Cheapest clicks into WhatsApp — high volume, lower intent" },
  { key: "OUTCOME_AWARENESS", label: "Awareness", hint: "Maximum reach — brand visibility, not chats" },
];
const BID_STRATEGIES: { key: "LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "LOWEST_COST_WITH_BID_CAP"; label: string; hint: string; needsAmount: boolean }[] = [
  { key: "LOWEST_COST_WITHOUT_CAP", label: "Highest volume", hint: "Get the most results for your budget (recommended)", needsAmount: false },
  { key: "COST_CAP", label: "Cost per result goal", hint: "Meta keeps your average cost per result around a target", needsAmount: true },
  { key: "LOWEST_COST_WITH_BID_CAP", label: "Bid cap", hint: "Hard limit on what you bid in each auction (advanced)", needsAmount: true },
];
const SPECIAL_CATS: [string, string][] = [
  ["CREDIT", "Credit"], ["EMPLOYMENT", "Employment"], ["HOUSING", "Housing"],
  ["FINANCIAL_PRODUCTS_SERVICES", "Financial products & services"], ["ISSUES_ELECTIONS_POLITICS", "Social issues, elections or politics"],
];
const AD_PLATFORMS: [string, string][] = [["facebook", "Facebook"], ["instagram", "Instagram"], ["messenger", "Messenger"], ["audience_network", "Audience Network"]];
// Placement positions per platform (Meta facebook_positions / instagram_positions / …).
const PLATFORM_POSITIONS: Record<string, [string, string][]> = {
  facebook: [["feed", "Feed"], ["facebook_reels", "Reels"], ["story", "Stories"], ["video_feeds", "Video feeds"], ["marketplace", "Marketplace"], ["instream_video", "In-stream video"], ["right_hand_column", "Right column"], ["search", "Search"]],
  instagram: [["stream", "Feed"], ["story", "Stories"], ["reels", "Reels"], ["explore", "Explore"], ["profile_feed", "Profile feed"]],
  messenger: [["messenger_home", "Inbox"], ["story", "Stories"]],
  audience_network: [["classic", "Native & banner"], ["rewarded_video", "Rewarded video"]],
};
const allPositions = (platform: string) => (PLATFORM_POSITIONS[platform] ?? []).map(([v]) => v);
const CONVERSION_LOCATIONS: { key: "WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM"; label: string; hint: string }[] = [
  { key: "WHATSAPP", label: "WhatsApp", hint: "Chat opens with your number" },
  { key: "WEBSITE", label: "Website", hint: "Send people to your site / landing page" },
  { key: "INSTANT_FORM", label: "Instant form", hint: "Collect leads in a native Meta form" },
  { key: "MESSENGER", label: "Messenger", hint: "Chat opens in Messenger" },
];
const WEB_CTAS: [string, string][] = [["LEARN_MORE", "Learn more"], ["SIGN_UP", "Sign up"], ["APPLY_NOW", "Apply now"], ["GET_OFFER", "Get offer"], ["BOOK_TRAVEL", "Book now"], ["DOWNLOAD", "Download"], ["SHOP_NOW", "Shop now"], ["CONTACT_US", "Contact us"], ["SUBSCRIBE", "Subscribe"]];
const PIXEL_EVENTS: [string, string][] = [["LEAD", "Lead"], ["COMPLETE_REGISTRATION", "Complete registration"], ["PURCHASE", "Purchase"], ["ADD_TO_CART", "Add to cart"], ["INITIATED_CHECKOUT", "Initiated checkout"], ["CONTACT", "Contact"], ["SUBMIT_APPLICATION", "Submit application"], ["SCHEDULE", "Schedule"], ["VIEW_CONTENT", "View content"]];
// Performance goals (optimization_goal) Meta allows per conversion location.
// First entry is the recommended default.
const PERF_GOALS = (destination: string, hasPixel: boolean): [string, string][] => {
  if (destination === "WHATSAPP" || destination === "MESSENGER")
    return [["CONVERSATIONS", "Maximise conversations"], ["LINK_CLICKS", "Maximise link clicks"], ["REACH", "Maximise reach"], ["IMPRESSIONS", "Maximise impressions"]];
  if (destination === "INSTANT_FORM")
    return [["LEAD_GENERATION", "Maximise leads"]];
  const base: [string, string][] = [["LANDING_PAGE_VIEWS", "Maximise landing-page views"], ["LINK_CLICKS", "Maximise link clicks"], ["REACH", "Maximise reach"], ["IMPRESSIONS", "Maximise impressions"]];
  return hasPixel ? [["OFFSITE_CONVERSIONS", "Maximise conversions"], ...base] : base;
};

function CreateAdBuilder({ currency, hasPage, onClose, onCreated, draftId: initialDraftId, draftData }: { currency: string; hasPage: boolean; onClose: () => void; onCreated: () => void; draftId?: string | null; draftData?: Record<string, unknown> | null }) {
  const TOTAL = 5;
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<typeof OBJECTIVES[number]["key"]>("OUTCOME_ENGAGEMENT");
  const [optGoal, setOptGoal] = useState("");
  const [destination, setDestination] = useState<"WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM">("WHATSAPP");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [conversionEvent, setConversionEvent] = useState("LEAD");
  const [leadFormId, setLeadFormId] = useState("");
  const [ctaType, setCtaType] = useState("LEARN_MORE");
  const [pixels, setPixels] = useState<{ id: string; name: string }[]>([]);
  const [leadForms, setLeadForms] = useState<{ id: string; name: string; status: string }[]>([]);
  const [specialCats, setSpecialCats] = useState<string[]>([]);
  const [budgetLevel, setBudgetLevel] = useState<"adset" | "campaign">("adset");
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [budget, setBudget] = useState("500");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bidStrategy, setBidStrategy] = useState<typeof BID_STRATEGIES[number]["key"]>("LOWEST_COST_WITHOUT_CAP");
  const [bidAmount, setBidAmount] = useState("");
  const [locations, setLocations] = useState<LocationItem[]>([DEFAULT_LOCATION]);
  const [flows, setFlows] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [flowId, setFlowId] = useState("");
  const [flowScope, setFlowScope] = useState<"campaign" | "ad">("campaign");
  const [interests, setInterests] = useState<TargetItem[]>([]);
  const [languages, setLanguages] = useState<TargetItem[]>([]);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(55);
  const [gender, setGender] = useState<"all" | "men" | "women">("all");
  const [advantage, setAdvantage] = useState(true);
  const [placements, setPlacements] = useState<"advantage" | "manual">("advantage");
  const [platforms, setPlatforms] = useState<string[]>(["facebook", "instagram"]);
  const [positions, setPositions] = useState<Record<string, string[]>>({ facebook: allPositions("facebook"), instagram: allPositions("instagram") });
  const togglePlatform = (k: string) => setPlatforms(p => {
    if (p.includes(k)) { setPositions(pos => { const n = { ...pos }; delete n[k]; return n; }); return p.filter(x => x !== k); }
    setPositions(pos => ({ ...pos, [k]: allPositions(k) }));      // enable → all positions on by default
    return [...p, k];
  });
  const togglePosition = (platform: string, value: string) => setPositions(pos => {
    const cur = pos[platform] ?? allPositions(platform);
    const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    return { ...pos, [platform]: next.length ? next : cur };   // keep at least one
  });
  const [customAudiences, setCustomAudiences] = useState<{ id: string; name: string; count: number | null }[]>([]);
  const [includeAuds, setIncludeAuds] = useState<string[]>([]);
  const [excludeAuds, setExcludeAuds] = useState<string[]>([]);
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [urlTags, setUrlTags] = useState("");
  const [creativeFormat, setCreativeFormat] = useState<"single" | "video" | "carousel">("single");
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [cards, setCards] = useState<{ imageHash: string | null; imageName: string; imagePreview: string | null; headline: string; description: string }[]>([
    { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" },
    { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" },
  ]);
  const [cardUploading, setCardUploading] = useState<number | null>(null);
  const [placement, setPlacement] = useState<string>("fb_feed");
  const [realPreviews, setRealPreviews] = useState<{ key: string; label: string; html: string }[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ lower?: number; upper?: number } | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateErr, setEstimateErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activate, setActivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sym = currency === "INR" ? "₹" : currency ? currency + " " : "";
  const bidNeedsAmount = BID_STRATEGIES.find(b => b.key === bidStrategy)?.needsAmount ?? false;
  useEffect(() => { fetch("/api/admin/meta/audiences").then(r => r.json()).then(d => { setCustomAudiences(d.audiences ?? []); setPixels(d.pixels ?? []); setLeadForms(d.leadForms ?? []); }).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows((d.flows ?? []).filter((f: { active: boolean }) => f.active))).catch(() => {}); }, []);
  const toIso = (d: string, end = false) => d ? new Date(`${d}T${end ? "23:59" : "00:00"}:00`).toISOString() : null;

  // ── Draft auto-save ── snapshot the whole form so a refresh never loses work
  // (and never launches the ad — drafts only become live when you hit Create).
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const restoredRef = useRef(false);
  // Restore a resumed draft once on mount.
  useEffect(() => {
    if (restoredRef.current || !draftData) return;
    restoredRef.current = true;
    const d = draftData as Record<string, unknown>;
    const S = <T,>(v: unknown, set: (x: T) => void) => { if (v !== undefined && v !== null) set(v as T); };
    S(d.step, setStep);
    S(d.name, setName); S(d.objective, setObjective); S(d.optGoal, setOptGoal); S(d.destination, setDestination); S(d.websiteUrl, setWebsiteUrl);
    S(d.pixelId, setPixelId); S(d.conversionEvent, setConversionEvent); S(d.leadFormId, setLeadFormId); S(d.ctaType, setCtaType);
    S(d.specialCats, setSpecialCats); S(d.budgetLevel, setBudgetLevel); S(d.budgetType, setBudgetType); S(d.budget, setBudget);
    S(d.startDate, setStartDate); S(d.endDate, setEndDate); S(d.bidStrategy, setBidStrategy); S(d.bidAmount, setBidAmount);
    S(d.locations, setLocations); S(d.interests, setInterests); S(d.languages, setLanguages); S(d.ageMin, setAgeMin); S(d.ageMax, setAgeMax);
    S(d.gender, setGender); S(d.advantage, setAdvantage); S(d.placements, setPlacements); S(d.platforms, setPlatforms); S(d.positions, setPositions);
    S(d.includeAuds, setIncludeAuds); S(d.excludeAuds, setExcludeAuds); S(d.primaryText, setPrimaryText); S(d.headline, setHeadline);
    S(d.description, setDescription); S(d.urlTags, setUrlTags); S(d.creativeFormat, setCreativeFormat); S(d.imageHash, setImageHash);
    S(d.imageName, setImageName); S(d.videoId, setVideoId); S(d.videoName, setVideoName); S(d.flowId, setFlowId); S(d.flowScope, setFlowScope);
    const draftCards = Array.isArray(d.cards) ? d.cards as { imageHash: string | null; imageName: string; headline: string; description: string }[] : [];
    if (draftCards.length) setCards(draftCards.map(c => ({ ...c, imagePreview: null })));
    // The upload preview blob is gone on reopen — re-fetch Meta-hosted URLs from
    // the saved hashes so the restored image(s) show again.
    void (async () => {
      const hashes = [d.imageHash as string | undefined, ...draftCards.map(c => c.imageHash ?? undefined)].filter(Boolean) as string[];
      if (hashes.length) {
        const res = await fetch(`/api/admin/meta/media?hashes=${hashes.join(",")}`).then(r => r.json()).catch(() => null);
        const urls: Record<string, string> = res?.urls ?? {};
        if (d.imageHash && urls[d.imageHash as string]) setImagePreview(urls[d.imageHash as string]);
        if (draftCards.length) setCards(cs => cs.map((c, i) => { const h = draftCards[i]?.imageHash; return h && urls[h] ? { ...c, imagePreview: urls[h] } : c; }));
      }
      if (d.videoId) {
        const res = await fetch(`/api/admin/meta/media?videoId=${d.videoId}`).then(r => r.json()).catch(() => null);
        if (res?.thumb) setVideoPreview(res.thumb as string);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serialize = (): Record<string, unknown> => ({
    step,
    name, objective, optGoal, destination, websiteUrl, pixelId, conversionEvent, leadFormId, ctaType, specialCats,
    budgetLevel, budgetType, budget, startDate, endDate, bidStrategy, bidAmount,
    locations, interests, languages, ageMin, ageMax, gender, advantage, placements, platforms, positions, includeAuds, excludeAuds,
    primaryText, headline, description, urlTags, creativeFormat, imageHash, imageName, videoId, videoName,
    cards: cards.map(c => ({ imageHash: c.imageHash, imageName: c.imageName, headline: c.headline, description: c.description })),
    flowId, flowScope,
  });

  // Debounced auto-save once there's something worth keeping.
  useEffect(() => {
    if (creating) return;
    const hasContent = name.trim() || headline.trim() || primaryText.trim() || imageHash || videoId;
    if (!hasContent) return;
    const t = setTimeout(async () => {
      const d = await fetch("/api/admin/meta/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId, name: name.trim() || "Untitled ad", data: serialize() }),
      }).then(r => r.json()).catch(() => null);
      if (d?.id && !draftId) setDraftId(d.id);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, name, objective, optGoal, destination, websiteUrl, pixelId, conversionEvent, leadFormId, ctaType, specialCats, budgetLevel, budgetType, budget, startDate, endDate, bidStrategy, bidAmount, locations, interests, languages, ageMin, ageMax, gender, advantage, placements, platforms, positions, includeAuds, excludeAuds, primaryText, headline, description, urlTags, creativeFormat, imageHash, imageName, videoId, videoName, cards, flowId, flowScope]);

  async function uploadImage(f: File) {
    setUploading(true); setErr(null);
    try {
      setImagePreview(URL.createObjectURL(f));          // instant local preview
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.imageHash) { setImageHash(d.imageHash); setImageName(f.name); } else setErr(d.error || "Upload failed");
    } finally { setUploading(false); }
  }

  async function uploadVideo(f: File) {
    setUploading(true); setErr(null);
    try {
      setVideoPreview(URL.createObjectURL(f));          // instant local preview
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.videoId) { setVideoId(d.videoId); setVideoName(f.name); } else setErr(d.error || "Video upload failed");
    } finally { setUploading(false); }
  }

  async function uploadCardImage(i: number, f: File) {
    setCardUploading(i); setErr(null);
    const preview = URL.createObjectURL(f);
    setCards(cs => cs.map((c, x) => x === i ? { ...c, imagePreview: preview } : c));
    try {
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.imageHash) setCards(cs => cs.map((c, x) => x === i ? { ...c, imageHash: d.imageHash, imageName: f.name } : c));
      else setErr(d.error || "Upload failed");
    } finally { setCardUploading(null); }
  }

  async function create() {
    setCreating(true); setErr(null);
    try {
      const d = await fetch("/api/admin/meta/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), objective, conversionLocation: destination, specialAdCategories: specialCats,
          websiteUrl: websiteUrl.trim() || null, pixelId: pixelId || null, conversionEvent: conversionEvent || null,
          leadFormId: leadFormId || null, ctaType,
          budgetLevel, budgetType, budget: Number(budget),
          startTime: toIso(startDate), endTime: toIso(endDate, true),
          bidStrategy, bidAmount: bidNeedsAmount ? Number(bidAmount) : null,
          optimizationGoal: effectiveGoal,
          placements, publisherPlatforms: platforms, activate,
          positions: placements === "manual" ? Object.fromEntries(platforms.map(p => [p, positions[p]?.length ? positions[p] : allPositions(p)])) : {},
          targeting: {
            countries: locations.filter(l => l.kind === "country").map(l => l.countryCode!).filter(Boolean),
            customLocations: locations.filter(l => l.kind === "radius").map(l => ({ lat: l.lat!, lng: l.lng!, radius: l.radius ?? 10, name: l.name })),
            ageMin, ageMax,
            genders: gender === "men" ? [1] : gender === "women" ? [2] : [],
            interests: interests.map(i => ({ id: i.key, name: i.name })),
            locales: languages.map(l => Number(l.key)).filter(Boolean),
            customAudiences: includeAuds.map(id => ({ id })),
            excludedCustomAudiences: excludeAuds.map(id => ({ id })),
            advantageAudience: advantage,
          },
          creative: {
            format: creativeFormat,
            imageHash, videoId,
            cards: creativeFormat === "carousel" ? cards.map(c => ({ imageHash: c.imageHash, headline: c.headline.trim(), description: c.description.trim() })) : undefined,
            primaryText: primaryText.trim(), headline: headline.trim(), description: description.trim(), urlTags: urlTags.trim(),
          },
          flowId: destination === "WHATSAPP" && flowId ? flowId : null, flowScope,
        }),
      }).then(r => r.json());
      if (d.success) {
        if (draftId) await fetch(`/api/admin/meta/drafts?id=${draftId}`, { method: "DELETE" }).catch(() => {});
        onCreated();
      } else setErr(d.error || "Creation failed");
    } finally { setCreating(false); }
  }

  // Enough uploaded for Meta to render a real preview?
  const mediaReady = creativeFormat === "single" ? !!imageHash : creativeFormat === "video" ? !!videoId : cards.filter(c => c.imageHash).length >= 2;
  // Debounced live preview straight from Meta — the exact render each placement shows.
  useEffect(() => {
    if (step !== 4 || !mediaReady || !headline.trim() || !primaryText.trim()) { setRealPreviews(null); return; }
    const handle = setTimeout(async () => {
      setPreviewLoading(true); setPreviewErr(null);
      try {
        const d = await fetch("/api/admin/meta/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective, conversionLocation: destination,
            websiteUrl: websiteUrl.trim() || null, pixelId: pixelId || null, conversionEvent: conversionEvent || null, leadFormId: leadFormId || null, ctaType,
            creative: {
              format: creativeFormat, imageHash, videoId,
              cards: creativeFormat === "carousel" ? cards.map(c => ({ imageHash: c.imageHash, headline: c.headline.trim(), description: c.description.trim() })) : undefined,
              primaryText: primaryText.trim(), headline: headline.trim(), description: description.trim(), urlTags: urlTags.trim(),
            },
          }),
        }).then(r => r.json());
        if (d.previews?.length) {
          setRealPreviews(d.previews);
          setPlacement(p => d.previews.some((x: { key: string }) => x.key === p) ? p : d.previews[0].key);
        } else { setRealPreviews(null); setPreviewErr(d.error || "Preview unavailable"); }
      } catch { setPreviewErr("Preview unavailable"); } finally { setPreviewLoading(false); }
    }, 900);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mediaReady, creativeFormat, imageHash, videoId, cards, primaryText, headline, description, urlTags, destination, objective, websiteUrl, ctaType, pixelId, conversionEvent, leadFormId]);

  // Debounced audience-size estimate from Meta — shown on the audience step.
  useEffect(() => {
    if (step !== 3 || locations.length === 0) { return; }
    const handle = setTimeout(async () => {
      setEstimateLoading(true); setEstimateErr(null);
      try {
        const d = await fetch("/api/admin/meta/estimate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective, conversionLocation: destination,
            websiteUrl: websiteUrl.trim() || null, pixelId: pixelId || null, conversionEvent: conversionEvent || null, leadFormId: leadFormId || null, ctaType,
            optimizationGoal: effectiveGoal,
            placements, publisherPlatforms: platforms,
            positions: placements === "manual" ? Object.fromEntries(platforms.map(p => [p, positions[p]?.length ? positions[p] : allPositions(p)])) : {},
            targeting: {
              countries: locations.filter(l => l.kind === "country").map(l => l.countryCode!).filter(Boolean),
              customLocations: locations.filter(l => l.kind === "radius").map(l => ({ lat: l.lat!, lng: l.lng!, radius: l.radius ?? 10, name: l.name })),
              ageMin, ageMax,
              genders: gender === "men" ? [1] : gender === "women" ? [2] : [],
              interests: interests.map(i => ({ id: i.key, name: i.name })),
              locales: languages.map(l => Number(l.key)).filter(Boolean),
              customAudiences: includeAuds.map(id => ({ id })),
              excludedCustomAudiences: excludeAuds.map(id => ({ id })),
              advantageAudience: advantage,
            },
          }),
        }).then(r => r.json());
        if (d.lower != null || d.upper != null) { setEstimate({ lower: d.lower, upper: d.upper }); }
        else { setEstimate(null); setEstimateErr(d.error || "Estimate unavailable"); }
      } catch { setEstimateErr("Estimate unavailable"); } finally { setEstimateLoading(false); }
    }, 700);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, locations, interests, languages, ageMin, ageMax, gender, advantage, includeAuds, excludeAuds, placements, platforms, positions, objective, optGoal, pixelId, destination]);

  const canNext =
    step === 1 ? name.trim().length > 0
    : step === 2 ? Number(budget) > 0 && (budgetType !== "lifetime" || !!endDate) && (!bidNeedsAmount || Number(bidAmount) > 0) && (destination !== "WEBSITE" || websiteUrl.trim().length > 0) && (destination !== "INSTANT_FORM" || !!leadFormId)
    : step === 3 ? locations.length > 0
    : step === 4 ? primaryText.trim().length > 0 && headline.trim().length > 0
      && (creativeFormat !== "video" || !!videoId)
      && (creativeFormat !== "carousel" || (cards.length >= 2 && cards.every(c => c.imageHash && c.headline.trim().length > 0)))
    : true;
  const stepTitle = ["", "Campaign name", "Goal & budget", "Audience", "Ad creative", "Review & launch"][step];
  const field = "space-y-1";
  const lbl = "text-[11px] font-bold text-ink-700";

  // Performance goal — selectable; valid options depend on the conversion location.
  const goalOpts = PERF_GOALS(destination, !!pixelId);
  const effectiveGoal = optGoal && goalOpts.some(o => o[0] === optGoal) ? optGoal : goalOpts[0][0];
  const perfGoal = (() => {
    const base = goalOpts.find(o => o[0] === effectiveGoal)?.[1] ?? goalOpts[0][1];
    return effectiveGoal === "OFFSITE_CONVERSIONS" ? `${base} · ${PIXEL_EVENTS.find(e => e[0] === conversionEvent)?.[1]}` : base;
  })();
  const ctaLabel =
    destination === "WHATSAPP" ? "Send WhatsApp message"
    : destination === "MESSENGER" ? "Send message"
    : destination === "INSTANT_FORM" ? "Sign up"
    : WEB_CTAS.find(c => c[0] === ctaType)?.[1] ?? "Learn more";

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-2xl space-y-3">
      <button onClick={onClose} className="text-xs font-bold text-brand-700 flex items-center gap-1 hover:gap-1.5 transition-all"><ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns</button>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> New ad</h2>
          <p className="text-[11px] text-slate-400">Step {step} of {TOTAL} — {stepTitle}</p>
        </div>
      </div>
      <div className="flex gap-1">{Array.from({ length: TOTAL }, (_, i) => i + 1).map(s => <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-brand-700" : "bg-line"}`} />)}</div>

        {!hasPage && <div className="bg-amber-50 border border-amber-200 rounded-control px-3 py-2 text-xs text-amber-800">Save your Facebook Page ID first (banner on the Ads page) — Click-to-WhatsApp ads run from a Page with your WhatsApp number connected.</div>}

        {step === 1 && (
          <div className={field}>
            <p className={lbl}>Campaign name <span className="font-normal text-slate-400">(internal — customers never see it)</span></p>
            <input className={`${inp} w-full`} placeholder="e.g. Data Science — June intake" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <p className="text-[11px] text-slate-400">Name it so you&apos;ll recognise it later in reports — audience + offer is a good pattern.</p>
          </div>
        )}

        {step === 2 && <>
          <div className={field}>
            <p className={lbl}>Campaign goal</p>
            <div className="grid grid-cols-1 gap-1.5">
              {OBJECTIVES.map(o => (
                <button key={o.key} onClick={() => setObjective(o.key)} className={`text-left rounded-control border p-2.5 transition-colors ${objective === o.key ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
                  <p className="text-xs font-bold text-ink-900">{o.label}</p>
                  <p className="text-[11px] text-slate-500">{o.hint}</p>
                </button>
              ))}
            </div>
          </div>
          <div className={field}>
            <p className={lbl}>Conversion location — where people go after they click</p>
            <div className="grid grid-cols-2 gap-2">
              {CONVERSION_LOCATIONS.map(c => (
                <button key={c.key} onClick={() => setDestination(c.key)} className={`text-left rounded-control border p-2.5 ${destination === c.key ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
                  <p className="text-xs font-bold text-ink-900">{c.label}</p>
                  <p className="text-[10px] text-slate-500">{c.hint}</p>
                </button>
              ))}
            </div>
          </div>
          {destination === "WEBSITE" && (
            <div className="rounded-control border border-line p-3 space-y-2">
              <div className={field}>
                <p className={lbl}>Website URL</p>
                <input className={`${inp} w-full`} placeholder="https://yoursite.com/landing" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={field}>
                  <p className={lbl}>Button</p>
                  <select className={`${inp} w-full`} value={ctaType} onChange={e => setCtaType(e.target.value)}>{WEB_CTAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
                <div className={field}>
                  <p className={lbl}>Optimise for (pixel)</p>
                  <select className={`${inp} w-full`} value={pixelId} onChange={e => setPixelId(e.target.value)}>
                    <option value="">Traffic — just clicks/visits</option>
                    {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              {pixelId && (
                <div className={field}>
                  <p className={lbl}>Conversion event</p>
                  <select className={`${inp} w-full`} value={conversionEvent} onChange={e => setConversionEvent(e.target.value)}>{PIXEL_EVENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
              )}
              {pixels.length === 0 && <p className="text-[11px] text-amber-600">No pixels found on this account — the ad will optimise for visits. Install a pixel in Events Manager to optimise for conversions.</p>}
            </div>
          )}
          {destination === "INSTANT_FORM" && (
            <div className="rounded-control border border-line p-3 space-y-1.5">
              <p className={lbl}>Lead form</p>
              {leadForms.length === 0
                ? <p className="text-[11px] text-amber-600">No lead forms found on your Page. Create one in Ads Manager (or Page → Lead forms) and it&apos;ll appear here.</p>
                : <select className={`${inp} w-full`} value={leadFormId} onChange={e => setLeadFormId(e.target.value)}>
                    <option value="">Choose a form…</option>
                    {leadForms.map(f => <option key={f.id} value={f.id}>{f.name}{f.status && f.status !== "ACTIVE" ? ` (${f.status})` : ""}</option>)}
                  </select>}
            </div>
          )}
          <div className={field}>
            <p className={lbl}>Performance goal <span className="font-normal text-slate-400">(what Meta optimises delivery for)</span></p>
            {goalOpts.length > 1 ? (
              <select className={`${inp} w-full`} value={effectiveGoal} onChange={e => setOptGoal(e.target.value)}>
                {goalOpts.map(([v, l], i) => <option key={v} value={v}>{l}{i === 0 ? " — recommended" : ""}</option>)}
              </select>
            ) : (
              <div className="bg-canvas rounded-control px-3 py-2 text-xs font-bold text-ink-900">{perfGoal}</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={field}>
              <p className={lbl}>Budget control</p>
              <select className={`${inp} w-full`} value={budgetLevel} onChange={e => setBudgetLevel(e.target.value as "adset" | "campaign")}>
                <option value="adset">Ad-set budget (ABO)</option>
                <option value="campaign">Campaign budget — Advantage (CBO)</option>
              </select>
            </div>
            <div className={field}>
              <p className={lbl}>Budget type</p>
              <select className={`${inp} w-full`} value={budgetType} onChange={e => setBudgetType(e.target.value as "daily" | "lifetime")}>
                <option value="daily">Daily</option>
                <option value="lifetime">Lifetime</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 -mt-1">{budgetLevel === "campaign" ? "CBO: Meta splits one budget across ad sets automatically — best when you add multiple audiences." : "ABO: this ad set gets its own fixed budget — best for tight control."}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className={field}>
              <p className={lbl}>{budgetType === "lifetime" ? "Total budget" : "Daily budget"} ({currency || "acct currency"})</p>
              <input className={`${inp} w-full`} type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)} />
            </div>
            {budgetType === "lifetime" && (
              <div className={field}>
                <p className={lbl}>Run until</p>
                <input className={`${inp} w-full`} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            )}
          </div>
          <div className={field}>
            <p className={lbl}>Bidding</p>
            <select className={`${inp} w-full`} value={bidStrategy} onChange={e => setBidStrategy(e.target.value as typeof bidStrategy)}>
              {BID_STRATEGIES.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <p className="text-[11px] text-slate-400">{BID_STRATEGIES.find(b => b.key === bidStrategy)?.hint}</p>
            {bidNeedsAmount && (
              <input className={`${inp} w-40 mt-1`} type="number" min="1" placeholder={`${sym}target per result`} value={bidAmount} onChange={e => setBidAmount(e.target.value)} />
            )}
          </div>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — schedule &amp; special ad categories</summary>
            <div className="pt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className={field}><p className={lbl}>Start date <span className="font-normal text-slate-400">(optional)</span></p><input className={`${inp} w-full`} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                {budgetType !== "lifetime" && <div className={field}><p className={lbl}>End date <span className="font-normal text-slate-400">(optional)</span></p><input className={`${inp} w-full`} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>}
              </div>
              <div className={field}>
                <p className={lbl}>Special ad categories <span className="font-normal text-slate-400">(declare if applicable — avoids rejection)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {SPECIAL_CATS.map(([k, l]) => (
                    <button key={k} onClick={() => setSpecialCats(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k])} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${specialCats.includes(k) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </>}

        {step === 3 && <>
          <div className={field}>
            <p className={lbl}>Locations <span className="font-normal text-slate-400">(search a place — pick a country, or any area to target a radius around it)</span></p>
            <LocationPicker locations={locations} setLocations={setLocations} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={field}>
              <p className={lbl}>Age range</p>
              <div className="flex items-center gap-2 text-sm">
                <input className={`${inp} w-16`} type="number" min={18} max={65} value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} />
                <span className="text-slate-400">to</span>
                <input className={`${inp} w-16`} type="number" min={18} max={65} value={ageMax} onChange={e => setAgeMax(Number(e.target.value))} />
              </div>
            </div>
            <div className={field}>
              <p className={lbl}>Gender</p>
              <select className={`${inp} w-full`} value={gender} onChange={e => setGender(e.target.value as "all" | "men" | "women")}>
                <option value="all">All</option>
                <option value="men">Men</option>
                <option value="women">Women</option>
              </select>
            </div>
          </div>
          <div className={field}>
            <p className={lbl}>Interests <span className="font-normal text-slate-400">(optional)</span></p>
            <TargetPicker kind="interest" picked={interests} onPick={x => setInterests(g => g.some(y => y.key === x.key) ? g : [...g, x])} onRemove={k => setInterests(g => g.filter(x => x.key !== k))} placeholder="Search interests — e.g. data science, MBA…" />
          </div>
          <label className="flex items-start gap-2 text-[11px] text-ink-700 cursor-pointer bg-canvas rounded-control p-2.5">
            <input type="checkbox" className="accent-brand-700 mt-0.5" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />
            <span><b>Advantage+ audience</b> — let Meta find more people beyond your selections when it improves results. Recommended; your locations/age act as a guide. (Off automatically if you include a custom audience below.)</span>
          </label>

          <div className={field}>
            <p className={lbl}>Placements <span className="font-normal text-slate-400">(where your ad shows)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPlacements("advantage")} className={`text-left rounded-control border p-2.5 ${placements === "advantage" ? "border-brand-500 bg-brand-50" : "border-line"}`}><p className="text-xs font-bold text-ink-900">Advantage+ (auto)</p><p className="text-[10px] text-slate-500">Meta picks best spots (recommended)</p></button>
              <button onClick={() => setPlacements("manual")} className={`text-left rounded-control border p-2.5 ${placements === "manual" ? "border-brand-500 bg-brand-50" : "border-line"}`}><p className="text-xs font-bold text-ink-900">Manual</p><p className="text-[10px] text-slate-500">Pick platforms &amp; positions yourself</p></button>
            </div>
            {placements === "manual" && (
              <div className="mt-1.5 space-y-2.5">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Platforms</p>
                  <div className="flex flex-wrap gap-1.5">
                    {AD_PLATFORMS.map(([k, l]) => (
                      <button key={k} onClick={() => togglePlatform(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${platforms.includes(k) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{l}</button>
                    ))}
                  </div>
                </div>
                {/* Per-platform positions — Feed / Stories / Reels / … */}
                {AD_PLATFORMS.filter(([k]) => platforms.includes(k)).map(([k, l]) => (
                  <div key={k} className="rounded-control border border-line p-2">
                    <p className="text-[10px] font-bold text-ink-700 mb-1">{l} placements</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PLATFORM_POSITIONS[k].map(([val, label]) => {
                        const on = (positions[k] ?? allPositions(k)).includes(val);
                        return <button key={val} onClick={() => togglePosition(k, val)} className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-400"}`}>{label}</button>;
                      })}
                    </div>
                  </div>
                ))}
                {platforms.length === 0 && <p className="text-[11px] text-amber-600">Pick at least one platform.</p>}
              </div>
            )}
          </div>

          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — custom audiences &amp; languages</summary>
            <div className="pt-2 space-y-3">
              {customAudiences.length > 0 && <>
                <div className={field}>
                  <p className={lbl}>Retarget — include people in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {customAudiences.map(a => (
                      <button key={a.id} onClick={() => { setIncludeAuds(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id]); setExcludeAuds(s => s.filter(x => x !== a.id)); }} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${includeAuds.includes(a.id) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{a.name}</button>
                    ))}
                  </div>
                </div>
                <div className={field}>
                  <p className={lbl}>Suppress — exclude people in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {customAudiences.map(a => (
                      <button key={a.id} onClick={() => { setExcludeAuds(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id]); setIncludeAuds(s => s.filter(x => x !== a.id)); }} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${excludeAuds.includes(a.id) ? "border-red-300 bg-red-50 text-red-600" : "border-line text-slate-500"}`}>{a.name}</button>
                    ))}
                  </div>
                </div>
              </>}
              <div className={field}>
                <p className={lbl}>Languages <span className="font-normal text-slate-400">(optional — empty = all)</span></p>
                <TargetPicker kind="locale" picked={languages} onPick={x => setLanguages(g => g.some(y => y.key === x.key) ? g : [...g, x])} onRemove={k => setLanguages(g => g.filter(x => x.key !== k))} placeholder="Search languages — e.g. English, Hindi…" />
              </div>
            </div>
          </details>
        </>}

        {step === 4 && <>
          <div className={field}>
            <p className={lbl}>Format</p>
            <div className="grid grid-cols-3 gap-2">
              {([["single", "Single image", ImageIcon], ["video", "Video", Video], ["carousel", "Carousel", GalleryHorizontalEnd]] as const).map(([k, l, Ic]) => (
                <button key={k} onClick={() => setCreativeFormat(k)} className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-control border text-[11px] font-bold ${creativeFormat === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500 hover:border-slate-300"}`}>
                  <Ic className="w-4 h-4" /> {l}
                </button>
              ))}
            </div>
          </div>

          {creativeFormat === "single" && (
            <div className={field}>
              <p className={lbl}>Image <span className="font-normal text-slate-400">(recommended — 1080×1080)</span></p>
              <label className={`flex items-center gap-2 px-3 py-2.5 rounded-control border border-dashed border-slate-300 text-sm cursor-pointer hover:border-brand-500 ${uploading ? "opacity-60" : ""}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {imageHash ? `✓ ${imageName} — click to replace` : "Upload ad image"}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
          )}

          {creativeFormat === "video" && (
            <div className={field}>
              <p className={lbl}>Video <span className="font-normal text-slate-400">(MP4/MOV · square or vertical works best)</span></p>
              <label className={`flex items-center gap-2 px-3 py-2.5 rounded-control border border-dashed border-slate-300 text-sm cursor-pointer hover:border-brand-500 ${uploading ? "opacity-60" : ""}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {videoId ? `✓ ${videoName} — click to replace` : "Upload video"}
                <input type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadVideo(f); e.currentTarget.value = ""; }} />
              </label>
              <p className="text-[11px] text-slate-400">Meta processes the video after upload — it may take a minute before it can go live. A thumbnail is auto-generated.</p>
            </div>
          )}

          {creativeFormat === "carousel" && (
            <div className={field}>
              <p className={lbl}>Cards <span className="font-normal text-slate-400">(2–10 · each a swipeable image + headline)</span></p>
              <div className="space-y-2">
                {cards.map((c, i) => (
                  <div key={i} className="rounded-control border border-line p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500">Card {i + 1}</span>
                      {cards.length > 2 && <button onClick={() => setCards(cs => cs.filter((_, x) => x !== i))} className="text-[11px] font-bold text-red-500 hover:text-red-600">Remove</button>}
                    </div>
                    <div className="flex gap-2">
                      <label className={`shrink-0 w-16 h-16 rounded-control border border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:border-brand-500 overflow-hidden ${cardUploading === i ? "opacity-60" : ""}`}>
                        {cardUploading === i ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          // eslint-disable-next-line @next/next/no-img-element
                          : c.imagePreview ? <img src={c.imagePreview} alt="" className="w-full h-full object-cover" />
                          : <UploadCloud className="w-4 h-4 text-slate-400" />}
                        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCardImage(i, f); e.currentTarget.value = ""; }} />
                      </label>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <input className={`${inp} w-full`} placeholder={`Card ${i + 1} headline`} value={c.headline} onChange={e => setCards(cs => cs.map((x, y) => y === i ? { ...x, headline: e.target.value } : x))} />
                        <input className={`${inp} w-full`} placeholder="Description (optional)" value={c.description} onChange={e => setCards(cs => cs.map((x, y) => y === i ? { ...x, description: e.target.value } : x))} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {cards.length < 10 && (
                <button onClick={() => setCards(cs => [...cs, { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" }])} className="text-[11px] font-bold text-brand-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add card</button>
              )}
            </div>
          )}
          <div className={field}>
            <p className={lbl}>Primary text — the message above the image</p>
            <textarea className={`${inp} w-full resize-none`} rows={3} placeholder={"e.g. Confused which Data Science course fits your career? Chat with our counsellor on WhatsApp — free guidance, instant replies."} value={primaryText} onChange={e => setPrimaryText(e.target.value)} />
          </div>
          <div className={field}>
            <p className={lbl}>Headline — bold line next to the button</p>
            <input className={`${inp} w-full`} placeholder="e.g. Talk to a course counsellor" value={headline} onChange={e => setHeadline(e.target.value)} />
          </div>
          <p className="text-[11px] text-slate-400">
            {destination === "WHATSAPP" ? <>Button is <b>“Send WhatsApp message”</b> → opens a chat with your number; the lead lands in Live Chat stamped with this ad.</>
            : destination === "MESSENGER" ? <>Button is <b>“Send message”</b> → opens a Messenger chat.</>
            : destination === "INSTANT_FORM" ? <>Button is <b>“Sign up”</b> → opens your lead form inside the ad.</>
            : <>Button is <b>“{WEB_CTAS.find(c => c[0] === ctaType)?.[1]}”</b> → sends people to your website.</>}
          </p>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — description &amp; tracking</summary>
            <div className="pt-2 space-y-2">
              <div className={field}>
                <p className={lbl}>Description <span className="font-normal text-slate-400">(small text under the headline)</span></p>
                <input className={`${inp} w-full`} placeholder="e.g. Free 90-min session · limited seats" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className={field}>
                <p className={lbl}>URL tracking parameters <span className="font-normal text-slate-400">(UTM — for your analytics)</span></p>
                <input className={`${inp} w-full font-mono text-xs`} placeholder="utm_source=meta&utm_medium=paid&utm_campaign=ds_june" value={urlTags} onChange={e => setUrlTags(e.target.value)} />
              </div>
            </div>
          </details>
        </>}

        {step === 5 && <>
          <div className="bg-canvas rounded-control p-3 space-y-1 text-xs">
            <p><b className="text-ink-900">{name}</b> · {CONVERSION_LOCATIONS.find(c => c.key === destination)?.label}{destination === "WEBSITE" && pixelId ? ` (${PIXEL_EVENTS.find(e => e[0] === conversionEvent)?.[1]})` : ""}{specialCats.length ? ` · ${specialCats.length} special category` : ""}</p>
            <p className="text-slate-500">🎯 {OBJECTIVES.find(o => o.key === objective)?.label} · {budgetLevel === "campaign" ? "CBO" : "ABO"} · {sym}{budget} {budgetType === "lifetime" ? `total until ${endDate || "—"}` : "/day"} · {BID_STRATEGIES.find(b => b.key === bidStrategy)?.label}</p>
            <p className="text-slate-500">📍 {locations.map(l => l.kind === "radius" ? `${l.name} (${l.radius ?? 10}km)` : l.name).join(", ") || "—"} · age {ageMin}–{ageMax} · {gender}{interests.length ? ` · ${interests.map(i => i.name).join(", ")}` : ""}{languages.length ? ` · ${languages.map(l => l.name).join(", ")}` : ""}{includeAuds.length ? ` · +${includeAuds.length} audience` : ""}{excludeAuds.length ? ` · −${excludeAuds.length} excluded` : ""}{advantage && !includeAuds.length ? " · Advantage+" : ""} · {placements === "manual" ? platforms.join(", ") : "auto placements"}</p>
            <p className="text-slate-500">🖼 {creativeFormat === "video" ? (videoId ? `Video · ${videoName}` : "no video") : creativeFormat === "carousel" ? `Carousel · ${cards.filter(c => c.imageHash).length}/${cards.length} cards ready` : (imageHash ? imageName : "no image")} · “{headline}”{description ? ` · ${description}` : ""}</p>
            <p className="text-slate-500 line-clamp-2">{primaryText}</p>
          </div>

          {destination === "WHATSAPP" && (
            <div className="rounded-control border border-line p-3 space-y-2">
              <p className={lbl}>🤖 Auto-start a chatbot flow <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="text-[11px] text-slate-500">When a lead messages from this ad, run a flow automatically — no keyword needed. Off-script replies still fall through to the AI.</p>
              <select className={`${inp} w-full`} value={flowId} onChange={e => setFlowId(e.target.value)}>
                <option value="">No flow — AI / keyword handles it</option>
                {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {flows.length === 0 && <p className="text-[11px] text-slate-400">No active flows yet — build one in Chatbot Flows, then come back.</p>}
              {flowId && (
                <div className="flex gap-2">
                  {([["campaign", "Whole campaign"], ["ad", "Just this ad"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setFlowScope(k)} className={`flex-1 px-2.5 py-1.5 rounded-control border text-[11px] font-bold ${flowScope === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-ink-700 cursor-pointer">
            <input type="checkbox" className="accent-brand-700 mt-0.5" checked={activate} onChange={e => setActivate(e.target.checked)} />
            <span><b>Launch live immediately.</b> Unchecked (recommended): created <b>PAUSED</b> so you can preview first, then Resume.</span>
          </label>
        </>}

        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{err}</p>}

        <div className="flex items-center justify-between pt-1">
          <button onClick={() => step > 1 ? setStep(step - 1) : onClose()} className="px-3 py-2 text-xs font-bold text-ink-600 hover:text-ink-900">{step > 1 ? "← Back" : "Cancel"}</button>
          {step < TOTAL
            ? <button disabled={!canNext} onClick={() => setStep(step + 1)} className="px-4 py-2 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50">Continue →</button>
            : <button disabled={creating || !hasPage} onClick={create} className="px-4 py-2 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} {activate ? "Create & go live" : "Create (paused)"}
              </button>}
        </div>
    </div>

    {/* ── Live preview pane ── */}
    <aside className="hidden lg:block w-[380px] shrink-0 sticky top-2 space-y-3">
      {step === 3
        ? <AudienceDefinition estimate={estimate} loading={estimateLoading} err={estimateErr}
            locations={locations} ageMin={ageMin} ageMax={ageMax} gender={gender} interests={interests} languages={languages}
            includeAuds={includeAuds} excludeAuds={excludeAuds} advantage={advantage} />
        : <AdMockPreview placement={placement} setPlacement={setPlacement}
            format={creativeFormat} imageUrl={imagePreview} videoUrl={videoPreview}
            cards={cards.map(c => ({ imageUrl: c.imagePreview, headline: c.headline, description: c.description }))}
            primaryText={primaryText} headline={headline} description={description} ctaLabel={ctaLabel}
            realPreviews={realPreviews} previewLoading={previewLoading} previewErr={previewErr} mediaReady={mediaReady} />}
      <div className="bg-white rounded-card border border-line p-4 space-y-1.5">
        <p className="text-[11px] font-bold text-slate-400 uppercase">What Meta will do</p>
        <p className="text-xs text-ink-700"><b>Goal:</b> {perfGoal}</p>
        <p className="text-xs text-ink-700"><b>Sends to:</b> {CONVERSION_LOCATIONS.find(c => c.key === destination)?.label}{destination === "WEBSITE" && websiteUrl ? ` · ${websiteUrl}` : ""}</p>
        <p className="text-xs text-ink-700"><b>Budget:</b> {sym}{budget || "0"} {budgetType === "lifetime" ? "total" : "/day"} · {budgetLevel === "campaign" ? "CBO" : "ABO"}</p>
        <p className="text-xs text-ink-700"><b>Audience:</b> {locations.map(l => l.name).join(", ") || "—"} · {ageMin}–{ageMax} · {gender}{advantage && !includeAuds.length ? " · Advantage+" : ""}</p>
        <p className="text-[11px] text-slate-400 pt-1">Preview is an approximation — real rendering varies slightly by placement and device.</p>
      </div>
    </aside>
    </div>
  );
}

// ── Audience definition — Meta's narrow↔broad gauge + live size estimate ──────
function AudienceDefinition({ estimate, loading, err, locations, ageMin, ageMax, gender, interests, languages, includeAuds, excludeAuds, advantage }: {
  estimate: { lower?: number; upper?: number } | null; loading?: boolean; err?: string | null;
  locations: LocationItem[]; ageMin: number; ageMax: number; gender: string; interests: TargetItem[]; languages: TargetItem[];
  includeAuds: string[]; excludeAuds: string[]; advantage: boolean;
}) {
  const fmt = (n?: number) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
  // Broadness drives the gauge. Prefer the real estimate (audience size on a log
  // scale: ~30k → narrow, ~30M → broad); fall back to a constraint heuristic.
  const mid = estimate && (estimate.lower != null || estimate.upper != null)
    ? ((estimate.lower ?? estimate.upper ?? 0) + (estimate.upper ?? estimate.lower ?? 0)) / 2
    : null;
  const heuristicNarrow = Math.min(1, (interests.length ? 0.3 : 0) + (gender !== "all" ? 0.15 : 0) + (locations.some(l => l.kind === "radius") ? 0.25 : 0) + (ageMax - ageMin < 20 ? 0.15 : 0) + (includeAuds.length ? 0.3 : 0) + (languages.length ? 0.1 : 0));
  const broadness = mid && mid > 0
    ? Math.min(1, Math.max(0, (Math.log10(mid) - 4.3) / 3.2))   // 10^4.3≈20k narrow … 10^7.5≈32M broad
    : 1 - heuristicNarrow;
  const tier = broadness > 0.62 ? "broad" : broadness < 0.3 ? "specific" : "defined";
  const pos = `${Math.round(broadness * 100)}%`;
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5">Audience definition {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}</p>
      <p className="text-xs text-ink-700">Your audience is <b>{tier}</b>.</p>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {tier === "broad" ? "Broad audiences let Meta find the people most likely to respond — usually a lower cost per result for cold prospecting."
          : tier === "specific" ? "A tight audience can raise cost per result and slow learning. Widen the radius / age, or remove some filters if delivery stalls."
          : "A balanced audience — enough signal for Meta to optimise without over-restricting reach."}
      </p>
      {/* gauge */}
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-rose-200 via-amber-200 to-emerald-500">
        <div className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-ink-900 -translate-x-1/2" style={{ left: pos }} />
      </div>
      <div className="flex justify-between text-[10px] font-semibold text-slate-400"><span>Narrow</span><span>Broad</span></div>

      <div className="border-t border-line pt-2.5">
        {err
          ? <p className="text-[11px] text-amber-600">{err}</p>
          : <p className="text-xs text-ink-800"><b>Estimated audience size:</b> {loading && !estimate ? "calculating…" : estimate ? `${fmt(estimate.lower)} – ${fmt(estimate.upper)}` : "—"}</p>}
        <p className="text-[10px] text-slate-400 pt-1">Estimates don&apos;t include Advantage+ expansion{advantage ? " (on)" : ""} and vary over time.</p>
      </div>

      <div className="border-t border-line pt-2.5 space-y-0.5 text-[11px] text-slate-500">
        <p>📍 {locations.filter(l => l.kind === "country").map(l => l.name).join(", ") || "—"}</p>
        {locations.some(l => l.kind === "radius") && <p>🧭 {locations.filter(l => l.kind === "radius").map(l => `${l.name} (${l.radius ?? 10}km)`).join(", ")}</p>}
        <p>👤 Age {ageMin}–{ageMax} · {gender}{languages.length ? ` · ${languages.map(l => l.name).join(", ")}` : ""}</p>
        {interests.length > 0 && <p>🎯 {interests.map(i => i.name).join(", ")}</p>}
        {includeAuds.length > 0 && <p>➕ {includeAuds.length} custom audience{includeAuds.length > 1 ? "s" : ""}</p>}
        {excludeAuds.length > 0 && <p>➖ {excludeAuds.length} excluded</p>}
      </div>
    </div>
  );
}

// Live ad mock — renders the creative as it appears in Facebook/Instagram feed
// and Instagram story, from the wizard inputs (no API round-trip).
function AdMockPreview({ placement, setPlacement, format = "single", imageUrl, videoUrl, cards = [], primaryText, headline, description, ctaLabel, realPreviews, previewLoading, previewErr, mediaReady }: {
  placement: string; setPlacement: (p: string) => void;
  format?: "single" | "video" | "carousel"; imageUrl: string | null; videoUrl?: string | null;
  cards?: { imageUrl: string | null; headline: string; description: string }[];
  primaryText: string; headline: string; description: string; ctaLabel: string;
  realPreviews?: { key: string; label: string; html: string }[] | null; previewLoading?: boolean; previewErr?: string | null; mediaReady?: boolean;
}) {
  // ── Real Meta render: when generatepreviews returned iframes, show the exact
  // placement render Facebook/Instagram use, scaled to fit the pane. ──────────
  if (realPreviews?.length) {
    const active = realPreviews.find(p => p.key === placement) ?? realPreviews[0];
    const m = active.html.match(/width=["']?(\d+)["']?[\s\S]*?height=["']?(\d+)["']?/i);
    const w = m ? Number(m[1]) : 360;
    const h = m ? Number(m[2]) : 620;
    // Fit within the pane both ways so tall (Reels/Story) renders aren't clipped.
    const scale = Math.min(1, 348 / w, 600 / h);
    return (
      <div className="bg-white rounded-card border border-line p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-brand-700 uppercase flex items-center gap-1">{previewLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleCheck className="w-3 h-3" />} Live from Meta</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {realPreviews.map(p => <button key={p.key} onClick={() => setPlacement(p.key)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${placement === p.key ? "bg-ink-950 text-white" : "bg-canvas text-slate-500"}`}>{p.label}</button>)}
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-canvas mx-auto" style={{ width: Math.ceil(w * scale), height: Math.ceil(h * scale) }}>
          <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: active.html }} />
        </div>
        <p className="text-[11px] text-slate-400">Rendered by Meta — exactly how it appears in {active.label}.</p>
      </div>
    );
  }
  // Otherwise: instant hand-drawn mock (renders live as you type, before media uploads).
  // A freshly-uploaded video is a blob: URL (playable); a reopened draft only has
  // Meta's thumbnail (an http image), so render that as an image instead.
  const videoIsBlob = !!videoUrl && videoUrl.startsWith("blob:");
  // The media block shown inside feed previews — image, video, or carousel strip.
  const media = format === "video"
    ? (videoUrl
        ? (videoIsBlob
            ? <video src={videoUrl} className="w-full aspect-square object-cover bg-black" autoPlay muted loop playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={videoUrl} alt="" className="w-full aspect-square object-cover bg-black" />)
        : <div className="w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-xs">Your video appears here</div>)
    : format === "carousel"
    ? <div className="flex gap-1.5 overflow-x-auto p-1.5 bg-canvas snap-x">
        {cards.map((c, i) => (
          <div key={i} className="shrink-0 w-[120px] snap-start rounded-md border border-line overflow-hidden bg-white">
            {c.imageUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.imageUrl} alt="" className="w-full aspect-square object-cover" />
              : <div className="w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-[10px]">Card {i + 1}</div>}
            <div className="px-1.5 py-1"><p className="text-[10px] font-bold text-ink-900 truncate">{c.headline || `Card ${i + 1}`}</p>{c.description && <p className="text-[9px] text-slate-400 truncate">{c.description}</p>}</div>
          </div>
        ))}
      </div>
    : (imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageUrl} alt="" className="w-full object-cover" />
        : <div className="w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-xs">Your image appears here</div>);
  const img = media;
  const storyMedia = format === "video" && videoUrl;
  const tabs: [typeof placement, string][] = [["fb_feed", "Facebook"], ["ig_feed", "Instagram"], ["ig_story", "Story"], ["ig_reels", "Reels"]];
  const vBg = format === "carousel" ? cards[0]?.imageUrl : imageUrl;
  return (
    <div className="bg-white rounded-card border border-line p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1">{previewLoading && <Loader2 className="w-3 h-3 animate-spin" />} Preview</p>
        <div className="flex gap-1">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setPlacement(k)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${placement === k ? "bg-ink-950 text-white" : "bg-canvas text-slate-500"}`}>{l}</button>)}
        </div>
      </div>
      {!mediaReady
        ? <p className="text-[11px] text-slate-400">{format === "video" ? "Upload a video" : format === "carousel" ? "Add 2+ card images" : "Upload an image"} to see the exact Meta render. Showing a quick mock for now.</p>
        : previewErr
        ? <p className="text-[11px] text-amber-600">Meta render unavailable ({previewErr}). Showing a quick mock.</p>
        : previewLoading
        ? <p className="text-[11px] text-slate-400">Rendering the real Meta preview…</p>
        : null}

      {placement === "ig_reels" ? (
        /* ── Instagram Reels ── */
        <div className="relative mx-auto w-[210px] h-[373px] rounded-xl overflow-hidden bg-ink-950">
          {storyMedia
            ? (videoIsBlob
              ? <video src={videoUrl!} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop playsInline />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={videoUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />)
            : vBg
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={vBg as string} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 bg-gradient-to-br from-brand-500 to-brand-900 flex items-center justify-center"><span className="text-[10px] text-white/60">Your reel appears here</span></div>}
          {/* top label */}
          <div className="absolute top-2 left-2.5 text-[11px] font-bold text-white drop-shadow">Reels</div>
          {/* right action rail */}
          <div className="absolute right-2 bottom-20 flex flex-col items-center gap-3.5 text-white">
            <Heart className="w-5 h-5 drop-shadow" /><MessageCircle className="w-5 h-5 drop-shadow" /><Send className="w-5 h-5 drop-shadow" /><MoreHorizontal className="w-5 h-5 drop-shadow" />
          </div>
          {/* bottom info + CTA */}
          <div className="absolute inset-x-0 bottom-0 pt-10 pb-2.5 px-2.5 pr-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[1.5px]"><div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-brand-700" /></div>
              <span className="text-[10px] font-bold text-white drop-shadow truncate">yourpage</span><span className="text-[9px] text-white/70 shrink-0">· Sponsored</span>
            </div>
            {primaryText && <p className="text-[10px] text-white/90 drop-shadow line-clamp-2">{primaryText}</p>}
            <div className="bg-white rounded-md flex items-center justify-between gap-1 text-[11px] font-bold text-ink-900 px-2.5 py-1.5"><span className="truncate">{ctaLabel}</span><ChevronRight className="w-3.5 h-3.5 shrink-0 text-ink-500" /></div>
          </div>
        </div>
      ) : placement === "ig_story" ? (
        /* ── Instagram Story ── */
        <div className="relative mx-auto w-[210px] h-[373px] rounded-xl overflow-hidden bg-ink-950">
          {storyMedia
            ? (videoIsBlob
              ? <video src={videoUrl!} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop playsInline />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={videoUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />)
            : (format === "carousel" ? cards[0]?.imageUrl : imageUrl)
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={(format === "carousel" ? cards[0]?.imageUrl : imageUrl) as string} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 bg-gradient-to-br from-brand-500 to-brand-900" />}
          <div className="absolute top-1.5 left-2 right-2 h-0.5 rounded-full bg-white/40"><div className="h-full w-1/3 rounded-full bg-white" /></div>
          <div className="absolute top-3.5 left-2 right-2 flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[1.5px]"><div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-brand-700" /></div>
            <span className="text-[10px] font-bold text-white drop-shadow">yourpage</span><span className="text-[9px] text-white/70">Sponsored</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 pt-10 pb-3 px-2.5 bg-gradient-to-t from-black/70 via-black/30 to-transparent space-y-2">
            {primaryText && <p className="text-[10px] text-white/90 drop-shadow line-clamp-2 text-center">{primaryText}</p>}
            <div className="bg-white rounded-full flex items-center justify-center gap-1 text-[11px] font-bold text-ink-900 py-2 px-3"><ChevronRight className="w-3 h-3 -rotate-90 shrink-0" /> <span className="truncate">{ctaLabel}</span></div>
          </div>
        </div>
      ) : placement === "ig_feed" ? (
        /* ── Instagram Feed ── */
        <div className="rounded-lg border border-line overflow-hidden bg-white">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[1.5px]"><div className="w-full h-full rounded-full bg-white p-[1.5px]"><div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-brand-700" /></div></div>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-ink-900 leading-tight">yourpage</p><p className="text-[9px] text-slate-400">Sponsored</p></div>
            <MoreHorizontal className="w-4 h-4 text-ink-700" />
          </div>
          {img}
          <button className="w-full flex items-center justify-between bg-canvas px-2.5 py-2 border-y border-line"><span className="text-[11px] font-bold text-ink-900">{ctaLabel}</span><ChevronRight className="w-3.5 h-3.5 text-ink-500" /></button>
          <div className="flex items-center gap-3 px-2.5 pt-2">
            <Heart className="w-4 h-4 text-ink-800" /><MessageCircle className="w-4 h-4 text-ink-800" /><Send className="w-4 h-4 text-ink-800" /><Bookmark className="w-4 h-4 text-ink-800 ml-auto" />
          </div>
          <div className="px-2.5 py-1.5">
            <p className="text-[11px] text-ink-800 line-clamp-3"><b>yourpage</b> {primaryText || "Your caption appears here — the hook that makes people stop scrolling."}</p>
          </div>
        </div>
      ) : (
        /* ── Facebook Feed ── */
        <div className="rounded-lg border border-line overflow-hidden bg-white">
          <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700" />
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-ink-900 leading-tight">Your Page</p><p className="text-[9px] text-slate-400">Sponsored · 🌐</p></div>
            <MoreHorizontal className="w-4 h-4 text-ink-500" />
          </div>
          <p className="text-[11px] text-ink-800 px-2.5 pb-2 whitespace-pre-wrap line-clamp-4">{primaryText || "Your primary text appears here — the hook that makes people stop scrolling."}</p>
          {img}
          <div className="flex items-center justify-between gap-2 bg-canvas px-2.5 py-2">
            <div className="min-w-0"><p className="text-[9px] text-slate-400 uppercase truncate">{description || "your site"}</p><p className="text-xs font-bold text-ink-900 truncate">{headline || "Your headline"}</p></div>
            <button className="shrink-0 text-[11px] font-bold bg-slate-200 text-ink-900 rounded-md px-2.5 py-1.5">{ctaLabel}</button>
          </div>
          <div className="flex items-center justify-around px-2.5 py-1.5 border-t border-line text-slate-500">
            <span className="flex items-center gap-1 text-[10px] font-semibold"><ThumbsUp className="w-3.5 h-3.5" /> Like</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold"><MessageCircle className="w-3.5 h-3.5" /> Comment</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold"><Reply className="w-3.5 h-3.5 -scale-x-100" /> Share</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dedicated ad detail view — full Meta analytics for one node + child cards ──
type NodeFull = {
  id: string; name: string; effectiveStatus: string; level: "campaign" | "adset" | "ad";
  objective: string | null; dailyBudget: number | null; thumbnailUrl: string | null;
  dateStart: string | null; dateStop: string | null;
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; uniqueClicks: number; linkClicks: number; ctr: number; cpc: number; cpm: number; cpp: number;
  conversations: number; costPerConversation: number | null;
  actions: { type: string; value: number }[]; costPerAction: { type: string; value: number }[];
};
type ChildRow = { id: string; name: string; effectiveStatus: string; thumbnailUrl?: string | null; dailyBudget?: number | null; optimizationGoal?: string; spend: number; clicks: number; ctr: number; conversations: number };

const ACTION_LABELS_META: Record<string, string> = {
  link_click: "Link clicks", landing_page_view: "Landing page views", post_engagement: "Post engagement",
  page_engagement: "Page engagement", post_reaction: "Reactions", comment: "Comments", onsite_conversion_post_save: "Saves",
  video_view: "Video views", lead: "Leads", purchase: "Purchases", "onsite_conversion.messaging_conversation_started_7d": "WhatsApp conversations",
  messaging_conversation_started_7d: "WhatsApp conversations", "onsite_conversion.messaging_first_reply": "WhatsApp first replies",
};
function humanizeAction(t: string): string {
  return ACTION_LABELS_META[t] ?? t.replace(/^onsite_conversion\./, "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
}

function AdNodeDetail({ node, preset, currency, isAdmin, onBack, onOpen }: {
  node: { level: "campaign" | "adset" | "ad"; id: string; name: string };
  preset: "today" | "last_7d" | "last_30d"; currency: string; isAdmin: boolean;
  onBack: () => void; onOpen: (level: "campaign" | "adset" | "ad", id: string, name: string) => void;
}) {
  const [full, setFull] = useState<NodeFull | null>(null);
  const [adsets, setAdsets] = useState<ChildRow[]>([]);
  const [ads, setAds] = useState<ChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; value: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const money = (n: number) => `${currency === "INR" ? "₹" : currency ? currency + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/meta/node?id=${node.id}&level=${node.level}&preset=${preset}`).then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else { setFull(d.node); setAdsets(d.adsets ?? []); setAds(d.ads ?? []); } })
      .catch(() => setErr("Could not load — an ad blocker may be active."))
      .finally(() => setLoading(false));
  }, [node.id, node.level, preset]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (node.level === "ad") fetch(`/api/admin/meta/preview?adId=${node.id}`).then(r => r.json()).then(d => setPreview(d.html ?? null)).catch(() => {}); }, [node.id, node.level]);

  async function act(id: string, action: "pause" | "resume" | "budget" | "duplicate", dailyBudget?: number) {
    setBusy(id);
    try {
      const d = await fetch("/api/admin/meta/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: id, action, dailyBudget }) }).then(r => r.json());
      if (d.error) setErr(d.error); else load();
    } finally { setBusy(""); setBudgetEdit(null); }
  }

  const statusPill = (s: string) => s === "ACTIVE" ? "bg-brand-100 text-brand-700" : s === "PAUSED" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700";
  const levelLabel = node.level === "campaign" ? "Campaign" : node.level === "adset" ? "Ad set" : "Ad";
  const childLevel: "adset" | "ad" = node.level === "campaign" ? "adset" : "ad";

  // The metric tiles — everything Meta reports, grouped reach → clicks → cost.
  const tiles: { label: string; value: string; hint?: string }[] = full ? [
    { label: "Amount spent", value: money(full.spend) },
    { label: "Impressions", value: full.impressions.toLocaleString() },
    { label: "Reach", value: full.reach.toLocaleString(), hint: "unique people" },
    { label: "Frequency", value: full.frequency ? full.frequency.toFixed(2) : "—", hint: "times each saw it" },
    { label: "Clicks (all)", value: full.clicks.toLocaleString() },
    { label: "Link clicks", value: full.linkClicks.toLocaleString() },
    { label: "Unique clicks", value: full.uniqueClicks.toLocaleString() },
    { label: "CTR", value: full.ctr ? `${full.ctr.toFixed(2)}%` : "—", hint: "click-through rate" },
    { label: "CPC", value: full.cpc ? money(full.cpc) : "—", hint: "per click" },
    { label: "CPM", value: full.cpm ? money(full.cpm) : "—", hint: "per 1,000 impressions" },
    { label: "WhatsApp chats", value: full.conversations.toLocaleString() },
    { label: "Cost / chat", value: full.costPerConversation != null ? money(full.costPerConversation) : (full.conversations ? money(full.spend / full.conversations) : "—") },
  ] : [];

  const childCard = (c: ChildRow, kind: "adset" | "ad") => {
    const cpr = c.conversations > 0 ? { l: "per chat", v: money(c.spend / c.conversations) } : c.clicks > 0 ? { l: "per click", v: money(c.spend / c.clicks) } : { l: "results", v: "—" };
    const wasteful = c.effectiveStatus === "ACTIVE" && c.spend > 100 && c.conversations === 0 && c.clicks === 0;
    return (
      <div key={c.id} className={`rounded-card border p-3 text-left transition-colors ${wasteful ? "border-amber-200 bg-amber-50/40" : "border-line bg-white hover:border-brand-400"}`}>
        <button onClick={() => onOpen(kind, c.id, c.name)} className="w-full text-left">
          <div className="flex items-center gap-2 mb-2">
            {kind === "ad" && (c.thumbnailUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.thumbnailUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
              : <div className="w-7 h-7 rounded bg-canvas shrink-0" />)}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-ink-900 truncate">{c.name}</p>
              {kind === "adset" && <p className="text-[10px] text-slate-400 truncate">{c.optimizationGoal}{c.dailyBudget != null ? ` · ${money(c.dailyBudget)}/day` : ""}</p>}
            </div>
            {wasteful && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full shrink-0">REVIEW</span>}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${statusPill(c.effectiveStatus)}`}>{c.effectiveStatus}</span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {[["spend", money(c.spend)], ["clicks", c.clicks.toLocaleString()], ["chats", c.conversations.toLocaleString()], [cpr.l, cpr.v]].map(([l, v]) => (
              <div key={l} className="bg-canvas rounded-control py-1">
                <p className="text-xs font-bold text-ink-900">{v}</p>
                <p className="text-[9px] text-slate-400 font-semibold uppercase">{l}</p>
              </div>
            ))}
          </div>
        </button>
        {isAdmin && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-line text-[11px]">
            <button disabled={busy === c.id} onClick={() => act(c.id, c.effectiveStatus === "ACTIVE" ? "pause" : "resume")} className="font-bold text-ink-600 hover:text-brand-700">{c.effectiveStatus === "ACTIVE" ? "Pause" : "Resume"}</button>
            {kind === "adset" && c.dailyBudget != null && (budgetEdit?.id === c.id
              ? <span className="flex items-center gap-1"><input className="border border-line rounded-control px-1.5 py-0.5 w-16 bg-white" autoFocus value={budgetEdit.value} onChange={e => setBudgetEdit({ id: c.id, value: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && Number(budgetEdit.value) > 0) act(c.id, "budget", Number(budgetEdit.value)); if (e.key === "Escape") setBudgetEdit(null); }} /><button onClick={() => Number(budgetEdit.value) > 0 && act(c.id, "budget", Number(budgetEdit.value))} className="font-bold text-brand-700">Save</button></span>
              : <button onClick={() => setBudgetEdit({ id: c.id, value: String(c.dailyBudget) })} className="font-bold text-brand-700 hover:underline">budget</button>)}
            <span className="text-slate-300">·</span>
            <button onClick={() => onOpen(kind, c.id, c.name)} className="font-bold text-brand-700 hover:underline">Open →</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs font-bold text-brand-700 flex items-center gap-1 hover:gap-1.5 transition-all"><ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns</button>

      {err && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">{err}</div>}

      {loading && !full ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : full && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-slate-400 uppercase">{levelLabel}{full.objective ? ` · ${full.objective.toLowerCase().replace(/_/g, " ")}` : ""}</p>
              <h3 className="text-lg font-extrabold text-ink-900">{full.name}</h3>
              <p className="text-[11px] text-slate-400">{full.dateStart && full.dateStop ? `${full.dateStart} → ${full.dateStop}` : ""}{full.dailyBudget != null ? ` · ${money(full.dailyBudget)}/day` : ""}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${statusPill(full.effectiveStatus)}`}>{full.effectiveStatus}</span>
              {isAdmin && <button disabled={busy === full.id} onClick={() => act(full.id, full.effectiveStatus === "ACTIVE" ? "pause" : "resume")} className="px-3 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas">{full.effectiveStatus === "ACTIVE" ? "Pause" : "Resume"}</button>}
              {isAdmin && node.level === "campaign" && <button disabled={busy === full.id} onClick={() => { if (confirm(`Duplicate "${full.name}"? The copy is created PAUSED.`)) act(full.id, "duplicate"); }} className="px-2 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas"><Copy className="w-3 h-3" /></button>}
            </div>
          </div>

          {/* Full metric grid */}
          <div className="grid grid-cols-4 gap-2">
            {tiles.map(t => (
              <div key={t.label} className="bg-white border border-line rounded-card p-3">
                <p className="text-base font-extrabold text-ink-900 truncate">{t.value}</p>
                <p className="text-[10px] text-slate-500 font-semibold">{t.label}</p>
                {t.hint && <p className="text-[9px] text-slate-400">{t.hint}</p>}
              </div>
            ))}
          </div>

          {/* All actions Meta tracked */}
          {full.actions.length > 0 && (
            <section className="bg-white rounded-card border border-line p-4">
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">All results Meta tracked</p>
              <div className="divide-y divide-line">
                <div className="grid grid-cols-[1fr_5rem_6rem] gap-2 py-1 text-[10px] font-bold text-slate-400 uppercase"><span>Action</span><span className="text-right">Count</span><span className="text-right">Cost each</span></div>
                {full.actions.map(a => {
                  const cost = full.costPerAction.find(c => c.type === a.type)?.value;
                  return (
                    <div key={a.type} className="grid grid-cols-[1fr_5rem_6rem] gap-2 py-1.5 text-sm">
                      <span className="text-ink-900 truncate">{humanizeAction(a.type)}</span>
                      <span className="text-right font-semibold">{a.value.toLocaleString()}</span>
                      <span className="text-right text-slate-500">{cost != null ? money(cost) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Ad preview (ad level) */}
          {node.level === "ad" && (
            <section className="bg-white rounded-card border border-line p-4">
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">Ad preview</p>
              {preview ? <div className="overflow-auto" dangerouslySetInnerHTML={{ __html: preview }} /> : <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
            </section>
          )}

          {/* Child cards */}
          {node.level !== "ad" && (
            <>
              {node.level === "campaign" && (
                <section className="space-y-2">
                  <p className="text-[11px] font-bold text-slate-400 uppercase">Ad sets ({adsets.length}) — click to drill in</p>
                  <div className="grid grid-cols-2 gap-2">{[...adsets].sort((a, b) => b.spend - a.spend).map(s => childCard(s, "adset"))}</div>
                  {adsets.length === 0 && <p className="text-[11px] text-slate-400">No ad sets.</p>}
                </section>
              )}
              <section className="space-y-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase">Ads ({ads.length}) — click to drill in</p>
                <div className="grid grid-cols-2 gap-2">{[...ads].sort((a, b) => b.spend - a.spend).map(a => childCard(a, "ad"))}</div>
                {ads.length === 0 && <p className="text-[11px] text-slate-400">No ads.</p>}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Automated rules — the budget guardian, checked by the cron every ~5 minutes.
type AdRuleRow = { id: string; name: string; active: boolean; scopeCampaignId: string | null; metric: string; op: string; threshold: number; windowPreset: string; action: string; lastTriggeredAt: string | null; lastResult: string | null };

const RULE_METRICS: [string, string][] = [
  ["spend", "Spend"], ["cpc", "Cost per click"], ["ctr", "CTR %"], ["clicks", "Clicks"],
  ["conversations", "WhatsApp chats started"], ["leads", "Leads (our data)"], ["cost_per_lead", "Cost per lead (our data)"],
];
const RULE_WINDOWS: [string, string][] = [["today", "today"], ["last_7d", "last 7 days"], ["last_30d", "last 30 days"]];

function AdRulesPanel({ campaigns, isAdmin, currency }: { campaigns: { id: string; name: string }[]; isAdmin: boolean; currency: string }) {
  const [rules, setRules] = useState<AdRuleRow[] | null>(null);
  const [form, setForm] = useState<{ name: string; scopeCampaignId: string; metric: string; op: string; threshold: string; windowPreset: string; action: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { fetch("/api/admin/meta/rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => setRules([])); }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form || !form.name.trim() || !form.threshold.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta/rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, scopeCampaignId: form.scopeCampaignId || null, metric: form.metric, op: form.op, threshold: Number(form.threshold), windowPreset: form.windowPreset, action: form.action }),
      }).then(r => r.json());
      if (d.error) setMsg(d.error); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function toggle(r: AdRuleRow) {
    await fetch("/api/admin/meta/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, active: !r.active }) });
    load();
  }

  const metricLabel = (m: string) => RULE_METRICS.find(x => x[0] === m)?.[1] ?? m;
  const sentence = (r: AdRuleRow) =>
    `${r.action === "pause" ? "Pause" : "Alert"} ${r.scopeCampaignId ? (campaigns.find(c => c.id === r.scopeCampaignId)?.name ?? "one campaign") : "any campaign"} when ${metricLabel(r.metric).toLowerCase()} ${RULE_WINDOWS.find(w => w[0] === r.windowPreset)?.[1]} ${r.op === "gt" ? ">" : "<"} ${r.threshold}`;

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Automated rules — your budget guardian</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Checked every few minutes. Unlike Meta&apos;s rules, these can watch <b>your real leads</b> — e.g. pause anything that spends {currency === "INR" ? "₹" : ""}1,000 with zero leads.</p>
        </div>
        {isAdmin && <button onClick={() => { setForm({ name: "", scopeCampaignId: "", metric: "cost_per_lead", op: "gt", threshold: "", windowPreset: "today", action: "pause" }); setMsg(null); }} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold shrink-0"><Plus className="w-3.5 h-3.5 inline" /> Rule</button>}
      </div>

      {rules === null ? railLoading : rules.map(r => (
        <div key={r.id} className="flex items-center gap-2 border border-slate-100 rounded-control px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-ink-900">{r.name}</p>
            <p className="text-[11px] text-slate-500">{sentence(r)}</p>
            {r.lastResult && <p className="text-[10px] text-amber-700 truncate">Last: {r.lastResult}{r.lastTriggeredAt ? ` (${new Date(r.lastTriggeredAt).toLocaleString()})` : ""}</p>}
          </div>
          {isAdmin && <>
            <button onClick={() => toggle(r)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 ${r.active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{r.active ? "● ON" : "○ OFF"}</button>
            <button onClick={async () => { if (confirm(`Delete rule "${r.name}"?`)) { await fetch("/api/admin/meta/rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) }); load(); } }} className="p-1 text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </>}
        </div>
      ))}
      {rules !== null && rules.length === 0 && !form && <p className="text-xs text-slate-400">No rules yet — try: <i>pause any campaign when cost per lead today &gt; 500</i>.</p>}

      {form && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <input className={`${inp} w-full`} placeholder="Rule name — e.g. CPL guard" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
              <option value="pause">Pause the campaign</option>
              <option value="notify">Alert only (activity log)</option>
            </select>
            <select className={inp} value={form.scopeCampaignId} onChange={e => setForm({ ...form, scopeCampaignId: e.target.value })}>
              <option value="">…for any campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>only: {c.name}</option>)}
            </select>
            <select className={inp} value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}>
              {RULE_METRICS.map(([k, l]) => <option key={k} value={k}>when {l}</option>)}
            </select>
            <select className={inp} value={form.windowPreset} onChange={e => setForm({ ...form, windowPreset: e.target.value })}>
              {RULE_WINDOWS.map(([k, l]) => <option key={k} value={k}>window: {l}</option>)}
            </select>
            <select className={inp} value={form.op} onChange={e => setForm({ ...form, op: e.target.value })}>
              <option value="gt">is greater than</option>
              <option value="lt">is less than</option>
            </select>
            <input className={inp} type="number" placeholder="threshold (e.g. 500)" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy || !form.name.trim() || !form.threshold.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold disabled:opacity-50">{busy ? "Saving…" : "Save rule"}</button>
            <button onClick={() => setForm(null)} className="text-xs text-slate-400 font-bold">cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
    </section>
  );
}

// ── Settings: welcome + away messages, quick replies ──────────────────────────
type WelcomeS = { enabled: boolean; text: string };
type AwayS = { enabled: boolean; text: string; startHour: number; endHour: number; tzOffsetMinutes: number };

// ── Team members + activity log ──
type TeamUserRow = { id: string; email: string; name: string; title: string; role: "admin" | "member"; active: boolean; lastLoginAt: string | null };

function TeamManager() {
  const [users, setUsers] = useState<TeamUserRow[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; email: string; name: string; title: string; role: "admin" | "member"; password: string; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/team").then(r => r.json()).then(d => { setUsers(d.users ?? []); setOwner(d.owner ?? null); setNotice(d.notice ?? null); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form) return;
    if (!form.email.trim()) { setMsg("Email is required."); return; }
    if (!form.id && !form.password.trim()) { setMsg("Password is required for a new member."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(u: TeamUserRow) {
    if (!confirm(`Remove ${u.email}? They'll be signed out and can't log in again.`)) return;
    await fetch("/api/admin/team", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, email: u.email }) });
    load();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Team members</p>
          <p className="text-xs text-slate-500 mt-0.5">Everyone gets their own login. Admins can manage numbers, team, and settings; members get everything else (inbox, broadcasts, flows…). All actions are recorded in the activity log.</p>
        </div>
        <button onClick={() => { setForm({ email: "", name: "", title: "", role: "member", password: "", active: true }); setMsg(null); }}
          className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add member</button>
      </div>

      {notice && <p className="text-xs text-amber-700 bg-amber-50 rounded-control px-3 py-2">{notice} — apply migration <code className="font-mono">0014_team.sql</code>.</p>}

      {owner && (
        <div className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5 bg-canvas/50">
          <div className="w-8 h-8 rounded-full bg-ink-950 text-white flex items-center justify-center text-xs font-bold shrink-0">★</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{owner} <span className="text-[10px] font-bold text-brand-700">· OWNER</span></p>
            <p className="text-[11px] text-ink-400">The env account — always admin, managed via ADMIN_USER/ADMIN_PASSWORD</p>
          </div>
        </div>
      )}

      {users.map(u => (
        <div key={u.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${u.active ? "bg-brand-50 text-brand-700" : "bg-canvas text-ink-400"}`}>
            {(u.name || u.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">
              {u.name || u.email} <span className={`text-[10px] font-bold ${u.role === "admin" ? "text-brand-700" : "text-ink-400"}`}>· {u.role.toUpperCase()}</span>
              {!u.active && <span className="text-[10px] font-bold text-red-500"> · DISABLED</span>}
            </p>
            <p className="text-[11px] text-ink-400 truncate">{u.title ? `${u.title} · ` : ""}{u.email}{u.lastLoginAt ? ` · last login ${new Date(u.lastLoginAt).toLocaleString()}` : " · never logged in"}</p>
          </div>
          <button onClick={() => { setForm({ id: u.id, email: u.email, name: u.name, title: u.title ?? "", role: u.role, password: "", active: u.active }); setMsg(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(u)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {form && (
        <div className="border-2 border-brand-700/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="email@company.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={!!form.id} />
            <input className={inp} placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Role / persona — e.g. Sales Counsellor, Support Lead" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <select className={inp} value={form.role} onChange={e => setForm({ ...form, role: e.target.value as "admin" | "member" })}>
              <option value="member">Member — inbox, broadcasts, flows, templates</option>
              <option value="admin">Admin — everything incl. numbers & team</option>
            </select>
            <input className={inp} type="password" placeholder={form.id ? "New password (blank = keep current)" : "Password"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save member"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!users.length && !form && !notice && <p className="text-xs text-ink-400">No members yet — only the owner account can log in.</p>}
    </section>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in", "broadcast.send": "Sent broadcast", "broadcast.test": "Sent test message", "template.create": "Created template",
  "template.delete": "Deleted template", "form.create": "Created form", "form.publish": "Published form",
  "form.delete": "Deleted form", "form.deprecate": "Deprecated form", "flow.save": "Saved flow",
  "flow.delete": "Deleted flow", "inbox.reply": "Replied in inbox", "contacts.import": "Imported contacts",
  "channel.save": "Saved WhatsApp number", "channel.delete": "Removed WhatsApp number",
  "rule.save": "Saved API rule", "rule.toggle": "Toggled API rule", "rule.delete": "Deleted API rule",
  "settings.save": "Changed settings", "optout.add": "Added opt-out", "optout.remove": "Removed opt-out",
  "team.add": "Added team member", "team.update": "Updated team member", "team.remove": "Removed team member",
  "ads.connect": "Connected ad account", "ads.pause": "Paused ad campaign", "ads.resume": "Resumed ad campaign", "ads.budget": "Changed ad budget",
  "contact.update": "Updated contact",
};

function ActivityLog() {
  const [entries, setEntries] = useState<{ id: string; userEmail: string; userName: string; action: string; detail: string; at: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetch("/api/admin/activity?limit=200").then(r => r.json());
      setEntries(d.activity ?? []);
    } catch { /* keep last */ }
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Activity log</p>
          <p className="text-xs text-slate-500 mt-0.5">Who did what, newest first — logins, broadcasts, template/flow/form changes, inbox replies, settings.</p>
        </div>
        <button onClick={load} disabled={refreshing} className="shrink-0 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-line -mx-5 px-5">
        {entries.map(e => (
          <div key={e.id} className="py-2 flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
              {(e.userName || e.userEmail).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink-900">
                <span className="font-semibold">{e.userName || e.userEmail}</span>{" "}
                <span className="text-ink-600">{ACTION_LABELS[e.action] ?? e.action}</span>
                {e.detail && <span className="text-ink-400"> — {e.detail}</span>}
              </p>
              <p className="text-[11px] text-ink-400">{new Date(e.at).toLocaleString()}</p>
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="py-6 text-center text-xs text-ink-400">No activity recorded yet (needs migration 0014_team.sql).</p>}
      </div>
    </section>
  );
}

// ── WhatsApp numbers (multi-WABA channels) ──
const EMPTY_CHANNEL = { id: undefined as string | undefined, name: "", phoneId: "", wabaId: "", token: "", appId: "", agentId: "", active: true, isDefault: false };

function ChannelsManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [envMode, setEnvMode] = useState(false);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof EMPTY_CHANNEL | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [profileFor, setProfileFor] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setChannels(d.channels ?? []); setEnvMode(d.envMode ?? false);
    CHANNELS_CACHE = d.channels ?? [];     // keep the shared pickers in sync
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.phoneId.trim() || !form.wabaId.trim()) { setMsg("Name, Phone Number ID and WABA ID are required."); return; }
    if (!form.id && !form.token.trim()) { setMsg("Access token is required for a new number."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, agentId: form.agentId || null, appId: form.appId || null }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this number? Its conversations stay but will reply via the default credentials.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function connectWithMeta() {
    setBusy(true); setMsg(null);
    try {
      const { code, wabaId, phoneNumberId } = await launchWhatsAppSignup();
      const res = await fetch("/api/admin/onboarding/whatsapp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wabaId, phoneNumberId }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Connection failed");
      else { setForm(null); load(); }
    } catch (e) { setMsg(e instanceof Error ? e.message : "Connection cancelled"); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">WhatsApp numbers</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect multiple numbers/WABAs — each gets its own AI persona, flows, templates, and broadcasts. Inbound routes automatically; replies always leave from the same number.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {whatsappSignupReady() && (
            <button onClick={connectWithMeta} disabled={busy} className="px-3 py-1.5 rounded-control bg-[#0783fd] hover:bg-[#0668d6] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />} Connect with Facebook
            </button>
          )}
          <button onClick={() => { setForm({ ...EMPTY_CHANNEL }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add manually</button>
        </div>
      </div>

      {envMode && <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Currently running on the <code className="font-mono">META_WA_*</code> env credentials (single-number mode). Adding numbers here switches inbound routing to per-number.</p>}

      {channels.map(c => (
        <div key={c.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Phone className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{c.name} {c.isDefault && <span className="text-[10px] font-bold text-brand-700">· DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
            <p className="text-[11px] text-ink-400 font-mono truncate">phone {c.phoneId} · waba {c.wabaId} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
          </div>
          <button onClick={() => { setProfileFor(profileFor?.id === c.id ? null : { id: c.id, name: c.name }); setForm(null); }}
            className={`px-2.5 py-1 rounded-control border text-xs font-bold shrink-0 ${profileFor?.id === c.id ? "border-brand-700 text-brand-700 bg-brand-50" : "border-line text-ink-600 hover:bg-canvas"}`}>Profile</button>
          <button onClick={() => { setForm({ id: c.id, name: c.name, phoneId: c.phoneId, wabaId: c.wabaId, token: "", appId: c.appId ?? "", agentId: c.agentId ?? "", active: c.active, isDefault: c.isDefault }); setMsg(null); setProfileFor(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {profileFor && <BusinessProfileEditor key={profileFor.id} channelId={profileFor.id} name={profileFor.name} onClose={() => setProfileFor(null)} />}

      {form && (
        <div className="border-2 border-brand-700/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. Sales India" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Phone Number ID (Meta → API Setup)" value={form.phoneId} onChange={e => setForm({ ...form, phoneId: e.target.value.trim() })} />
            <input className={inp} placeholder="WABA ID" value={form.wabaId} onChange={e => setForm({ ...form, wabaId: e.target.value.trim() })} />
            <input className={inp} placeholder="Meta App ID (for template media)" value={form.appId} onChange={e => setForm({ ...form, appId: e.target.value.trim() })} />
          </div>
          <input className={`${inp} w-full font-mono`} placeholder={form.id ? "Access token — leave blank to keep the current one" : "System-user access token"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
          <div className="flex items-center gap-3 flex-wrap">
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this number">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> default for sends</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save number"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!channels.length && !form && !envMode && <p className="text-xs text-ink-400">No numbers connected yet.</p>}
    </section>
  );
}

// ── WhatsApp business profile editor (the connected number's own profile) ──────
const WA_VERTICAL_OPTS: { v: string; label: string }[] = [
  { v: "", label: "Industry: not set" },
  { v: "PROF_SERVICES", label: "Professional Services" }, { v: "EDU", label: "Education" },
  { v: "FINANCE", label: "Finance" }, { v: "HEALTH", label: "Health" }, { v: "RETAIL", label: "Retail" },
  { v: "APPAREL", label: "Apparel" }, { v: "BEAUTY", label: "Beauty" }, { v: "AUTO", label: "Automotive" },
  { v: "TRAVEL", label: "Travel" }, { v: "HOTEL", label: "Hotel" }, { v: "RESTAURANT", label: "Restaurant" },
  { v: "GROCERY", label: "Grocery" }, { v: "ENTERTAIN", label: "Entertainment" }, { v: "EVENT_PLAN", label: "Event Planning" },
  { v: "GOVT", label: "Government" }, { v: "NONPROFIT", label: "Non-profit" }, { v: "OTHER", label: "Other" },
];

function BusinessProfileEditor({ channelId, name, onClose }: { channelId: string; name: string; onClose: () => void }) {
  const [p, setP] = useState({ about: "", description: "", email: "", address: "", vertical: "", website: "" });
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/admin/channels/profile?channelId=${encodeURIComponent(channelId)}`)
      .then(r => r.json()).then(d => {
        if (d.profile) {
          setP({ about: d.profile.about ?? "", description: d.profile.description ?? "", email: d.profile.email ?? "", address: d.profile.address ?? "", vertical: d.profile.vertical ?? "", website: (d.profile.websites ?? [])[0] ?? "" });
          setPhotoUrl(d.profile.profilePictureUrl ?? "");
        } else if (d.notice) setMsg(d.notice);
      }).catch(() => setMsg("Could not load profile")).finally(() => setLoading(false));
  }, [channelId]);

  async function saveFields() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, about: p.about, description: p.description, email: p.email, address: p.address, vertical: p.vertical, websites: p.website ? [p.website] : [] }),
      });
      const d = await res.json();
      setMsg(res.ok ? "Saved ✓" : (d.error || "Save failed"));
    } finally { setBusy(false); }
  }

  async function uploadPhoto(file: File) {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("channelId", channelId);
      fd.append("file", file);
      const res = await fetch("/api/admin/channels/profile", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Photo upload failed"); return; }
      setMsg("Photo updated ✓ — refreshing…");
      const r = await fetch(`/api/admin/channels/profile?channelId=${encodeURIComponent(channelId)}`).then(x => x.json()).catch(() => null);
      if (r?.profile?.profilePictureUrl) setPhotoUrl(r.profile.profilePictureUrl);
    } finally { setBusy(false); }
  }

  return (
    <div className="border-2 border-brand-700/30 rounded-control p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900">Business profile — <span className="text-brand-700">{name}</span></p>
        <button onClick={onClose} className="text-xs font-semibold text-ink-400 hover:text-ink-900">Close</button>
      </div>
      {loading ? <p className="text-xs text-ink-400">Loading…</p> : (
        <>
          <div className="flex items-center gap-3">
            <ConvAvatar url={photoUrl} label={name} size={56} />
            <div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Change photo</button>
              <p className="text-[10px] text-ink-400 mt-1">Square JPEG/PNG, ≥192px.</p>
            </div>
          </div>
          <input className={`${inp} w-full`} placeholder="About (status, ≤139 chars)" maxLength={139} value={p.about} onChange={e => setP({ ...p, about: e.target.value })} />
          <textarea className={`${inp} w-full`} rows={2} placeholder="Description (≤512 chars)" maxLength={512} value={p.description} onChange={e => setP({ ...p, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Email" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} />
            <input className={inp} placeholder="Website (https://…)" value={p.website} onChange={e => setP({ ...p, website: e.target.value })} />
            <input className={inp} placeholder="Address" value={p.address} onChange={e => setP({ ...p, address: e.target.value })} />
            <select className={inp} value={p.vertical} onChange={e => setP({ ...p, vertical: e.target.value })}>
              {WA_VERTICAL_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveFields} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save profile"}</button>
            {msg && <p className={`text-xs ${msg.includes("✓") ? "text-emerald-600" : "text-red-500"}`}>{msg}</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sequences (drip) ──────────────────────────────────────────────────────────
type StepDraft = { delayMinutes: number; action: { type: "text" | "template" | "media"; text?: string; templateName?: string; languageCode?: string; mediaKind?: "image" | "video" | "document" | "audio"; url?: string; caption?: string } };
type SeqRow = { id: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string | null; channelId: string | null; active: boolean; steps: { delayMinutes: number; action: StepDraft["action"] }[] };
type SeqDraft = { id?: string; name: string; platform: "whatsapp" | "instagram"; triggerKind: string; triggerValue: string; channelId: string | null; active: boolean; steps: StepDraft[] };
const SEQ_TRIGGERS: [string, string][] = [["manual", "Manual / API"], ["keyword", "Keyword reply"], ["opt_in", "Opt-in (growth tool)"], ["story_reply", "Instagram story reply"], ["comment", "Comment"], ["tag_added", "Tag added"], ["cart_abandoned", "Cart abandoned"], ["order_placed", "Order placed"], ["ad_referral", "Ad referral"]];
const EMPTY_SEQ: SeqDraft = { name: "", platform: "whatsapp", triggerKind: "manual", triggerValue: "", channelId: null, active: true, steps: [{ delayMinutes: 0, action: { type: "text", text: "" } }] };

// Format a step delay (minutes) as a human label for the preview timeline.
function fmtDelay(min: number): string {
  if (!min || min <= 0) return "immediately";
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return "after " + [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
}

// Chat-style preview of a sequence — each step shown as the message the contact
// receives, in WhatsApp or Instagram styling, with the wait before each step.
function SequencePreview({ platform, steps }: { platform: "whatsapp" | "instagram"; steps: StepDraft[] }) {
  const ig = platform === "instagram";
  const bubble = ig ? "bg-slate-100 text-slate-800 rounded-2xl rounded-bl-md" : "bg-white text-slate-800 rounded-lg rounded-tl-sm";
  return (
    <div className="xl:w-72 shrink-0">
      <p className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Preview · {ig ? "Instagram" : "WhatsApp"}</p>
      <div className={`rounded-control p-3 space-y-3 ${ig ? "bg-white border border-line" : "bg-[#e5ddd5]"}`}>
        {steps.map((st, i) => {
          const a = st.action;
          return (
            <div key={i} className="space-y-1.5">
              <p className="text-center"><span className="text-[10px] text-slate-500 bg-black/[0.06] rounded-full px-2 py-0.5">⏱ {fmtDelay(st.delayMinutes)}</span></p>
              <div className="flex">
                <div className={`max-w-[85%] px-3 py-2 text-[13px] shadow-sm ${bubble}`}>
                  {a.type === "text" && <p className="whitespace-pre-wrap break-words">{a.text?.trim() || "Empty message…"}</p>}
                  {a.type === "template" && <><p className="font-semibold break-words">📄 {a.templateName?.trim() || "template"}</p><p className="text-[11px] text-slate-400 mt-0.5">approved template message</p></>}
                  {a.type === "media" && <>
                    {a.mediaKind === "image" && a.url
                      ? <ImgFallback url={a.url} imgClass="w-40 h-24 object-cover rounded-md" boxClass="w-40 h-24 bg-slate-200 rounded-md flex items-center justify-center text-slate-400" icon={<ImageIcon className="w-6 h-6" />} />
                      : <div className="w-40 h-24 bg-slate-200 rounded-md flex items-center justify-center text-slate-400">{a.mediaKind === "video" ? <Video className="w-6 h-6" /> : a.mediaKind === "document" ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}</div>}
                    {a.caption?.trim() && <p className="break-words mt-1">{a.caption}</p>}
                  </>}
                  <p className="text-[9px] text-slate-400 text-right mt-0.5">10:30</p>
                </div>
              </div>
            </div>
          );
        })}
        {!steps.length && <p className="text-xs text-ink-400 text-center py-4">Add steps to preview the conversation.</p>}
      </div>
    </div>
  );
}

function SequencesTab() {
  const [seqs, setSeqs] = useState<SeqRow[]>([]);
  const [form, setForm] = useState<SeqDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs(d.sequences ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  function editRow(s: SeqRow) {
    setForm({ id: s.id, name: s.name, platform: s.platform, triggerKind: s.triggerKind, triggerValue: s.triggerValue ?? "", channelId: s.channelId, active: s.active, steps: s.steps.length ? s.steps.map(st => ({ delayMinutes: st.delayMinutes, action: st.action })) : EMPTY_SEQ.steps });
    setMsg(null);
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg("Give the sequence a name."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/sequences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, triggerValue: form.triggerValue || null }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this sequence? Active enrollments stop.")) return;
    await fetch("/api/admin/sequences", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }
  const setStep = (i: number, patch: Partial<StepDraft>) => setForm(f => f ? { ...f, steps: f.steps.map((s, j) => j === i ? { ...s, ...patch } : s) } : f);
  const setStepAction = (i: number, patch: Partial<StepDraft["action"]>) => setForm(f => f ? { ...f, steps: f.steps.map((s, j) => j === i ? { ...s, action: { ...s.action, ...patch } } : s) } : f);

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Workflow className="w-5 h-5" /> Sequences</h2>
          <p className="text-sm text-slate-500">Timed multi-step follow-ups. Triggered by keywords, opt-ins, story replies, abandoned carts, and more — they run automatically and respect the 24-hour window.</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_SEQ }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New sequence</button>
      </div>

      {seqs.map(s => (
        <div key={s.id} className="bg-white rounded-card border border-line p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Workflow className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{s.name} {!s.active && <span className="text-[10px] font-bold text-red-500">· OFF</span>}</p>
            <p className="text-[11px] text-ink-400">{s.platform} · trigger: {SEQ_TRIGGERS.find(t => t[0] === s.triggerKind)?.[1] ?? s.triggerKind}{s.triggerValue ? ` “${s.triggerValue}”` : ""} · {s.steps.length} step{s.steps.length === 1 ? "" : "s"}</p>
          </div>
          <button onClick={() => editRow(s)} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(s.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!seqs.length && !form && <p className="text-xs text-ink-400">No sequences yet.</p>}

      {form && (
        <div className="bg-white rounded-card border-2 border-brand-700/30 p-4 flex flex-col xl:flex-row gap-5">
          <div className="flex-1 min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Sequence name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className={inp} value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value as SeqDraft["platform"] })}>
              <option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option>
            </select>
            <select className={inp} value={form.triggerKind} onChange={e => setForm({ ...form, triggerKind: e.target.value })}>
              {SEQ_TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input className={inp} placeholder="Trigger value (keyword / tag / ref id)" value={form.triggerValue} onChange={e => setForm({ ...form, triggerValue: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <ChannelSelect value={form.channelId} onChange={v => setForm({ ...form, channelId: v })} allLabel="Channel: default" className={`${inp} !py-1.5 text-xs`} />
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
          </div>

          <p className="text-xs font-bold text-slate-400 uppercase pt-1">Steps</p>
          {form.steps.map((st, i) => (
            <div key={i} className="border border-line rounded-control p-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs text-ink-500">
                <span className="font-bold">#{i + 1}</span>
                <span>wait</span>
                <input type="number" min={0} className={`${inp} !py-1 w-20`} value={st.delayMinutes} onChange={e => setStep(i, { delayMinutes: Math.max(0, Number(e.target.value) || 0) })} />
                <span>min, then send</span>
                <select className={`${inp} !py-1`} value={st.action.type} onChange={e => setStepAction(i, { type: e.target.value as StepDraft["action"]["type"] })}>
                  <option value="text">Text</option><option value="template">Template</option><option value="media">Media</option>
                </select>
                <div className="flex-1" />
                {form.steps.length > 1 && <button onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })} className="p-1 text-ink-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>}
              </div>
              {st.action.type === "text" && <textarea className={`${inp} w-full`} rows={2} placeholder="Message text (sends inside the 24h window)" value={st.action.text ?? ""} onChange={e => setStepAction(i, { text: e.target.value })} />}
              {st.action.type === "template" && <div className="grid grid-cols-2 gap-2"><input className={inp} placeholder="Template name" value={st.action.templateName ?? ""} onChange={e => setStepAction(i, { templateName: e.target.value })} /><input className={inp} placeholder="Language (e.g. en_US)" value={st.action.languageCode ?? ""} onChange={e => setStepAction(i, { languageCode: e.target.value })} /></div>}
              {st.action.type === "media" && <div className="grid grid-cols-2 gap-2"><select className={inp} value={st.action.mediaKind ?? "image"} onChange={e => setStepAction(i, { mediaKind: e.target.value as NonNullable<StepDraft["action"]["mediaKind"]> })}><option value="image">Image</option><option value="video">Video</option><option value="document">Document</option></select><input className={inp} placeholder="Media URL" value={st.action.url ?? ""} onChange={e => setStepAction(i, { url: e.target.value })} /></div>}
            </div>
          ))}
          <button onClick={() => setForm({ ...form, steps: [...form.steps, { delayMinutes: 60, action: { type: "text", text: "" } }] })} className="text-xs font-bold text-brand-700 hover:text-brand-600 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add step</button>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save sequence"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
            {msg && <span className="text-xs text-red-500">{msg}</span>}
          </div>
          </div>
          <SequencePreview platform={form.platform} steps={form.steps} />
        </div>
      )}
    </div>
  );
}

// ── Catalog (commerce) ────────────────────────────────────────────────────────
type ProductRow = { id: string; name: string; description: string | null; priceCents: number; currency: string; imageUrl: string | null; retailerId: string | null; metaProductId: string | null; catalogId: string | null; available: boolean };
const EMPTY_PRODUCT = { id: undefined as string | undefined, name: "", description: "", price: "", currency: "INR", imageUrl: "", retailerId: "", metaProductId: "", catalogId: "", available: true };

// Image that falls back to a placeholder icon when the URL is missing or fails
// to load (e.g. a non-image link was pasted), instead of a broken-image glyph.
function ImgFallback({ url, imgClass, boxClass, icon }: { url: string; imgClass: string; boxClass: string; icon: React.ReactNode }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [url]);
  // eslint-disable-next-line @next/next/no-img-element
  if (url && !err) return <img src={url} alt="" className={imgClass} onError={() => setErr(true)} />;
  return <div className={boxClass}>{icon}</div>;
}

function CatalogTab() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [form, setForm] = useState<typeof EMPTY_PRODUCT | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const load = useCallback(() => { fetch("/api/admin/products").then(r => r.json()).then(d => setProducts(d.products ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function makeCheckout() {
    setCheckoutBusy(true); setMsg(null); setCheckoutId(null);
    try {
      const res = await fetch("/api/admin/checkout-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Checkout" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || `Could not create checkout flow (HTTP ${res.status})`);
      else if (d.published) setCheckoutId(d.id);
      else setMsg(`Created the flow but Meta couldn't publish it: ${(d.validationErrors?.length ? d.validationErrors.join("; ") : d.publishError) || "the Flow JSON didn't pass validation"}`);
    } catch {
      setMsg("Could not reach the server to create the checkout flow.");
    } finally { setCheckoutBusy(false); }
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg("Product name is required."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name: form.name, description: form.description, priceCents: Math.round((Number(form.price) || 0) * 100), currency: form.currency, imageUrl: form.imageUrl || null, retailerId: form.retailerId || null, metaProductId: form.metaProductId || null, catalogId: form.catalogId || null, available: form.available }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this product?")) return;
    await fetch("/api/admin/products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><ShoppingBag className="w-5 h-5" /> Catalog</h2>
          <p className="text-sm text-slate-500">Products you can send in chat and sell via in-chat checkout. Abandoned carts auto-enroll into your cart-recovery sequence.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={makeCheckout} disabled={checkoutBusy} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60"><Workflow className="w-3.5 h-3.5" /> {checkoutBusy ? "Creating…" : "Create checkout flow"}</button>
          <button onClick={() => { setForm({ ...EMPTY_PRODUCT }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add product</button>
        </div>
      </div>
      {checkoutId && <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded-control px-3 py-2">Published a multi-screen checkout flow — id <code className="font-mono">{checkoutId}</code>. Use it in a flow&apos;s “WhatsApp form” node; on submit, the order is created from the contact&apos;s open cart.</p>}
      {!form && msg && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">⚠ {msg}{/credential|token|WABA|not configured/i.test(msg) ? " — checkout flows need a connected WhatsApp number with WhatsApp Flows access." : ""}</p>}

      {products.map(p => (
        <div key={p.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
          <ImgFallback url={p.imageUrl ?? ""} imgClass="w-12 h-12 rounded-lg object-cover shrink-0" boxClass="w-12 h-12 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ShoppingBag className="w-5 h-5 text-ink-300" />} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{p.name} {!p.available && <span className="text-[10px] font-bold text-red-500">· hidden</span>}</p>
            <p className="text-[11px] text-ink-400">{p.currency} {(p.priceCents / 100).toFixed(2)}{p.retailerId ? ` · SKU ${p.retailerId}` : ""}</p>
          </div>
          <button onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? "", price: String(p.priceCents / 100), currency: p.currency, imageUrl: p.imageUrl ?? "", retailerId: p.retailerId ?? "", metaProductId: p.metaProductId ?? "", catalogId: p.catalogId ?? "", available: p.available })} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(p.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!products.length && !form && <p className="text-xs text-ink-400">No products yet.</p>}

      {form && (
        <div className="bg-white rounded-card border-2 border-brand-700/30 p-4 flex flex-col xl:flex-row gap-5">
          <div className="flex-1 space-y-2 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Product name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div className="flex gap-2"><input className={inp} placeholder="Price" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /><input className={`${inp} w-20`} placeholder="INR" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div className="col-span-2 flex items-center gap-3">
              <ImgFallback url={form.imageUrl} imgClass="w-14 h-14 rounded-lg object-cover border border-line shrink-0" boxClass="w-14 h-14 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ImageIcon className="w-5 h-5 text-ink-300" />} />
              <div className="flex-1 space-y-1 min-w-0">
                <div className="flex items-center gap-2">
                  <ImageUpload onUploaded={url => setForm({ ...form, imageUrl: url })} />
                  {form.imageUrl && <button onClick={() => setForm({ ...form, imageUrl: "" })} className="text-[11px] font-semibold text-ink-400 hover:text-red-600">Remove</button>}
                </div>
                <input className={`${inp} w-full`} placeholder="…or paste an image link" value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} />
              </div>
            </div>
            <textarea className={`${inp} col-span-2`} rows={2} placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <input className={inp} placeholder={form.id ? "Your SKU / retailer id" : "SKU / retailer id — auto-generated if blank"} value={form.retailerId} onChange={e => setForm({ ...form, retailerId: e.target.value })} />
            <input className={inp} placeholder="Meta catalog product id (optional)" value={form.metaProductId} onChange={e => setForm({ ...form, metaProductId: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.available} onChange={e => setForm({ ...form, available: e.target.checked })} /> available</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save product"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
          </div>
          <div className="xl:w-64 shrink-0">
            <p className="text-[10px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-1.5">Preview in chat</p>
            <div className="bg-[#e5ddd5] rounded-control p-3">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <ImgFallback url={form.imageUrl} imgClass="w-full h-32 object-cover" boxClass="h-32 bg-slate-100 flex items-center justify-center text-slate-300" icon={<ImageIcon className="w-7 h-7" />} />
                <div className="p-2.5 space-y-0.5">
                  <p className="text-[13px] font-semibold text-slate-800 break-words">{form.name || "Product name"}</p>
                  <p className="text-[13px] font-bold text-slate-900">{form.currency || "INR"} {(Number(form.price) || 0).toFixed(2)}</p>
                  {form.description.trim() && <p className="text-[11px] text-slate-500 break-words line-clamp-2">{form.description}</p>}
                </div>
                <div className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600">View</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Growth tools ──────────────────────────────────────────────────────────────
type GrowthRow = { id: string; name: string; kind: string; slug: string; prefill: string | null; tag: string | null; sequenceId: string | null; config: { number?: string; url?: string; igUsername?: string }; clicks: number; conversions: number; active: boolean };
const GROWTH_KINDS: [string, string][] = [["ref_link", "Referral link"], ["qr", "QR code"], ["widget_popup", "Website popup"], ["widget_bar", "Website bar"], ["landing", "Landing page"]];
const EMPTY_GROWTH = { id: undefined as string | undefined, name: "", kind: "ref_link", slug: "", prefill: "", number: "", igUsername: "", url: "", tag: "", sequenceId: "", active: true };

function GrowthTab() {
  const [tools, setTools] = useState<GrowthRow[]>([]);
  const [seqs, setSeqs] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof EMPTY_GROWTH | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const load = useCallback(() => { fetch("/api/admin/growth").then(r => r.json()).then(d => setTools(d.tools ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); setOrigin(window.location.origin); }, [load]);
  useEffect(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs((d.sequences ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => {}); }, []);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.slug.trim()) { setMsg("Name and slug are required."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/growth", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name: form.name, kind: form.kind, slug: form.slug, prefill: form.prefill || null, tag: form.tag || null, sequenceId: form.sequenceId || null, config: { number: form.number || undefined, igUsername: form.igUsername || undefined, url: form.url || undefined }, active: form.active }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this growth tool?")) return;
    await fetch("/api/admin/growth", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Growth Tools</h2>
          <p className="text-sm text-slate-500">Ref links, QR codes and opt-in widgets that send people into WhatsApp/Instagram with a prefilled message — then start a flow or sequence and tag them.</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_GROWTH }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New tool</button>
      </div>

      {tools.map(t => (
        <div key={t.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{t.name} <span className="text-[10px] font-bold text-ink-400">· {GROWTH_KINDS.find(k => k[0] === t.kind)?.[1] ?? t.kind}</span></p>
            <p className="text-[11px] text-ink-400 font-mono truncate">{origin}/g/{t.slug} · {t.clicks} clicks · {t.conversions} conv.</p>
          </div>
          <button onClick={() => navigator.clipboard.writeText(`${origin}/g/${t.slug}`)} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 flex items-center gap-1"><Copy className="w-3 h-3" /> Link</button>
          <button onClick={() => setForm({ id: t.id, name: t.name, kind: t.kind, slug: t.slug, prefill: t.prefill ?? "", number: t.config?.number ?? "", igUsername: t.config?.igUsername ?? "", url: t.config?.url ?? "", tag: t.tag ?? "", sequenceId: t.sequenceId ?? "", active: t.active })} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(t.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!tools.length && !form && <p className="text-xs text-ink-400">No growth tools yet.</p>}

      {form && (
        <div className="bg-white rounded-card border-2 border-brand-700/30 p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className={inp} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{GROWTH_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <input className={inp} placeholder="Slug (used in /g/slug)" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            <input className={inp} placeholder="Prefilled opt-in message (e.g. GUIDE)" value={form.prefill} onChange={e => setForm({ ...form, prefill: e.target.value })} />
            <input className={inp} placeholder="WhatsApp number (e.g. 9198…)" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} />
            <input className={inp} placeholder="…or Instagram username" value={form.igUsername} onChange={e => setForm({ ...form, igUsername: e.target.value })} />
            <input className={`${inp} col-span-2`} placeholder="…or a full custom URL (overrides the above)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
            <input className={inp} placeholder="Tag the contact on opt-in (optional)" value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} />
            <select className={inp} value={form.sequenceId} onChange={e => setForm({ ...form, sequenceId: e.target.value })}>
              <option value="">Enroll in sequence: none</option>
              {seqs.map(s => <option key={s.id} value={s.id}>Enroll: {s.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save tool"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
    </div>
  );
}

// Dedicated Instagram section (its own nav tab).
function InstagramTab() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Instagram className="w-5 h-5 text-pink-600" /> Instagram</h2>
        <p className="text-sm text-slate-500">Auto-reply to Instagram DMs with your AI, and turn post comments into DMs — all within Meta&apos;s rules (24-hour window, no cold DMs, one reply per comment).</p>
      </div>

      {/* What you need to connect */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Before you connect</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>An Instagram <b>Professional</b> account (Business or Creator), <b>linked to a Facebook Page</b>. In the IG app: Settings → Account type → switch to Professional, then link your Page.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><span>In <b>Instagram → Settings → Messages → Connected Tools</b>, turn ON <i>“Allow access to messages”</i> so the API can read/reply to DMs.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>On your Meta app, add the <code className="font-mono text-[12px]">instagram_manage_messages</code> permission (and <code className="font-mono text-[12px]">instagram_manage_comments</code> for comment-to-DM), and subscribe the Instagram webhook to <code className="font-mono text-[12px]">/api/webhooks/instagram</code> (fields: <i>messages</i>, <i>comments</i>) using your existing verify token.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">4</span><span>Grab two things to paste below: the <b>Instagram account id</b> (the IG professional account / IGSID) and an <b>access token</b> with <code className="font-mono text-[12px]">instagram_manage_messages</code>. The Page id is optional.</span></li>
        </ol>
        <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Heads-up on Meta&apos;s rules (enforced automatically): you can only DM someone within <b>24 hours</b> of their last message, never cold-DM, and a comment reply is a single message. Staying inside these keeps the account safe from blocks.</p>
      </section>

      <InstagramManager />
    </div>
  );
}

const EMPTY_IG = { id: undefined as string | undefined, name: "", igUserId: "", pageId: "", token: "", agentId: "", active: true, isDefault: false };

type CommentRule = {
  id?: string; channelId: string | null; name: string; enabled: boolean;
  postId: string | null; postCaption: string | null; postPermalink: string | null; postThumbnail: string | null;
  keyword: string; dmMessage: string; buttonLabel: string; buttonUrl: string; publicReply: string;
  requireFollow: boolean; followPrompt: string; matchCount?: number;
};
type IgPost = { id: string; caption: string; permalink: string; thumbnail: string; mediaType: string; timestamp: string };
const BLANK_RULE: CommentRule = { channelId: null, name: "", enabled: true, postId: null, postCaption: null, postPermalink: null, postThumbnail: null, keyword: "", dmMessage: "", buttonLabel: "", buttonUrl: "", publicReply: "", requireFollow: false, followPrompt: "" };

function InstagramManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof EMPTY_IG | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Comment-to-DM rules (ManyChat-style: multiple rules, per-post, follow-gate)
  const [rules, setRules] = useState<CommentRule[]>([]);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [ruleForm, setRuleForm] = useState<CommentRule | null>(null);
  const [pickAccount, setPickAccount] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  const loadRules = useCallback(() => { fetch("/api/admin/ig-comment-rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setChannels((d.channels ?? []).filter((c: ChannelRow) => c.kind === "instagram"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { loadRules(); }, [loadRules]);
  // Load the post grid for the account the rule editor targets. `null` when the
  // editor is closed; only changes on open or account switch (not keystrokes).
  const editorChannel = ruleForm ? (ruleForm.channelId ?? "") : null;
  useEffect(() => {
    if (editorChannel === null) return;
    const qs = editorChannel ? `?channelId=${encodeURIComponent(editorChannel)}` : "";
    setPosts([]);
    fetch(`/api/admin/ig-media${qs}`).then(r => r.json()).then(d => setPosts(d.media ?? [])).catch(() => {});
  }, [editorChannel]);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.igUserId.trim()) { setMsg("Label and Instagram account id are required."); return; }
    if (!form.id && !form.token.trim()) { setMsg("Access token is required to connect."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/instagram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, agentId: form.agentId || null, pageId: form.pageId || null }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Disconnect this Instagram account? Its conversations stay.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function connectWithMeta() {
    setBusy(true); setMsg(null);
    try {
      const { code } = await launchInstagramSignup();
      const res = await fetch("/api/admin/onboarding/instagram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Connection failed");
      else { setForm(null); load(); }
    } catch (e) { setMsg(e instanceof Error ? e.message : "Connection cancelled"); }
    finally { setBusy(false); }
  }

  async function saveRule() {
    if (!ruleForm) return;
    if (!ruleForm.dmMessage.trim()) { setMsg("DM message is required"); return; }
    setRuleBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/ig-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ruleForm) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setRuleForm(null); loadRules(); }
    } finally { setRuleBusy(false); }
  }
  async function toggleRule(r: CommentRule) {
    await fetch("/api/admin/ig-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, enabled: !r.enabled }) }).catch(() => {});
    loadRules();
  }
  async function delRule(id?: string) {
    if (!id || !confirm("Delete this comment rule?")) return;
    await fetch("/api/admin/ig-comment-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    loadRules();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Instagram className="w-3.5 h-3.5 text-pink-600" /> Instagram</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect an Instagram professional account to auto-reply to DMs and turn post comments into DMs — all within Meta&apos;s rules (24-hour window, no cold DMs).</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {instagramSignupReady() && (
            <button onClick={connectWithMeta} disabled={busy} className="px-3 py-1.5 rounded-control bg-[#0783fd] hover:bg-[#0668d6] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5" />} Connect with Facebook
            </button>
          )}
          <button onClick={() => { setForm({ ...EMPTY_IG }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add manually</button>
        </div>
      </div>

      {channels.map(c => (
        <div key={c.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><Instagram className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{c.name} {c.isDefault && <span className="text-[10px] font-bold text-brand-700">· DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
            <p className="text-[11px] text-ink-400 font-mono truncate">ig {c.igUserId}{c.pageId ? ` · page ${c.pageId}` : ""} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
          </div>
          <button onClick={() => { setForm({ id: c.id, name: c.name, igUserId: c.igUserId ?? "", pageId: c.pageId ?? "", token: "", agentId: c.agentId ?? "", active: c.active, isDefault: c.isDefault }); setMsg(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {form && (
        <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. @analytixlabs" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Instagram account id (IG professional id)" value={form.igUserId} onChange={e => setForm({ ...form, igUserId: e.target.value.trim() })} />
            <input className={inp} placeholder="Facebook Page id (optional)" value={form.pageId} onChange={e => setForm({ ...form, pageId: e.target.value.trim() })} />
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this account">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
          </div>
          <input className={`${inp} w-full font-mono`} placeholder={form.id ? "Access token — leave blank to keep the current one" : "Access token (instagram_manage_messages)"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> default for sends</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save account"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Needs an IG <b>professional</b> account linked to a Facebook Page, the <code className="font-mono">instagram_manage_messages</code> permission on your Meta app, and the IG webhook pointed at <code className="font-mono">/api/webhooks/instagram</code>.</p>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!channels.length && !form && <p className="text-xs text-ink-400">No Instagram accounts connected yet.</p>}

      {/* Comment-to-DM automation (ManyChat-style: multiple rules, per-post, follow-gate) */}
      <div className="border-t border-line pt-3 mt-1 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Comment-to-DM automation</p>
          <button onClick={() => { setMsg(null); if (channels.length > 1) { setRuleForm(null); setPickAccount(true); } else { setPickAccount(false); setRuleForm({ ...BLANK_RULE, channelId: channels[0]?.id ?? null }); } }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New rule</button>
        </div>
        <p className="text-[11px] text-ink-400">When someone comments, send them ONE private DM (Meta allows a single reply per comment). Target a specific post or all posts, gate by keyword, attach a link button, and optionally require a follow first — like ManyChat.</p>

        {rules.map(r => {
          const post = posts.find(p => p.id === r.postId);
          const thumb = r.postThumbnail || post?.thumbnail;
          return (
            <div key={r.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
              {thumb
                ? <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-10 h-10 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 truncate">{r.name || (r.keyword ? `“${r.keyword}”` : "Any comment")}{channels.length > 1 && r.channelId && <span className="text-[10px] font-bold text-pink-600"> · {channels.find(c => c.id === r.channelId)?.name ?? "IG"}</span>}{!r.enabled && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
                <p className="text-[11px] text-ink-400 truncate">{r.postId ? `Post: ${(r.postCaption || post?.caption || r.postId).slice(0, 38) || r.postId}` : "All posts"} · {r.keyword ? `keyword “${r.keyword}”` : "any comment"}{r.buttonUrl ? " · 🔗 button" : ""}{r.requireFollow ? " · 🔒 follow" : ""} · {r.matchCount ?? 0} sent</p>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-ink-500 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={r.enabled} onChange={() => toggleRule(r)} /> on</label>
              <button onClick={() => { setRuleForm({ ...r, name: r.name ?? "", keyword: r.keyword ?? "", buttonLabel: r.buttonLabel ?? "", buttonUrl: r.buttonUrl ?? "", publicReply: r.publicReply ?? "", requireFollow: r.requireFollow ?? false, followPrompt: r.followPrompt ?? "" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
              <button onClick={() => delRule(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {!rules.length && !ruleForm && !pickAccount && <p className="text-xs text-ink-400">No comment rules yet — create one to turn post comments into DMs.</p>}

        {/* Step 1: pick the Instagram account so posts are never mixed across accounts. */}
        {pickAccount && (
          <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
            <p className="text-xs font-bold text-ink-700">Which Instagram account is this rule for?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {channels.map(c => (
                <button key={c.id} type="button" onClick={() => { setRuleForm({ ...BLANK_RULE, channelId: c.id }); setPickAccount(false); }}
                  className="flex items-center gap-2 border border-line rounded-control px-3 py-2 text-left hover:border-pink-500 hover:bg-pink-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><Instagram className="w-4 h-4" /></div>
                  <div className="min-w-0"><p className="text-sm font-semibold text-ink-900 truncate">{c.name}</p><p className="text-[10px] text-ink-400 font-mono truncate">{c.igUserId}</p></div>
                </button>
              ))}
            </div>
            <button onClick={() => setPickAccount(false)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
        )}

        {ruleForm && (
          <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
            {channels.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-control bg-pink-50 text-pink-600 font-bold flex items-center gap-1"><Instagram className="w-3.5 h-3.5" /> {channels.find(c => c.id === ruleForm.channelId)?.name ?? "Account"}</span>
                <button type="button" onClick={() => { setRuleForm(null); setPickAccount(true); }} className="text-ink-400 hover:text-ink-900 font-semibold">Change account</button>
              </div>
            )}
            <input className={`${inp} w-full`} placeholder="Rule name (internal)" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} />
            <div>
              <p className="text-[11px] font-bold text-ink-500 mb-1.5">Target post {channels.length > 1 && ruleForm.channelId && <span className="text-ink-400 font-normal">· {channels.find(c => c.id === ruleForm.channelId)?.name}</span>}</p>
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                <button type="button" onClick={() => setRuleForm({ ...ruleForm, postId: null, postCaption: null, postPermalink: null, postThumbnail: null })}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold border transition-colors ${!ruleForm.postId ? "ring-2 ring-pink-500 border-pink-500 text-pink-600 bg-pink-50" : "border-line text-ink-500 hover:bg-canvas"}`}>
                  <Instagram className="w-4 h-4" /> All
                </button>
                {posts.map(p => {
                  const sel = ruleForm.postId === p.id;
                  return (
                    <button type="button" key={p.id} title={p.caption || "(no caption)"} onClick={() => setRuleForm({ ...ruleForm, postId: p.id, postCaption: p.caption, postPermalink: p.permalink, postThumbnail: p.thumbnail })}
                      className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${sel ? "ring-2 ring-pink-500 border-pink-500" : "border-line hover:opacity-90"}`}>
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-canvas flex items-center justify-center text-ink-300"><Instagram className="w-4 h-4" /></div>}
                      {p.mediaType === "VIDEO" && <Video className="absolute top-1 right-1 w-3 h-3 text-white drop-shadow" />}
                      {sel && <span className="absolute inset-0 bg-pink-500/15 flex items-center justify-center"><Check className="w-5 h-5 text-white drop-shadow" /></span>}
                    </button>
                  );
                })}
              </div>
              {!posts.length && <p className="text-[11px] text-amber-600 mt-1.5">No posts loaded — token needs comment/media permissions. You can still create an &ldquo;All&rdquo; rule.</p>}
            </div>
            <input className={`${inp} w-full`} placeholder="Trigger keyword (optional — blank = any comment)" value={ruleForm.keyword} onChange={e => setRuleForm({ ...ruleForm, keyword: e.target.value })} />
            <textarea className={`${inp} w-full`} rows={2} placeholder="DM message, e.g. Thanks for commenting! Here's your guide 📄" value={ruleForm.dmMessage} onChange={e => setRuleForm({ ...ruleForm, dmMessage: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Button label (optional, e.g. Download)" maxLength={20} value={ruleForm.buttonLabel} onChange={e => setRuleForm({ ...ruleForm, buttonLabel: e.target.value })} />
              <input className={inp} placeholder="Button link https://… (optional)" value={ruleForm.buttonUrl} onChange={e => setRuleForm({ ...ruleForm, buttonUrl: e.target.value.trim() })} />
            </div>
            <input className={`${inp} w-full`} placeholder="Public reply under the comment (optional, e.g. Sent you a DM! 📩)" value={ruleForm.publicReply} onChange={e => setRuleForm({ ...ruleForm, publicReply: e.target.value })} />

            {/* Follow-to-unlock gate */}
            <div className="rounded-control bg-canvas border border-line p-2.5 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink-700 cursor-pointer">
                <input type="checkbox" className="accent-brand-700" checked={ruleForm.requireFollow} onChange={e => setRuleForm({ ...ruleForm, requireFollow: e.target.checked })} />
                🔒 Require a follow before sending the link
              </label>
              {ruleForm.requireFollow && <>
                <textarea className={`${inp} w-full`} rows={2} placeholder="Follow prompt, e.g. Almost there! Follow us, then tap “I've followed” to unlock your guide 🎁" value={ruleForm.followPrompt} onChange={e => setRuleForm({ ...ruleForm, followPrompt: e.target.value })} />
                <p className="text-[11px] text-ink-400">We DM a “Visit profile” + “I've followed ✅” button. On tap we re-check the follow, then send the link. Verified blocking needs Meta App Review (<code className="font-mono">is_user_follow_business</code>); until then we trust the tap.</p>
              </>}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={ruleForm.enabled} onChange={e => setRuleForm({ ...ruleForm, enabled: e.target.checked })} /> enabled</label>
              <div className="flex-1" />
              <button onClick={saveRule} disabled={ruleBusy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{ruleBusy ? "Saving…" : "Save rule"}</button>
              <button onClick={() => setRuleForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
            </div>
            {msg && <p className="text-xs text-red-500">{msg}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// Tenant-facing plan + usage card (consumption vs plan limits).
function UsageCard() {
  const [u, setU] = useState<{ usage: { contacts: number; messages: number; channels: number; seats: number }; limits: { contacts: number; messages_per_month: number; channels: number; team_seats: number }; plan: string; status: string; trialEndsAt: string | null } | null>(null);
  useEffect(() => { fetch("/api/admin/usage").then(r => r.json()).then(d => { if (!d.error) setU(d); }).catch(() => {}); }, []);
  if (!u) return null;
  const rows: [string, number, number][] = [
    ["Contacts", u.usage.contacts, u.limits.contacts],
    ["Messages this month", u.usage.messages, u.limits.messages_per_month],
    ["Channels", u.usage.channels, u.limits.channels],
    ["Team seats", u.usage.seats, u.limits.team_seats],
  ];
  const trialLeft = u.trialEndsAt ? Math.max(0, Math.ceil((new Date(u.trialEndsAt).getTime() - Date.now()) / 86400000)) : null;
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Plan &amp; usage</p>
          <p className="text-sm font-semibold text-ink-900 capitalize">{u.plan} plan {u.status === "trialing" && trialLeft !== null && <span className="text-[11px] font-bold text-amber-600">· {trialLeft} days left in trial</span>}</p>
        </div>
        <a href="/admin/billing" className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">Manage plan</a>
      </div>
      <div className="space-y-2.5">
        {rows.map(([label, used, limit]) => {
          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          const near = limit > 0 && used / limit >= 0.8;
          return (
            <div key={label}>
              <div className="flex justify-between text-[11px] mb-0.5"><span className="text-ink-500">{label}</span><span className={`font-mono ${near ? "text-amber-600 font-bold" : "text-ink-400"}`}>{used.toLocaleString()} / {limit > 0 ? limit.toLocaleString() : "∞"}</span></div>
              <div className="h-1.5 rounded-full bg-canvas overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : near ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${limit > 0 ? pct : 4}%` }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Developer API keys — mint per-tenant keys for the public API (/api/broadcast,
// /api/events, /api/contacts). The full key is shown once on creation.
function ApiKeysCard() {
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string; lastUsedAt: string | null; revoked: boolean }[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/admin/api-keys").then(r => r.json()).then(d => setKeys(d.keys ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setFresh(null);
    try {
      const d = await fetch("/api/admin/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(r => r.json());
      if (d.key) { setFresh(d.key); setName(""); load(); } else alert(d.error || "Failed");
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Any integration using it stops working immediately.")) return;
    await fetch("/api/admin/api-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <p className="text-xs font-bold text-slate-400 uppercase">API access (developers)</p>
      <p className="text-[11px] text-ink-400">Use a key as <code className="font-mono">Authorization: Bearer ak_live_…</code> to call <code className="font-mono">/api/broadcast</code>, <code className="font-mono">/api/events</code> and <code className="font-mono">/api/contacts</code>. Each key is scoped to this workspace.</p>
      <div className="flex gap-2">
        <input className="flex-1 border border-line rounded-control px-2 py-1.5 text-xs bg-white" placeholder="Key name (e.g. CRM integration)" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={create} disabled={busy} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold shrink-0">Create key</button>
      </div>
      {fresh && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-control px-3 py-2 space-y-1">
          <p className="text-[11px] font-bold text-emerald-800">Copy this key now — it won&apos;t be shown again:</p>
          <code className="block font-mono text-[11px] text-emerald-900 break-all select-all">{fresh}</code>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {keys.filter(k => !k.revoked).map(k => (
          <div key={k.id} className="flex items-center justify-between py-2 gap-3">
            <div className="min-w-0">
              <span className="text-xs font-bold text-brand-dark">{k.name}</span>
              <p className="text-[11px] text-slate-500 font-mono">{k.prefix} · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}</p>
            </div>
            <button onClick={() => revoke(k.id)} className="text-[11px] font-bold text-red-500 hover:text-red-700 shrink-0">Revoke</button>
          </div>
        ))}
        {keys.filter(k => !k.revoked).length === 0 && <p className="text-center text-slate-400 text-sm py-3">No API keys yet.</p>}
      </div>
    </section>
  );
}

function SettingsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [welcome, setWelcome] = useState<WelcomeS | null>(null);
  const [away, setAway] = useState<AwayS | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  useEffect(() => { fetch("/api/admin/me").then(r => r.json()).then(d => setIsAdmin(d.user?.role !== "member")).catch(() => {}); }, []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [quickReplies, setQuickReplies] = useState<{ id: string; shortcut: string; body: string }[]>([]);
  const [qrShortcut, setQrShortcut] = useState("");
  const [qrBody, setQrBody] = useState("");

  const loadQr = useCallback(() => { fetch("/api/admin/quick-replies").then(r => r.json()).then(d => setQuickReplies(d.quickReplies ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    fetch("/api/admin/settings").then(r => r.json()).then(d => { setWelcome(d.welcome); setAway(d.away); }).catch(() => {});
    loadQr();
  }, [loadQr]);

  async function save() {
    if (!welcome || !away) return;
    setSaving(true);
    try {
      await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ welcome, away }) });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  async function addQr() {
    if (!qrShortcut.trim() || !qrBody.trim()) return;
    await fetch("/api/admin/quick-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortcut: qrShortcut, body: qrBody }) });
    setQrShortcut(""); setQrBody(""); loadQr();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-2xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Settings</h2>
        <p className="text-sm text-slate-500">WhatsApp numbers, automatic messages, and canned responses.</p>
      </div>

      <UsageCard />
      {isAdmin && <ChannelsManager />}
      {isAdmin && <TeamManager />}
      {isAdmin && <ActivityLog />}

      {/* Welcome message */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Welcome message</p>
            <p className="text-xs text-slate-500 mt-0.5">Sent once, the first time a contact ever messages you (before the AI answers).</p>
          </div>
          {welcome && (
            <button onClick={() => setWelcome({ ...welcome, enabled: !welcome.enabled })}
              className={`px-3 py-1.5 rounded-full text-xs font-bold ${welcome.enabled ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {welcome.enabled ? "ON" : "OFF"}
            </button>
          )}
        </div>
        {welcome ? (
          <textarea className={`${inp} w-full resize-none`} rows={3} value={welcome.text} onChange={e => setWelcome({ ...welcome, text: e.target.value })} />
        ) : <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
      </section>

      {/* Away message */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Away message (outside working hours)</p>
            <p className="text-xs text-slate-500 mt-0.5">Sent at most once per 12h per conversation. The AI keeps answering either way.</p>
          </div>
          {away && (
            <button onClick={() => setAway({ ...away, enabled: !away.enabled })}
              className={`px-3 py-1.5 rounded-full text-xs font-bold ${away.enabled ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {away.enabled ? "ON" : "OFF"}
            </button>
          )}
        </div>
        {away ? (
          <>
            <textarea className={`${inp} w-full resize-none`} rows={3} value={away.text} onChange={e => setAway({ ...away, text: e.target.value })} />
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Working hours:</span>
              <input type="number" min={0} max={23} className={`${inp} w-20`} value={away.startHour} onChange={e => setAway({ ...away, startHour: parseInt(e.target.value) || 0 })} />
              <span>to</span>
              <input type="number" min={0} max={24} className={`${inp} w-20`} value={away.endHour} onChange={e => setAway({ ...away, endHour: parseInt(e.target.value) || 0 })} />
              <span className="text-xs text-slate-400">(IST, 24h format)</span>
            </div>
          </>
        ) : <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
      </section>

      <button onClick={save} disabled={saving || !welcome || !away} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : savedAt && Date.now() - savedAt < 3000 ? "Saved ✓" : "Save messages"}
      </button>

      {/* Quick replies */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Quick replies (canned responses)</p>
          <p className="text-xs text-slate-500 mt-0.5">Available in the Team Inbox composer (⚡ or type /) and the CRM chat panel.</p>
        </div>
        <div className="flex gap-2">
          <input className={`${inp} w-32`} placeholder="shortcut" value={qrShortcut} onChange={e => setQrShortcut(e.target.value)} />
          <input className={`${inp} flex-1`} placeholder="Reply text…" value={qrBody} onChange={e => setQrBody(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addQr(); }} />
          <button onClick={addQr} disabled={!qrShortcut.trim() || !qrBody.trim()} className="px-3 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="divide-y divide-slate-100">
          {quickReplies.map(q => (
            <div key={q.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0">
                <span className="text-xs font-bold text-brand-dark">/{q.shortcut}</span>
                <p className="text-xs text-slate-500 truncate">{q.body}</p>
              </div>
              <button onClick={() => fetch("/api/admin/quick-replies", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: q.id }) }).then(loadQr)} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {quickReplies.length === 0 && <p className="text-center text-slate-400 text-sm py-4">No quick replies yet — add shortcuts like "fees", "location", "demo".</p>}
        </div>
      </section>

      {isAdmin && (
        <section className="bg-white rounded-card border border-line p-5 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Data &amp; privacy (GDPR)</p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/admin/gdpr/export" className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">Export all data (JSON)</a>
            <button onClick={async () => {
              const phone = prompt("Erase a contact — enter their phone number.\nThis permanently deletes the contact and ALL their data.");
              if (!phone?.trim()) return;
              if (!confirm(`Permanently erase all data for ${phone}? This cannot be undone.`)) return;
              const r = await fetch("/api/admin/gdpr/erase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) }).then(x => x.json()).catch(() => ({ error: "request failed" }));
              alert(r.error ? `Error: ${r.error}` : `Erased data for ${r.phone}.`);
            }} className="px-3 py-1.5 rounded-control border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50">Erase a contact…</button>
          </div>
          <p className="text-[11px] text-ink-400">Export downloads everything stored for your workspace. Erase fulfils a right‑to‑be‑forgotten request for one contact (removes the contact, conversations, messages, opt‑outs, queue/log, orders and more).</p>
        </section>
      )}

      {isAdmin && <ApiKeysCard />}
    </div>
    <SettingsRail goTo={goTo} />
    </div>
  );
}

// ── Chatbot Flows: list + create (editor opens at /admin/flows/[id]) ──────────
type FlowSummary = { id: string; name: string; active: boolean; platform?: "whatsapp" | "instagram"; triggerKeywords: string[]; updatedAt: string; graph: { nodes: unknown[] } };

function FlowsTab() {
  const router = useRouter();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => { fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows(d.flows ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const d = await fetch("/api/admin/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }).then(r => r.json());
      if (d.flow?.id) router.push(`/admin/flows/${d.flow.id}`);
    } finally { setCreating(false); }
  }

  async function toggle(f: FlowSummary) {
    await fetch(`/api/admin/flows/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !f.active }) });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this flow?")) return;
    await fetch(`/api/admin/flows/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Chatbot Flows</h2>
        <p className="text-sm text-slate-500">Drag-and-drop conversation flows triggered by keywords (e.g. &quot;hi&quot;, &quot;menu&quot;). Anything a flow can&apos;t handle falls through to the AI assistant — never a dead-end.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">New flow</p>
        <div className="flex gap-2">
          <input className={inp + " flex-1"} placeholder="Flow name (e.g. Course enquiry menu)" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") create(); }} />
          <button onClick={create} disabled={creating || !name.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create & open builder"}
          </button>
        </div>
      </section>

      <div className="space-y-2">
        {flows.map(f => (
          <div key={f.id} className="bg-white rounded-card border border-line p-4 flex items-center justify-between gap-3">
            <button onClick={() => router.push(`/admin/flows/${f.id}`)} className="text-left min-w-0 flex-1">
              <p className="text-sm font-bold text-brand-dark flex items-center gap-1.5">{f.name}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.platform === "instagram" ? "bg-pink-50 text-pink-600" : "bg-emerald-50 text-emerald-700"}`}>{f.platform === "instagram" ? "Instagram" : "WhatsApp"}</span>
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {f.triggerKeywords.length ? `triggers: ${f.triggerKeywords.join(", ")}` : "no trigger keywords yet"} · {(f.graph?.nodes?.length ?? 1) - 1} steps
              </p>
            </button>
            <button onClick={() => toggle(f)} className={`px-3 py-1 rounded-full text-[11px] font-bold shrink-0 ${f.active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{f.active ? "● Active" : "○ Inactive"}</button>
            <button onClick={() => router.push(`/admin/flows/${f.id}`)} className="px-3 py-1 rounded-lg border border-line text-[11px] font-bold text-slate-600 shrink-0">Edit</button>
            <button onClick={() => remove(f.id)} className="p-1.5 text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {flows.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No flows yet — create one above. Example: trigger &quot;hi&quot; → welcome buttons → course info / talk to an agent.</p>}
      </div>
    </div>
    <FlowsRail flows={flows} />
    </div>
  );
}

// ── AI Hub: agent personas, function-calling lead capture, assist prompts ─────
type AiAgentT = { id?: string; name: string; description: string; persona: string; constraintsText: string; productInfo: string; model: string | null; active: boolean; routingKeywords?: string };
type AiParamT = { name: string; description: string; required: boolean; saveToAttribute: string };
type AiFunctionT = { id?: string; name: string; description: string; parameters: AiParamT[]; webhookUrl: string | null; escalate: boolean; active: boolean };
type AiPromptT = { id: string; name: string; prompt: string; active: boolean; sort: number };

const EMPTY_AGENT: AiAgentT = { name: "", description: "", persona: "", constraintsText: "", productInfo: "", model: null, active: false, routingKeywords: "" };
const EMPTY_FN: AiFunctionT = { name: "", description: "", parameters: [{ name: "", description: "", required: true, saveToAttribute: "" }], webhookUrl: null, escalate: false, active: true };

// Per-tenant AI provider + key. The key is validated with a live test call,
// then stored encrypted server-side. No key = auto-replies are off for this
// workspace. Embeddings always use the platform's shared Gemini key.
type AiKeyStatusT = { configured: boolean; provider: string; model: string; keyHint: string | null };
const AI_MODEL_HINT: Record<string, string> = { gemini: "gemini-2.5-flash", openai: "gpt-4o-mini", anthropic: "claude-opus-4-8" };
const AI_KEY_HELP: Record<string, string> = {
  gemini: "Google AI Studio key — aistudio.google.com/apikey",
  openai: "OpenAI key — platform.openai.com/api-keys",
  anthropic: "Anthropic key — console.anthropic.com",
};
function AiKeyCard() {
  const [status, setStatus] = useState<AiKeyStatusT | null>(null);
  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/ai/key").then(r => r.json()).then((d: AiKeyStatusT) => { setStatus(d); if (d.provider) setProvider(d.provider); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!apiKey.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/ai/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) setMsg({ ok: false, text: d.error ?? "Failed to save key" });
      else { setStatus(d); setApiKey(""); setMsg({ ok: true, text: "Key validated and saved." }); }
    } catch { setMsg({ ok: false, text: "Network error" }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("Remove this AI key? AI auto-replies will stop for this workspace until you add one.")) return;
    setBusy(true); setMsg(null);
    try { const d = await fetch("/api/admin/ai/key", { method: "DELETE" }).then(r => r.json()); setStatus(d); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-brand-dark flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> AI provider & key</h3>
        {status && (status.configured
          ? <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Connected · {status.provider} · {status.keyHint}</span>
          : <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Not configured — AI replies off</span>)}
      </div>
      <p className="text-[12px] text-slate-500">Bring your own AI key — usage is billed to your provider account. Used for chat replies only; document search (embeddings) runs on the platform.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <select value={provider} onChange={e => setProvider(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm">
          <option value="gemini">Google Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder={`Model (default ${AI_MODEL_HINT[provider]})`} className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
      </div>
      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "Enter a new key to replace the saved one" : "Paste your API key"} className="w-full rounded-control border border-line px-3 py-2 text-sm font-mono" />
      <p className="text-[11px] text-slate-400">{AI_KEY_HELP[provider]}</p>
      {msg && <p className={`text-[12px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !apiKey.trim()} className="bg-brand-700 text-white rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Validate & save
        </button>
        {status?.configured && <button onClick={remove} disabled={busy} className="text-red-600 border border-red-200 rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50">Remove</button>}
      </div>
    </section>
  );
}

function AiHubTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [sub, setSub] = useState<"agents" | "functions" | "prompts">("agents");
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [agents, setAgents] = useState<AiAgentT[]>([]);
  const [agent, setAgent] = useState<AiAgentT>(EMPTY_AGENT);
  const [fns, setFns] = useState<AiFunctionT[]>([]);
  const [fn, setFn] = useState<AiFunctionT | null>(null);
  const [prompts, setPrompts] = useState<AiPromptT[]>([]);
  const [pName, setPName] = useState(""); const [pText, setPText] = useState("");
  const [autoRoute, setAutoRoute] = useState<boolean | null>(null);
  const [tone, setTone] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents(d.agents ?? [])).catch(() => {});
    fetch("/api/admin/ai/functions").then(r => r.json()).then(d => setFns(d.functions ?? [])).catch(() => {});
    fetch("/api/admin/ai/prompts").then(r => r.json()).then(d => setPrompts(d.prompts ?? [])).catch(() => {});
    fetch("/api/admin/ai/routing").then(r => r.json()).then(d => { setAutoRoute(d.auto === true); setTone(d.tone !== false); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function generatePersona() {
    if (!agent.description.trim()) return;
    setBusy("gen");
    try {
      const d = await fetch("/api/admin/ai/agents/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: agent.name, description: agent.description }) }).then(r => r.json());
      if (d.persona) setAgent(a => ({ ...a, persona: d.persona }));
      else alert(d.error ?? "Generation failed");
    } finally { setBusy(""); }
  }
  async function saveAgent() {
    if (!agent.name.trim()) return;
    setBusy("agent");
    try { await fetch("/api/admin/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agent) }); setAgent(EMPTY_AGENT); setAgentFormOpen(false); load(); }
    finally { setBusy(""); }
  }
  async function saveFn() {
    if (!fn?.name.trim()) return;
    setBusy("fn");
    try { await fetch("/api/admin/ai/functions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fn) }); setFn(null); load(); }
    finally { setBusy(""); }
  }
  async function addPrompt() {
    if (!pName.trim() || !pText.trim()) return;
    await fetch("/api/admin/ai/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: pName, prompt: pText }) });
    setPName(""); setPText(""); load();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Sparkles className="w-5 h-5" /> AI Hub</h2>
        <p className="text-sm text-slate-500">Three simple things live here: <b>AI agents</b> — who the AI is when it replies, <b>Lead capture</b> — the details it saves mid-chat, and <b>Writing tools</b> — one-tap rewrites for your team in Live Chat.</p>
      </div>

      <AiKeyCard />

      <div className="flex gap-2">
        {([["agents", "AI agents"], ["functions", "Lead capture"], ["prompts", "Writing tools"]] as ["agents" | "functions" | "prompts", string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} className={`px-4 py-2 rounded-lg text-sm font-bold ${sub === k ? "bg-brand-700 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>

      {sub === "agents" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        An <b>agent</b> is a personality + job for the AI — e.g. <i>Maya, the admissions counsellor</i>. Create one per role; with auto-routing on, the best-matching agent answers each customer automatically.
      </div>

      <section className="bg-white rounded-card border border-line p-5">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={async () => { const d = await fetch("/api/admin/ai/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: !autoRoute }) }).then(r => r.json()); setAutoRoute(d.auto === true); }}
            className={`text-left rounded-control border p-3 transition-colors ${autoRoute ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
            <p className="text-xs font-bold text-ink-900">⚡ Auto-routing <span className={autoRoute ? "text-brand-700" : "text-slate-400"}>{autoRoute === null ? "…" : autoRoute ? "ON" : "OFF"}</span></p>
            <p className="text-[11px] text-slate-500 mt-0.5">Switch to the right agent automatically based on what the customer asks.</p>
          </button>
          <button onClick={async () => { const d = await fetch("/api/admin/ai/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tone: !tone }) }).then(r => r.json()); setTone(d.tone !== false); }}
            className={`text-left rounded-control border p-3 transition-colors ${tone ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
            <p className="text-xs font-bold text-ink-900">🎭 Persona tone <span className={tone ? "text-brand-700" : "text-slate-400"}>{tone === null ? "…" : tone ? "ON" : "OFF"}</span></p>
            <p className="text-[11px] text-slate-500 mt-0.5">Instant FAQ &amp; cached answers are rewritten in the agent&apos;s voice before sending.</p>
          </button>
        </div>
      </section>

      {/* Agents */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Your agents</p>
          <button onClick={() => { setAgent(EMPTY_AGENT); setAgentFormOpen(true); }} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold"><Plus className="w-3.5 h-3.5 inline" /> New agent</button>
        </div>
        {agents.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-dark">{a.name} {a.active && <span className="text-[10px] font-bold text-brand-600">● ACTIVE</span>}</p>
              <p className="text-[11px] text-slate-400 truncate">{a.description || "—"}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {!a.active && <button onClick={async () => { await fetch("/api/admin/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, active: true }) }); load(); }} className="text-[11px] font-bold text-brand-600 border border-brand-100 rounded-lg px-2 py-1">Activate</button>}
              <button onClick={() => { setAgent(a); setAgentFormOpen(true); }} className="text-[11px] font-bold text-slate-600 border border-line rounded-lg px-2 py-1">Edit</button>
              <button onClick={async () => { await fetch("/api/admin/ai/agents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) }); load(); }} className="p-1 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {agents.length === 0 && !agentFormOpen && <p className="text-center text-slate-400 text-sm py-4">No agents yet — hit <b>New agent</b>, describe the job in one line, and ✨ Generate writes the personality for you.</p>}
        {agentFormOpen && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">1 · Who is this agent?</p>
            <input className={`${inp} w-full`} placeholder="Name — e.g. Maya" value={agent.name} onChange={e => setAgent({ ...agent, name: e.target.value })} />
            <div className="flex gap-2">
              <textarea className={`${inp} flex-1 resize-none`} rows={2} placeholder="Their job in one line — e.g. Admissions counsellor who helps visitors pick the right data-science course" value={agent.description} onChange={e => setAgent({ ...agent, description: e.target.value })} />
              <button onClick={generatePersona} disabled={busy === "gen" || !agent.description.trim()} className="self-end px-3 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold disabled:opacity-50 shrink-0">
                {busy === "gen" ? <Loader2 className="w-4 h-4 animate-spin" /> : "✨ Generate"}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">2 · When should this agent take over? <span className="font-normal text-slate-400">(used by auto-routing)</span></p>
            <input className={`${inp} w-full`} placeholder="Topic keywords — e.g. courses, fees, admission, syllabus, demo class" value={agent.routingKeywords ?? ""} onChange={e => setAgent({ ...agent, routingKeywords: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">3 · Personality &amp; instructions <span className="font-normal text-slate-400">(✨ Generate fills this — edit freely)</span></p>
            <textarea className={`${inp} w-full resize-none font-mono text-xs`} rows={7} placeholder="Persona & role prompt…" value={agent.persona} onChange={e => setAgent({ ...agent, persona: e.target.value })} />
          </div>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — hard rules, extra product info, model override</summary>
            <div className="pt-2 space-y-2">
              <textarea className={`${inp} w-full resize-none`} rows={3} placeholder={"Hard rules — e.g.\nNever discuss pricing unless asked. Keep replies under 30 words."} value={agent.constraintsText} onChange={e => setAgent({ ...agent, constraintsText: e.target.value })} />
              <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="Product & service info this agent always knows (on top of the knowledge base)" value={agent.productInfo} onChange={e => setAgent({ ...agent, productInfo: e.target.value })} />
              <input className={`${inp} w-full`} placeholder="Model override (optional — leave blank for the default)" value={agent.model ?? ""} onChange={e => setAgent({ ...agent, model: e.target.value || null })} />
            </div>
          </details>
          <div className="flex items-center gap-3">
            <button onClick={saveAgent} disabled={busy === "agent" || !agent.name.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">{agent.id ? "Update agent" : "Create agent"}</button>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={agent.active} onChange={e => setAgent({ ...agent, active: e.target.checked })} /> make this the default agent</label>
            <button onClick={() => { setAgent(EMPTY_AGENT); setAgentFormOpen(false); }} className="text-xs text-slate-400 font-bold">cancel</button>
          </div>
        </div>
        )}
      </section>
      </>}

      {sub === "functions" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        Lead capture teaches the AI to <b>save details during a normal chat</b> — no form needed. Example: <b>capture_lead</b> stores name, course interest, and city as contact attributes the moment the customer mentions them.
      </div>

      {/* Functions */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">AI Functions — structured data capture</p>
            <p className="text-[11px] text-slate-400 mt-0.5">The AI calls these mid-chat once it has the details: saves to contact attributes, optionally fires a webhook, optionally hands off.</p>
          </div>
          <button onClick={() => setFn(EMPTY_FN)} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold shrink-0"><Plus className="w-3.5 h-3.5 inline" /> Function</button>
        </div>
        {fns.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-dark font-mono">{f.name} {!f.active && <span className="text-[10px] text-slate-400">(off)</span>} {f.escalate && <span className="text-[10px] font-bold text-red-500">→ handoff</span>}</p>
              <p className="text-[11px] text-slate-400 truncate">{f.parameters.map(pm => pm.name).join(", ")}{f.webhookUrl ? " · webhook" : ""}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setFn(f)} className="text-[11px] font-bold text-slate-600 border border-line rounded-lg px-2 py-1">Edit</button>
              <button onClick={async () => { await fetch("/api/admin/ai/functions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }); load(); }} className="p-1 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {fn && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="function_name (e.g. capture_lead)" value={fn.name} onChange={e => setFn({ ...fn, name: e.target.value })} />
              <input className={inp} placeholder="Webhook URL (optional)" value={fn.webhookUrl ?? ""} onChange={e => setFn({ ...fn, webhookUrl: e.target.value || null })} />
            </div>
            <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="When should the AI call this? (e.g. once the visitor has shared name, phone and their problem and confirmed the summary)" value={fn.description} onChange={e => setFn({ ...fn, description: e.target.value })} />
            <p className="text-[10px] font-bold text-slate-400 uppercase">Parameters</p>
            {fn.parameters.map((pm, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto_auto] gap-2 items-center">
                <input className={inp} placeholder="param name" value={pm.name} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                <input className={inp} placeholder="description for the AI" value={pm.description} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} />
                <input className={inp} placeholder="save to attribute" value={pm.saveToAttribute} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, saveToAttribute: e.target.value } : x) })} />
                <label className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><input type="checkbox" checked={pm.required} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} />req</label>
                <button onClick={() => setFn({ ...fn, parameters: fn.parameters.filter((_, j) => j !== i) })} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setFn({ ...fn, parameters: [...fn.parameters, { name: "", description: "", required: false, saveToAttribute: "" }] })} className="text-[11px] font-bold text-brand-dark">+ parameter</button>
            <div className="flex items-center gap-3">
              <button onClick={saveFn} disabled={busy === "fn" || !fn.name.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">{fn.id ? "Update function" : "Create function"}</button>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={fn.escalate} onChange={e => setFn({ ...fn, escalate: e.target.checked })} /> hand off to human after call</label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={fn.active} onChange={e => setFn({ ...fn, active: e.target.checked })} /> active</label>
              <button onClick={() => setFn(null)} className="text-xs text-slate-400 font-bold">cancel</button>
            </div>
          </div>
        )}
      </section>

      </>}

      {sub === "prompts" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        Writing tools are <b>one-tap rewrites</b> your team uses on drafts in the Live Chat composer (the ✨ button) — change tone, translate, shorten. Click a sample below to add it.
      </div>

      {/* Prompts */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Your writing tools</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Available to everyone in the Live Chat composer (✨ button).</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[["Friendly tone", "Rewrite the text in a warm, approachable, friendly tone, as if speaking to a friend."], ["Formal tone", "Rewrite the text in a polite, professional, formal tone."], ["Fix spelling & grammar", "Fix all spelling and grammar mistakes in the text without changing its meaning."], ["Translate to Hindi", "Translate the text to conversational Hindi written in Devanagari."], ["Translate to English", "Translate the text to natural English."], ["Shorten", "Rewrite the text to be as short as possible while keeping all key information."]].map(([n, p]) => (
            <button key={n} onClick={() => { setPName(n); setPText(p); }} className="px-2.5 py-1 rounded-full border border-line text-[11px] font-bold text-slate-600 hover:border-brand-dark">{n}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={`${inp} w-44`} placeholder="Name" value={pName} onChange={e => setPName(e.target.value)} />
          <input className={`${inp} flex-1`} placeholder="Instruction (e.g. Rewrite the text in a friendly tone…)" value={pText} onChange={e => setPText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addPrompt(); }} />
          <button onClick={addPrompt} disabled={!pName.trim() || !pText.trim()} className="px-3 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="divide-y divide-slate-100">
          {prompts.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0"><span className="text-xs font-bold text-brand-dark">{p.name}</span><p className="text-xs text-slate-500 truncate">{p.prompt}</p></div>
              <button onClick={async () => { await fetch("/api/admin/ai/prompts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) }); load(); }} className="p-1.5 text-red-400 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {prompts.length === 0 && <p className="text-center text-slate-400 text-sm py-4">No prompts yet — click a sample above to prefill.</p>}
        </div>
      </section>
      </>}
    </div>
    <AiHubRail goTo={goTo} agents={agents} fns={fns} prompts={prompts} autoRoute={autoRoute} tone={tone} />
    </div>
  );
}
