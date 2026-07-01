"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/BrandLogo";
import { type Tab, type ChatIntent, type GoTo, DEFAULT_TENANT_ID, inp, btnPrimary, railLoading, ChannelSelect, type AnalyticsData, ImageUpload, ConvAvatar, ImgFallback, RailCard, StatRow, RailBar, useAnalytics } from "./_shared";
import { type Entitlements, tabAllowed, accountState } from "@/lib/entitlement-registry";
import { Loader2, Send, Users, History, Zap, Ban, LogOut, Bot, MessageSquare, Facebook, Database, Sparkles, ShieldCheck, ArrowRight, BarChart3, LayoutTemplate, FlaskConical, Home, Settings, ClipboardList, Megaphone, Instagram, Workflow, ShoppingBag, TrendingUp, ListChecks, Plug, KanbanSquare, AtSign } from "lucide-react";

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
const FacebookTab = dynamic(() => import("./_tabs/FacebookTab"), { ssr: false, loading: () => tabLoading });
const WebchatTab = dynamic(() => import("./_tabs/WebchatTab"), { ssr: false, loading: () => tabLoading });
const TemplatesTab = dynamic(() => import("./_tabs/TemplatesTab"), { ssr: false, loading: () => tabLoading });
const FlowsTab = dynamic(() => import("./_tabs/FlowsTab"), { ssr: false, loading: () => tabLoading });
const AiHubTab = dynamic(() => import("./_tabs/AiHubTab"), { ssr: false, loading: () => tabLoading });
const GrowthTab = dynamic(() => import("./_tabs/GrowthTab"), { ssr: false, loading: () => tabLoading });
const HandleHubTab = dynamic(() => import("./_tabs/HandleHubTab"), { ssr: false, loading: () => tabLoading });
const OptoutsTab = dynamic(() => import("./_tabs/OptoutsTab"), { ssr: false, loading: () => tabLoading });
const SetupTab = dynamic(() => import("./_tabs/SetupTab"), { ssr: false, loading: () => tabLoading });
const IntegrationsTab = dynamic(() => import("./_tabs/IntegrationsTab"), { ssr: false, loading: () => tabLoading });
const AssistantTab = dynamic(() => import("./_tabs/AssistantTab"), { ssr: false, loading: () => tabLoading });
const FormsTab = dynamic(() => import("./_tabs/FormsTab"), { ssr: false, loading: () => tabLoading });
const BroadcastTab = dynamic(() => import("./_tabs/BroadcastTab"), { ssr: false, loading: () => tabLoading });
const LiveChatTab = dynamic(() => import("./_tabs/LiveChatTab"), { ssr: false, loading: () => tabLoading });
const ContactsTab = dynamic(() => import("./_tabs/ContactsTab"), { ssr: false, loading: () => tabLoading });
const PipelineTab = dynamic(() => import("./_tabs/PipelineTab"), { ssr: false, loading: () => tabLoading });
const SettingsTab = dynamic(() => import("./_tabs/SettingsTab"), { ssr: false, loading: () => tabLoading });

const NAV_GROUPS: { group: string; items: { key: Tab; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Main Menu",
    items: [
      { key: "home", label: "Home", icon: <Home className="w-[18px] h-[18px]" /> },
      { key: "livechat", label: "Live Chat", icon: <MessageSquare className="w-[18px] h-[18px]" /> },
      { key: "broadcast", label: "Broadcast", icon: <Send className="w-[18px] h-[18px]" /> },
      { key: "contacts", label: "Contacts", icon: <Users className="w-[18px] h-[18px]" /> },
      { key: "pipeline", label: "Sales Pipeline", icon: <KanbanSquare className="w-[18px] h-[18px]" /> },
      { key: "campaigns", label: "History", icon: <History className="w-[18px] h-[18px]" /> },
      { key: "analytics", label: "Analytics", icon: <BarChart3 className="w-[18px] h-[18px]" /> },
      { key: "ads", label: "Meta Ads", icon: <Megaphone className="w-[18px] h-[18px]" /> },
      { key: "instagram", label: "Instagram", icon: <Instagram className="w-[18px] h-[18px]" /> },
      { key: "facebook", label: "Facebook", icon: <Facebook className="w-[18px] h-[18px]" /> },
      { key: "webchat", label: "Web Chat", icon: <MessageSquare className="w-[18px] h-[18px]" /> },
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
      { key: "handlehub", label: "Handle Hub", icon: <AtSign className="w-[18px] h-[18px]" /> },
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
  home: "Home", livechat: "Live Chat", broadcast: "Broadcast", ads: "Meta Ads", instagram: "Instagram", facebook: "Facebook", webchat: "Web Chat", assistant: "AI Knowledge Base", flows: "Chatbot Flows",
  sequences: "Sequences", catalog: "Catalog", growth: "Growth Tools", handlehub: "Handle Hub",
  aihub: "AI Hub", templates: "Templates", forms: "WhatsApp Forms", analytics: "Analytics",
  contacts: "Contacts", pipeline: "Sales Pipeline", campaigns: "History", optouts: "Opt-outs", settings: "Settings", setup: "Setup & status", integrations: "Integrations",
};

export default function Admin() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  // A pending deep-link for Live Chat (set by Home cards / Pipeline / Contacts,
  // consumed by LiveChatTab on arrival). goTo switches tab and carries it along.
  const [chatIntent, setChatIntent] = useState<ChatIntent | null>(null);
  const goTo = useCallback<GoTo>((t, intent) => { setChatIntent(intent ?? null); setTab(t); }, []);
  const clearChatIntent = useCallback(() => setChatIntent(null), []);
  const [me, setMe] = useState<{ email: string; name: string; role: string; isPlatformOwner?: boolean; tenantId?: string } | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [banner, setBanner] = useState<{ title: string; body: string; level: string } | null>(null);
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    fetch("/api/admin/me").then(r => r.json()).then(d => {
      const u = d.user ?? null;
      setMe(u);
      setEnt(d.entitlements ?? null);
      setBanner(d.banner ?? null);
      // The product owner can browse this app interface (the platform's default
      // workspace) AND jump to the Owner Portal via the sidebar. When viewing a
      // specific tenant they're impersonating (tenantId != default).
      const welcome = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("welcome") === "1";
      if (d.needsWalkthrough || welcome) setShowTour(true);
    }).catch(() => {});
  }, [router]);

  // If the active tab isn't entitled (e.g. deep-linked or after a plan change),
  // fall back to Home so a hidden feature can never render.
  useEffect(() => { if (ent && !tabAllowed(tab, ent)) setTab("home"); }, [ent, tab]);

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
        <div className="px-5 py-4">
          <BrandLogo height={28} className="max-w-[150px]" fallback={
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <p className="text-[13px] font-bold text-ink-900 leading-tight">Talko AI</p>
            </div>
          } />
          <p className="text-[10px] text-ink-400 leading-tight truncate mt-1.5">AI conversations for WhatsApp &amp; Instagram</p>
        </div>

        {/* Owner-only: jump to the platform control plane. Tenants never see this. */}
        {me?.isPlatformOwner && (
          <div className="px-3 pb-1">
            <a href="/admin/owner" className="w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-bold text-white bg-brand-700 hover:bg-brand-800 transition-colors" title="Manage every tenant, billing and feature flags">
              <ShieldCheck className="w-[18px] h-[18px]" /> Owner Portal
            </a>
          </div>
        )}

        {/* Grouped nav — items the tenant's plan doesn't include are hidden
            entirely (when entitlement enforcement is on; otherwise all show). */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto">
          {NAV_GROUPS.map(g => {
            const items = g.items.filter(n => tabAllowed(n.key, ent));
            if (!items.length) return null;
            return (
            <div key={g.group} className="mb-4">
              <p className="px-3 mb-1.5 text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">{g.group}</p>
              <div className="space-y-0.5">
                {items.map(n => {
                  const active = tab === n.key;
                  return (
                    <button key={n.key} onClick={() => goTo(n.key)}
                      className={`w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-medium text-left transition-colors ${active ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>
                      {n.icon}{n.label}
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}
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
        {(() => {
          const a = accountState(ent);
          if (a.active) return null;
          return (
            <div className="shrink-0 px-6 py-2 text-[12px] font-semibold text-center bg-red-50 text-red-700 border-b border-red-200 flex items-center justify-center gap-3">
              ⚠️ {a.message}
              <button onClick={() => setTab("settings")} className="px-2 py-0.5 rounded-control bg-red-600 text-white text-[11px] font-bold hover:bg-red-700">Manage billing</button>
            </div>
          );
        })()}
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
          {tabAllowed("broadcast", ent) && (
            <button onClick={() => setTab("broadcast")} className={btnPrimary}>
              <Send className="w-4 h-4" /> New broadcast
            </button>
          )}
        </header>

        <main className="flex-1 p-6 overflow-x-hidden">
          {tab === "home" && <HomeTab goTo={goTo} />}
          {tab === "livechat" && <LiveChatTab goTo={goTo} intent={chatIntent} clearIntent={clearChatIntent} />}
          {tab === "broadcast" && <BroadcastTab goTo={goTo} />}
          {tab === "ads" && <AdsTab goTo={goTo} />}
          {tab === "instagram" && <InstagramTab />}
          {tab === "facebook" && <FacebookTab />}
          {tab === "webchat" && <WebchatTab />}
          {tab === "assistant" && <AssistantTab goTo={goTo} />}
          {tab === "flows" && <FlowsTab />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "catalog" && <CatalogTab />}
          {tab === "growth" && <GrowthTab />}
          {tab === "handlehub" && <HandleHubTab />}
          {tab === "aihub" && <AiHubTab goTo={goTo} />}
          {tab === "templates" && <TemplatesTab />}
          {tab === "forms" && <FormsTab goTo={goTo} />}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "contacts" && <ContactsTab goTo={goTo} />}
          {tab === "pipeline" && <PipelineTab goTo={goTo} />}
          {tab === "campaigns" && <CampaignsTab goTo={goTo} />}
          {tab === "optouts" && <OptoutsTab />}
          {tab === "setup" && <SetupTab goTo={goTo} />}
          {tab === "integrations" && <IntegrationsTab goTo={goTo} />}
          {tab === "settings" && <SettingsTab goTo={goTo} />}
        </main>
      </div>
      {showTour && <Walkthrough goTo={goTo} onDone={() => setShowTour(false)} />}
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

function HomeTab({ goTo }: { goTo: GoTo }) {
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
          {([
            { label: "Contacts", value: s.counts.contacts, tab: "contacts" },
            { label: "Knowledge docs", value: s.counts.kbDocuments, tab: "assistant" },
            { label: "Conversations", value: s.counts.conversations, tab: "livechat" },
            // "Need attention" counts escalated chats — open Live Chat already
            // filtered to exactly that set.
            { label: "Need attention", value: s.counts.needsAttention, tab: "livechat", intent: { filter: "escalated" } },
          ] as { label: string; value: number; tab: Tab; intent?: ChatIntent }[]).map(c => (
            <button key={c.label} onClick={() => goTo(c.tab, c.intent)} className="bg-white border border-line rounded-2xl p-4 text-left hover:border-brand-500">
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
// Grounding health — the anti-hallucination feedback loop. Shows how often the
// firewall had to defer a specific (a KB-gap signal) and the AI replies the async
// auditor flagged as likely-ungrounded, each opening the chat for review.
type GroundingData = {
  stats: { deferred: number; flagged: number; audited: number };
  flagged: { id: string; conversationId: string; question: string; reply: string; coverageBand: string | null; unsupportedClaims: unknown; createdAt: string; contactName: string | null; phone: string | null }[];
};
function GroundingRail({ goTo }: { goTo: GoTo }) {
  const [g, setG] = useState<GroundingData | null>(null);
  useEffect(() => { fetch("/api/admin/grounding").then(r => r.json()).then(setG).catch(() => undefined); }, []);
  if (!g) return null;
  const claims = (c: unknown): string[] => Array.isArray(c) ? c.filter(x => typeof x === "string") : [];
  return (
    <RailCard title="Grounding health · 7d" action="Live Chat" onAction={() => goTo("livechat", { filter: "escalated" })}>
      <StatRow label="Specifics deferred" value={g.stats.deferred} tone={g.stats.deferred > 0 ? "warn" : undefined} />
      <StatRow label="Replies flagged" value={g.stats.flagged} tone={g.stats.flagged > 0 ? "bad" : undefined} />
      {g.stats.audited === 0 && g.stats.deferred === 0 && (
        <p className="text-[11px] text-slate-400 pt-1">No grounding issues — or the auditor isn’t enabled yet (set <code className="text-[10px]">GROUNDING_AUDIT</code>).</p>
      )}
      {g.flagged.length > 0 && (
        <div className="pt-1.5 mt-1 border-t border-line space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Flagged replies</p>
          {g.flagged.slice(0, 4).map(f => (
            <button key={f.id} onClick={() => goTo("livechat", { filter: "all" })} className="block w-full text-left rounded-md px-1.5 py-1 hover:bg-canvas">
              <p className="text-[11px] font-semibold text-ink-800 truncate">{f.question || "(reply)"}</p>
              {claims(f.unsupportedClaims).length > 0 && (
                <p className="text-[10px] text-rose-600 truncate">⚠ {claims(f.unsupportedClaims)[0]}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </RailCard>
  );
}

function HomeRail({ goTo }: { goTo: GoTo }) {
  const a = useAnalytics();
  const t = a?.messaging.totals;
  const pct = (n: number) => t && t.sent ? Math.round((n / t.sent) * 100) : 0;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Inbox pulse" action="Live Chat" onAction={() => goTo("livechat")}>
        {!a ? railLoading : <>
          <StatRow label="Awaiting your reply" value={a.conversations.needsReply} tone={a.conversations.needsReply > 0 ? "warn" : undefined} onClick={() => goTo("livechat", { filter: "needs_reply" })} />
          <StatRow label="Escalated to humans" value={a.conversations.escalated} tone={a.conversations.escalated > 0 ? "bad" : undefined} onClick={() => goTo("livechat", { filter: "escalated" })} />
          <StatRow label="Active conversations" value={a.conversations.active} onClick={() => goTo("livechat", { filter: "all" })} />
        </>}
      </RailCard>
      <GroundingRail goTo={goTo} />
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
