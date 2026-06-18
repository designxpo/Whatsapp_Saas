"use client";

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/BrandLogo";
import { launchWhatsAppSignup, launchInstagramSignup, whatsappSignupReady, instagramSignupReady } from "@/lib/embedded-signup-client";
import { type Tab, DEFAULT_TENANT_ID, inp, btnPrimary, railLoading, type ChannelRow, ChannelSelect, setChannelCache, type Conversation, type AnalyticsData, type FlowSummary, type AiAgentT, type AiParamT, type AiFunctionT, type AiPromptT, ImageUpload, ConvAvatar, ImgFallback, RailCard, StatRow, RailBar, statusBadge, useAnalytics } from "./_shared";
import { Loader2, Send, Users, History, Zap, Ban, LogOut, UploadCloud, Check, Trash2, Plus, Bot, MessageSquare, Database, Sparkles, ShieldCheck, ArrowRight, Globe, FileText, BarChart3, LayoutTemplate, FlaskConical, Home, CircleCheck, CircleDashed, Settings, Tag, UserCheck, RefreshCw, Image as ImageIcon, Video, Phone, Link2, Copy, X, GalleryHorizontalEnd, Star, Filter, Download, ChevronLeft, ChevronRight, ArrowLeft, MousePointerClick, Reply, AlertTriangle, ClipboardList, ExternalLink, Search, Megaphone, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, MapPin, Instagram, Workflow, ShoppingBag, TrendingUp, ListChecks, Plug } from "lucide-react";

// Heavy, self-contained tabs are lazy-loaded (next/dynamic) so each ships as its
// own chunk instead of bloating the initial admin bundle. ssr:false — the whole
// dashboard is client-rendered and tabs mount only after the user opens them.
const tabLoading = <div className="p-10 text-center text-sm text-ink-400"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Loading…</div>;
const AdsTab = dynamic(() => import("./_tabs/AdsTab"), { ssr: false, loading: () => tabLoading });
const AnalyticsTab = dynamic(() => import("./_tabs/AnalyticsTab"), { ssr: false, loading: () => tabLoading });
const CampaignsTab = dynamic(() => import("./_tabs/CampaignsTab"), { ssr: false, loading: () => tabLoading });
const SequencesTab = dynamic(() => import("./_tabs/SequencesTab"), { ssr: false, loading: () => tabLoading });
const CatalogTab = dynamic(() => import("./_tabs/CatalogTab"), { ssr: false, loading: () => tabLoading });
const InstagramTab = dynamic(() => import("./_tabs/InstagramTab"), { ssr: false, loading: () => tabLoading });
const TemplatesTab = dynamic(() => import("./_tabs/TemplatesTab"), { ssr: false, loading: () => tabLoading });
const FlowsTab = dynamic(() => import("./_tabs/FlowsTab"), { ssr: false, loading: () => tabLoading });
const AiHubTab = dynamic(() => import("./_tabs/AiHubTab"), { ssr: false, loading: () => tabLoading });
const GrowthTab = dynamic(() => import("./_tabs/GrowthTab"), { ssr: false, loading: () => tabLoading });
const OptoutsTab = dynamic(() => import("./_tabs/OptoutsTab"), { ssr: false, loading: () => tabLoading });
const SetupTab = dynamic(() => import("./_tabs/SetupTab"), { ssr: false, loading: () => tabLoading });
const IntegrationsTab = dynamic(() => import("./_tabs/IntegrationsTab"), { ssr: false, loading: () => tabLoading });
const AssistantTab = dynamic(() => import("./_tabs/AssistantTab"), { ssr: false, loading: () => tabLoading });
const FormsTab = dynamic(() => import("./_tabs/FormsTab"), { ssr: false, loading: () => tabLoading });
const BroadcastTab = dynamic(() => import("./_tabs/BroadcastTab"), { ssr: false, loading: () => tabLoading });

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
      { key: "setup", label: "Setup & status", icon: <ListChecks className="w-[18px] h-[18px]" /> },
      { key: "integrations", label: "Integrations", icon: <Plug className="w-[18px] h-[18px]" /> },
      { key: "optouts", label: "Opt-outs", icon: <Ban className="w-[18px] h-[18px]" /> },
      { key: "settings", label: "Settings", icon: <Settings className="w-[18px] h-[18px]" /> },
    ],
  },
];
const TAB_TITLES: Record<Tab, string> = {
  home: "Home", livechat: "Live Chat", broadcast: "Broadcast", ads: "Meta Ads", instagram: "Instagram", assistant: "AI Knowledge Base", flows: "Chatbot Flows",
  sequences: "Sequences", catalog: "Catalog", growth: "Growth Tools",
  aihub: "AI Hub", templates: "Templates", forms: "WhatsApp Forms", analytics: "Analytics",
  contacts: "Contacts", campaigns: "History", optouts: "Opt-outs", settings: "Settings", setup: "Setup & status", integrations: "Integrations",
};

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
          <BrandLogo height={40} className="max-w-[200px]" fallback={
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
          {tab === "setup" && <SetupTab goTo={setTab} />}
          {tab === "integrations" && <IntegrationsTab goTo={setTab} />}
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
// inp / btnPrimary / railLoading, the channels picker (ChannelSelect) and the
// shared mini-components (ConvAvatar/ImageUpload/ImgFallback/RailCard/StatRow/
// RailBar) now live in ./_shared and are imported at the top of this file.

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

// useAnalytics + AnalyticsData live in ./_shared (rails + Analytics tab use them).


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

// AI Hub: setup status + how the pieces fit together.

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
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    setNotFound(false);
    fetch(`/api/admin/contacts/profile?phone=${encodeURIComponent(phone)}`).then(r => r.json())
      .then(d => { if (d.contact) setP(d); else { setP(null); setNotFound(true); } })
      .catch(() => setNotFound(true));
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
        {!c ? (notFound ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-slate-500">No profile found for this contact yet.</p>
            <button onClick={onClose} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas">Close</button>
          </div>
        ) : <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>) : (
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
    setChannelCache(d.channels ?? []);     // keep the shared pickers in sync
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


// Per-tenant LeadSquared CRM credentials — each workspace uses their own CRM.
function LsqSettingsCard() {
  type LsqState = { configured: boolean; accessKeyHint: string | null; secretKeySet: boolean; host: string | null; activityCode: string | null; taskCategory: string | null; igHandleField: string | null; autoCreate: boolean };
  const [st, setSt] = useState<LsqState | null>(null);
  const [form, setForm] = useState({ accessKey: "", secretKey: "", host: "", activityCode: "", taskCategory: "", igHandleField: "", autoCreate: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/leadsquared/settings").then(r => r.json()).then((d: LsqState) => {
      setSt(d);
      setForm(f => ({ ...f, host: d.host ?? "", activityCode: d.activityCode ?? "", taskCategory: d.taskCategory ?? "", igHandleField: d.igHandleField ?? "", autoCreate: !!d.autoCreate }));
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/leadsquared/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then(r => r.json());
      if (d.error) setMsg({ ok: false, text: d.error });
      else { setMsg({ ok: !!d.verify?.ok, text: d.verify?.detail || "Saved." }); setForm(f => ({ ...f, accessKey: "", secretKey: "" })); load(); }
    } catch { setMsg({ ok: false, text: "Connection error." }); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!confirm("Disconnect LeadSquared? Chats will stop syncing to your CRM.")) return;
    setBusy(true);
    try { await fetch("/api/admin/leadsquared/settings", { method: "DELETE" }); setMsg(null); load(); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-ink-900">LeadSquared CRM</h3>
          <p className="text-[12px] text-slate-500">Your own LeadSquared keys. Chats sync to each lead&apos;s timeline; stage/owner show in Live Chat. Used only by your workspace.</p>
        </div>
        {st?.configured && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">Connected</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className={inp} placeholder={st?.secretKeySet ? "Access Key — leave blank to keep current" : "Access Key"} value={form.accessKey} onChange={e => setForm({ ...form, accessKey: e.target.value })} />
        <input className={inp} type="password" placeholder={st?.secretKeySet ? "Secret Key — leave blank to keep current" : "Secret Key"} value={form.secretKey} onChange={e => setForm({ ...form, secretKey: e.target.value })} />
        <input className={inp} placeholder="API host (e.g. https://api-in21.leadsquared.com)" value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} />
        <input className={inp} placeholder="Activity code (e.g. 100)" value={form.activityCode} onChange={e => setForm({ ...form, activityCode: e.target.value })} />
        <input className={inp} placeholder="Task category (optional, default 2)" value={form.taskCategory} onChange={e => setForm({ ...form, taskCategory: e.target.value })} />
        <input className={inp} placeholder="IG handle field (optional, e.g. mx_Instagram)" value={form.igHandleField} onChange={e => setForm({ ...form, igHandleField: e.target.value })} />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
        <input type="checkbox" className="accent-brand-700" checked={form.autoCreate} onChange={e => setForm({ ...form, autoCreate: e.target.checked })} />
        Auto-create a lead for new inbound contacts (off = only sync to existing leads)
      </label>
      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save & verify"}</button>
        {st?.configured && <button onClick={disconnect} disabled={busy} className="px-3 py-1.5 rounded-control border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-60">Disconnect</button>}
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

      {isAdmin && <LsqSettingsCard />}
      {isAdmin && <ApiKeysCard />}
    </div>
    <SettingsRail goTo={goTo} />
    </div>
  );
}

// ── Chatbot Flows: list + create (editor opens at /admin/flows/[id]) ──────────
// FlowSummary / AiAgentT etc. live in ./_shared (FlowsRail + AiHubRail moved into their tab modules).

