"use client";

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/BrandLogo";
import { launchWhatsAppSignup, launchInstagramSignup, whatsappSignupReady, instagramSignupReady } from "@/lib/embedded-signup-client";
import { type Tab, DEFAULT_TENANT_ID, inp, btnPrimary, railLoading, type ChannelRow, ChannelSelect, setChannelCache, type Conversation, type AnalyticsData, type FlowSummary, type AiAgentT, type AiParamT, type AiFunctionT, type AiPromptT, ImageUpload, ConvAvatar, ImgFallback, RailCard, StatRow, RailBar } from "./_shared";
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

// (AnalyticsData type lives in ./_shared — same payload the Analytics tab uses.)
function useAnalytics(): AnalyticsData | null {
  const [a, setA] = useState<AnalyticsData | null>(null);
  useEffect(() => { fetch("/api/admin/analytics").then(r => r.json()).then(d => setA(d.analytics ?? null)).catch(() => {}); }, []);
  return a;
}


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

// ── AI Assistant ───────────────────────────────────────────────────────────────
type KbDoc = { id: string; title: string; sourceType: "pdf" | "docx" | "text" | "url"; status: "processing" | "ready" | "failed"; chunkCount: number; error?: string | null; createdAt: string; lastSyncedAt?: string | null; tag?: string | null };
// ImageUpload, the Conversation type and ConvAvatar now live in ./_shared.

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

