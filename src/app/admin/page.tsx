"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSlidingPill, useScrolled } from "@/lib/use-nav-motion";
import { useInboxAlerts } from "@/lib/use-inbox-alerts";
import { AlertsBell } from "@/components/alerts-bell";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand } from "@/components/BrandContext";
import { type Tab, type ChatIntent, type GoTo, DEFAULT_TENANT_ID, inp, btnPrimary, railLoading, ChannelSelect, type AnalyticsData, ImageUpload, ConvAvatar, ImgFallback, RailCard, StatRow, RailBar, useAnalytics } from "./_shared";
import { type Entitlements, type AccountState, tabAllowed, tabRoleAllowed, accountState } from "@/lib/entitlement-registry";
import { Send, Users, History, Zap, Ban, LogOut, Bot, MessageSquare, Facebook, Youtube, Globe, Database, Sparkles, ShieldCheck, ArrowRight, BarChart3, LayoutTemplate, FlaskConical, Home, Settings, ClipboardList, Megaphone, Instagram, Workflow, ShoppingBag, TrendingUp, ListChecks, Plug, KanbanSquare, AtSign, Star, AlertTriangle, Eye, CreditCard } from "lucide-react";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { ProductTour } from "@/components/ProductTour";
import { HoverHelp } from "@/components/HoverHelp";
import { Mascot } from "@/components/Mascot";
import { VocabProvider, useVocab } from "@/lib/vocab-client";
import type { Vocab } from "@/lib/vocab";

// Heavy, self-contained tabs are lazy-loaded (next/dynamic) so each ships as its
// own chunk instead of bloating the initial admin bundle. ssr:false — the whole
// dashboard is client-rendered and tabs mount only after the user opens them.
// A skeleton — not a bare spinner — so a loading tab reads as structure
// arriving, not a blank flash (Apple: show the common path first). Under
// reduced-motion the pulse is neutralized to a static block by globals.css.
const tabLoading = (
  <div className="p-6 space-y-4">
    <div className="h-7 w-52 rounded-control bg-slate-100 animate-pulse" />
    <div className="grid gap-4 sm:grid-cols-3">
      {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-card bg-slate-100 animate-pulse" />)}
    </div>
    <div className="h-72 rounded-card bg-slate-100 animate-pulse" />
  </div>
);

// next/dynamic requires an inline import + object-literal options (SWC static
// analysis), so these stay inline. ssr:false — tabs mount only once opened.
const AdsTab = dynamic(() => import("./_tabs/AdsTab"), { ssr: false, loading: () => tabLoading });
const AnalyticsTab = dynamic(() => import("./_tabs/AnalyticsTab"), { ssr: false, loading: () => tabLoading });
const CampaignsTab = dynamic(() => import("./_tabs/CampaignsTab"), { ssr: false, loading: () => tabLoading });
const SequencesTab = dynamic(() => import("./_tabs/SequencesTab"), { ssr: false, loading: () => tabLoading });
const CatalogTab = dynamic(() => import("./_tabs/CatalogTab"), { ssr: false, loading: () => tabLoading });
const InstagramTab = dynamic(() => import("./_tabs/InstagramTab"), { ssr: false, loading: () => tabLoading });
const FacebookTab = dynamic(() => import("./_tabs/FacebookTab"), { ssr: false, loading: () => tabLoading });
const YoutubeTab = dynamic(() => import("./_tabs/YoutubeTab"), { ssr: false, loading: () => tabLoading });
const WebchatTab = dynamic(() => import("./_tabs/WebchatTab"), { ssr: false, loading: () => tabLoading });
const ReviewsTab = dynamic(() => import("./_tabs/ReviewsTab"), { ssr: false, loading: () => tabLoading });
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
const SecurityTab = dynamic(() => import("./_tabs/SecurityTab"), { ssr: false, loading: () => tabLoading });
const TeamProgressTab = dynamic(() => import("./_tabs/TeamProgressTab"), { ssr: false, loading: () => tabLoading });

// Warm a tab's chunk on nav hover/focus so it's in memory by click time (the
// same import() → same webpack chunk as the dynamic() above, just eager). This
// is what removes the chunk-load flash; the skeleton only shows if a user clicks
// faster than the download.
const PRELOAD: Partial<Record<Tab, () => Promise<unknown>>> = {
  livechat: () => import("./_tabs/LiveChatTab"),
  broadcast: () => import("./_tabs/BroadcastTab"),
  contacts: () => import("./_tabs/ContactsTab"),
  pipeline: () => import("./_tabs/PipelineTab"),
  campaigns: () => import("./_tabs/CampaignsTab"),
  analytics: () => import("./_tabs/AnalyticsTab"),
  ads: () => import("./_tabs/AdsTab"),
  instagram: () => import("./_tabs/InstagramTab"),
  facebook: () => import("./_tabs/FacebookTab"),
  youtube: () => import("./_tabs/YoutubeTab"),
  webchat: () => import("./_tabs/WebchatTab"),
  assistant: () => import("./_tabs/AssistantTab"),
  flows: () => import("./_tabs/FlowsTab"),
  sequences: () => import("./_tabs/SequencesTab"),
  catalog: () => import("./_tabs/CatalogTab"),
  growth: () => import("./_tabs/GrowthTab"),
  handlehub: () => import("./_tabs/HandleHubTab"),
  aihub: () => import("./_tabs/AiHubTab"),
  templates: () => import("./_tabs/TemplatesTab"),
  forms: () => import("./_tabs/FormsTab"),
  optouts: () => import("./_tabs/OptoutsTab"),
  setup: () => import("./_tabs/SetupTab"),
  integrations: () => import("./_tabs/IntegrationsTab"),
  settings: () => import("./_tabs/SettingsTab"),
  security: () => import("./_tabs/SecurityTab"),
  team: () => import("./_tabs/TeamProgressTab"),
};
const preloadTab = (t: Tab) => { void PRELOAD[t]?.(); };

// Sidebar nav, grouped by WHAT THE USER IS TRYING TO DO rather than by internal
// feature area — the old single 13-item "Main Menu" mixed the daily inbox with
// per-platform setup, so nothing was findable. Each item carries a plain-English
// `hint` is shown by contextual help after four seconds of dwell, so a label
// like "Sequences" explains itself to anyone who pauses on it.
const NAV_GROUPS: { group: string; items: { key: Tab; label: string; icon: React.ReactNode; hint: string }[] }[] = [
  {
    group: "Home & Inbox",
    items: [
      { key: "home", label: "Home", icon: <Home className="w-[18px] h-[18px]" />, hint: "Your dashboard and setup progress" },
      { key: "livechat", label: "Live Chat", icon: <MessageSquare className="w-[18px] h-[18px]" />, hint: "Every conversation from every channel, in one inbox" },
      { key: "contacts", label: "Contacts", icon: <Users className="w-[18px] h-[18px]" />, hint: "Everyone who has ever messaged you" },
      { key: "pipeline", label: "Sales Pipeline", icon: <KanbanSquare className="w-[18px] h-[18px]" />, hint: "Drag leads from new enquiry to won" },
      { key: "analytics", label: "Analytics", icon: <BarChart3 className="w-[18px] h-[18px]" />, hint: "See what's working — messages, replies, sales" },
      // Only a team lead or an admin ever sees this (tabRoleAllowed filters the nav).
      { key: "team", label: "Team Progress", icon: <Users className="w-[18px] h-[18px]" />, hint: "Is your team keeping up, and who is behind" },
    ],
  },
  {
    group: "Your Channels",
    items: [
      { key: "instagram", label: "Instagram", icon: <Instagram className="w-[18px] h-[18px]" />, hint: "Auto-reply to Instagram DMs and comments" },
      { key: "facebook", label: "Facebook", icon: <Facebook className="w-[18px] h-[18px]" />, hint: "Auto-reply to Facebook Page messages and comments" },
      { key: "youtube", label: "YouTube", icon: <Youtube className="w-[18px] h-[18px]" />, hint: "Auto-reply to video comments and hide spam" },
      { key: "reviews", label: "Google Reviews", icon: <Star className="w-[18px] h-[18px]" />, hint: "Reply to your Google Business Profile reviews" },
      { key: "webchat", label: "Website Chat", icon: <Globe className="w-[18px] h-[18px]" />, hint: "Add a chat bubble to your website" },
    ],
  },
  {
    group: "Send Messages",
    items: [
      { key: "broadcast", label: "Broadcast", icon: <Send className="w-[18px] h-[18px]" />, hint: "Send one message to many people at once" },
      { key: "templates", label: "Templates", icon: <LayoutTemplate className="w-[18px] h-[18px]" />, hint: "Message formats WhatsApp has approved" },
      { key: "sequences", label: "Sequences", icon: <Workflow className="w-[18px] h-[18px]" />, hint: "Automatic follow-up messages over days" },
      { key: "campaigns", label: "History", icon: <History className="w-[18px] h-[18px]" />, hint: "Everything you've already sent" },
    ],
  },
  {
    group: "AI & Automation",
    items: [
      { key: "assistant", label: "AI Knowledge Base", icon: <Bot className="w-[18px] h-[18px]" />, hint: "Teach the AI about your business so it answers correctly" },
      { key: "flows", label: "Chatbot Flows", icon: <Zap className="w-[18px] h-[18px]" />, hint: "Build a step-by-step chat with buttons — no code" },
      { key: "aihub", label: "AI Hub", icon: <Sparkles className="w-[18px] h-[18px]" />, hint: "AI personalities, tools and your own AI key" },
    ],
  },
  {
    group: "Grow & Sell",
    items: [
      { key: "catalog", label: "Catalog", icon: <ShoppingBag className="w-[18px] h-[18px]" />, hint: "Your products, and checkout inside the chat" },
      { key: "growth", label: "Growth Tools", icon: <TrendingUp className="w-[18px] h-[18px]" />, hint: "Opt-in links and lead magnets that grow your list" },
      { key: "handlehub", label: "Links & QR Codes", icon: <AtSign className="w-[18px] h-[18px]" />, hint: "Trackable chat links and QR codes for posters, ads and bios" },
      { key: "forms", label: "WhatsApp Forms", icon: <ClipboardList className="w-[18px] h-[18px]" />, hint: "Collect name, email and details inside a chat" },
      { key: "ads", label: "Meta Ads", icon: <Megaphone className="w-[18px] h-[18px]" />, hint: "Run Facebook and Instagram ads that open a chat" },
    ],
  },
  {
    group: "Settings & Setup",
    items: [
      { key: "setup", label: "Setup Guide", icon: <ListChecks className="w-[18px] h-[18px]" />, hint: "Step-by-step checklist to get fully live" },
      { key: "integrations", label: "Integrations", icon: <Plug className="w-[18px] h-[18px]" />, hint: "Connect your CRM, payments and other tools" },
      { key: "optouts", label: "Do Not Contact", icon: <Ban className="w-[18px] h-[18px]" />, hint: "People who asked to stop receiving messages" },
      { key: "settings", label: "Settings", icon: <Settings className="w-[18px] h-[18px]" />, hint: "WhatsApp numbers, your team, and billing" },
      { key: "security", label: "Sign-in security", icon: <ShieldCheck className="w-[18px] h-[18px]" />, hint: "Your passkeys and authenticator app" },
    ],
  },
];
const TAB_TITLES: Record<Tab, string> = {
  home: "Home", livechat: "Live Chat", broadcast: "Broadcast", ads: "Meta Ads", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", webchat: "Website Chat", reviews: "Google Reviews", assistant: "AI Knowledge Base", flows: "Chatbot Flows",
  sequences: "Sequences", catalog: "Catalog", growth: "Growth Tools", handlehub: "Links & QR Codes",
  aihub: "AI Hub", templates: "Templates", forms: "WhatsApp Forms", analytics: "Analytics",
  contacts: "Contacts", pipeline: "Sales Pipeline", campaigns: "History", optouts: "Do Not Contact", settings: "Settings", setup: "Setup Guide", integrations: "Integrations", security: "Sign-in security", team: "Team Progress",
};

// The tabs whose names are the workspace's own nouns (Contacts → Students…).
// Everything else keeps its product name.
function tabLabel(tab: Tab, v: Vocab): string {
  if (tab === "contacts") return v.contact.many;
  if (tab === "pipeline") return v.pipeline.one;
  if (tab === "sequences") return v.sequence.many;
  return TAB_TITLES[tab];
}

export default function Admin() {
  return <VocabProvider><AdminShell /></VocabProvider>;
}

function AdminShell() {
  const { vocab } = useVocab();
  const brand = useBrand();   // Talko's, except inside a partner's portal
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("home");
  // A pending deep-link for Live Chat (set by Home cards / Pipeline / Contacts,
  // consumed by LiveChatTab on arrival). goTo switches tab and carries it along.
  const [chatIntent, setChatIntent] = useState<ChatIntent | null>(null);
  const goTo = useCallback<GoTo>((t, intent) => { setChatIntent(intent ?? null); setTab(t); }, []);
  const clearChatIntent = useCallback(() => setChatIntent(null), []);
  // Land on the right tab after a full-page redirect back into the SPA (e.g. the
  // YouTube "Connect with Google" OAuth round trip returns to /admin?tab=youtube).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && t in TAB_TITLES) setTab(t as Tab);
  }, []);
  const [me, setMe] = useState<{ email: string; name: string; role: string; team?: string | null; isPlatformOwner?: boolean; tenantId?: string } | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [banner, setBanner] = useState<{ title: string; body: string; level: string } | null>(null);
  // Shown once per full page load when the account isn't in good standing —
  // dismissing it sets state on THIS mounted component, so switching tabs
  // (a setTab call, no remount) never re-triggers it, but a fresh reload does.
  // It naturally disappears on its own the next time this loads after payment
  // clears: accountState() is recomputed from freshly-fetched `ent` below, so
  // there's nothing to explicitly "close on payment" — an active account just
  // never opens it.
  const [paywallDismissed, setPaywallDismissed] = useState(false);
  useEffect(() => {
    fetch("/api/admin/me").then(r => r.json()).then(d => {
      const u = d.user ?? null;
      setMe(u);
      setEnt(d.entitlements ?? null);
      setBanner(d.banner ?? null);
    }).catch(() => {});
  }, [router]);

  // If the active tab isn't entitled (e.g. deep-linked or after a plan change),
  // fall back to Home so a hidden feature can never render.
  useEffect(() => { if (ent && !tabAllowed(tab, ent)) setTab("home"); }, [ent, tab]);

  // A member who deep-links (?tab=growth) or follows an old bookmark to an
  // admin-only tab gets an explanation instead of an empty list — the tab's own
  // API would just 403 into a blank screen. Only evaluated once /api/admin/me
  // has answered, so it never flashes for an admin.
  const roleBlocked = !!me && !tabRoleAllowed(tab, me.role);

  const impersonating = !!me?.isPlatformOwner && !!me?.tenantId && me.tenantId !== DEFAULT_TENANT_ID;
  async function exitImpersonation() {
    await fetch("/api/owner/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) }).catch(() => {});
    router.push("/admin/owner"); router.refresh();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/login");
  }

  // The sidebar's active pill glides to the section picked; the top bar's
  // edge shows once the page scrolls under it (lib/use-nav-motion.ts).
  const navList = useRef<HTMLDivElement>(null);
  const pill = useSlidingPill(navList, tab, [ent, me?.role]);
  const scrolled = useScrolled();
  // Chats waiting for a person: the bell, the tab title, a chime and desktop
  // notifications, on every screen (lib/use-inbox-alerts.ts).
  const alerts = useInboxAlerts(chat => goTo("livechat", { openPhone: chat.phone }));

  return (
    <ConfirmProvider>
    <div className="min-h-screen flex bg-canvas">
      <aside className="w-64 shrink-0 bg-white border-r border-line flex flex-col h-screen sticky top-0">
        {/* Logo block */}
        <div className="px-5 py-4">
          <BrandLogo height={28} className="max-w-[150px]" fallback={
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center shrink-0">
                <MessageSquare className="w-4 h-4 text-white" />
              </div>
              <p className="text-[13px] font-bold text-ink-900 leading-tight">{brand.name}</p>
            </div>
          } />
          {brand.tagline && <p className="text-[10px] text-ink-400 leading-tight truncate mt-1.5">{brand.tagline}</p>}
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
        <nav aria-label="Workspace navigation" className="flex-1 px-3 py-2 overflow-y-auto">
          <div ref={navList} className="relative">
          <span aria-hidden className="nav-pill absolute left-0 right-0 top-0 rounded-full bg-ink-950" style={pill.style} data-ready={pill.ready || undefined} />
          {NAV_GROUPS.map(g => {
            const items = g.items.filter(n => tabAllowed(n.key, ent) && tabRoleAllowed(n.key, me?.role));
            if (!items.length) return null;
            return (
            <div key={g.group} className="mb-4">
              <p className="px-3 mb-1.5 text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em]">{g.group}</p>
              <div className="space-y-0.5">
                {items.map(n => {
                  const active = tab === n.key;
                  return (
                    <button key={n.key} data-tour-nav={n.key} data-nav-key={n.key} aria-current={active ? "page" : undefined} data-help={n.hint + ". Select this screen to open it and use the available controls."} onClick={() => goTo(n.key)}
                      onMouseEnter={() => preloadTab(n.key)} onFocus={() => preloadTab(n.key)}
                      className={`nav-item relative w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-medium text-left ${active ? "text-white" : "text-ink-600 hover:bg-canvas"}`}>
                      {n.icon}<span className="truncate">{tabLabel(n.key, vocab)}</span>
                      {n.key === "livechat" && alerts.count > 0 && (
                        <span aria-label={`${alerts.count} waiting`} className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[10px] font-bold leading-5 text-center tabular-nums">{alerts.count > 99 ? "99+" : alerts.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}
          </div>
        </nav>

        <div className="p-3 border-t border-line space-y-1">
          {me && (
            <div className="flex items-center gap-2.5 px-3 py-1.5">
              <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                {(me.name || me.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-ink-900 truncate leading-tight">{me.name || me.email}</p>
                <p className="text-[10px] text-ink-400 leading-tight">{me.role === "member" ? "Member" : me.role === "lead" ? "Team lead" : "Admin"}</p>
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
            <div className="shrink-0 px-6 py-2 text-[12px] font-semibold text-center bg-red-50 text-red-700 border-b border-red-200 flex items-center justify-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {a.message}
              {brand.partnerId
                ? (brand.supportEmail && <a href={`mailto:${brand.supportEmail}`} className="px-2 py-0.5 rounded-control bg-red-600 text-white text-[11px] font-bold hover:bg-red-700">Contact {brand.name}</a>)
                : <a href="/admin/billing" className="px-2 py-0.5 rounded-control bg-red-600 text-white text-[11px] font-bold hover:bg-red-700">Manage billing</a>}
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
<ShieldCheck className="w-3.5 h-3.5" /> Owner preview — this is the platform&apos;s default workspace
            <a href="/admin/owner" className="px-2 py-0.5 rounded-control bg-brand-700 text-white text-[11px] font-bold hover:bg-brand-800">Open Owner Portal</a>
          </div>
        )}
        {impersonating && (
          <div className="h-9 shrink-0 bg-amber-50 border-b border-amber-200 flex items-center justify-center gap-3 text-[12px] text-amber-800 font-semibold">
<Eye className="w-3.5 h-3.5" /> You&apos;re viewing a tenant&apos;s workspace as the owner
            <button onClick={exitImpersonation} className="px-2 py-0.5 rounded-control bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700">Exit to Owner Portal</button>
          </div>
        )}
        {/* Topbar */}
        <header className="glass-bar h-16 shrink-0 border-b flex items-center justify-between px-6 sticky top-0 z-10" data-scrolled={scrolled || undefined}>
          <p className="text-[13px] text-ink-400">
            {brand.name} <span className="mx-1">/</span> <span className="text-ink-900 font-medium">{tabLabel(tab, vocab)}</span>
          </p>
          <div className="flex items-center gap-2">
          <AlertsBell alerts={alerts} onOpen={chat => goTo("livechat", { openPhone: chat.phone })} />
          {me && <ProductTour tenantId={me.tenantId ?? DEFAULT_TENANT_ID} email={me.email} activeTab={tab}
            blocked={!paywallDismissed && !me.isPlatformOwner && !accountState(ent).active} impersonating={impersonating} />}
          {tabAllowed("broadcast", ent) && tabRoleAllowed("broadcast", me?.role) && (
            <button data-help="Choose an approved template and audience, review the message, then send or schedule your broadcast." onClick={() => setTab("broadcast")} className={btnPrimary}>
              <Send className="w-4 h-4" /> New broadcast
            </button>
          )}
          </div>
        </header>

        <main className="flex-1 p-6 overflow-x-hidden">
          {roleBlocked ? <AdminOnlyTab title={tabLabel(tab, vocab)} goTo={goTo} /> : <>
          {tab === "home" && <HomeTab goTo={goTo} />}
          {tab === "livechat" && <LiveChatTab goTo={goTo} intent={chatIntent} clearIntent={clearChatIntent} />}
          {tab === "broadcast" && <BroadcastTab goTo={goTo} />}
          {tab === "ads" && <AdsTab goTo={goTo} />}
          {tab === "instagram" && <InstagramTab />}
          {tab === "facebook" && <FacebookTab />}
          {tab === "youtube" && <YoutubeTab />}
          {tab === "webchat" && <WebchatTab />}
          {tab === "reviews" && <ReviewsTab />}
          {tab === "assistant" && <AssistantTab goTo={goTo} />}
          {tab === "flows" && <FlowsTab />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "catalog" && <CatalogTab />}
          {tab === "growth" && <GrowthTab />}
          {tab === "handlehub" && <HandleHubTab />}
          {tab === "aihub" && <AiHubTab goTo={goTo} />}
          {tab === "templates" && <TemplatesTab />}
          {tab === "forms" && <FormsTab goTo={goTo} />}
          {tab === "analytics" && <AnalyticsTab isAdmin={me?.role === "admin"} />}
          {tab === "contacts" && <ContactsTab goTo={goTo} />}
          {tab === "pipeline" && <PipelineTab goTo={goTo} />}
          {tab === "campaigns" && <CampaignsTab goTo={goTo} />}
          {tab === "optouts" && <OptoutsTab />}
          {tab === "setup" && <SetupTab goTo={goTo} />}
          {tab === "integrations" && <IntegrationsTab goTo={goTo} />}
          {tab === "settings" && <SettingsTab goTo={goTo} />}
          {tab === "security" && <SecurityTab />}
          {tab === "team" && <TeamProgressTab me={me ? { role: me.role as "admin" | "lead" | "member", team: (me.team ?? null) as import("@/lib/team-vocab").Team | null } : null} goTo={goTo} />}
          </>}
        </main>
      </div>
      {me && <HoverHelp scope={tab} />}
      {!paywallDismissed && !me?.isPlatformOwner && (() => {
        const a = accountState(ent);
        if (a.active) return null;
        return <PaywallModal state={a.state} message={a.message} onClose={() => setPaywallDismissed(true)} />;
      })()}
    </div>
    </ConfirmProvider>
  );
}

// Shown when a member opens an admin-only tab by URL. A read-only explanation
// with a way out — never a blank screen and never a silent redirect.
function AdminOnlyTab({ title, goTo }: { title: string; goTo: GoTo }) {
  return (
    <div className="max-w-md mx-auto mt-16 text-center space-y-3">
      <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center mx-auto"><ShieldCheck className="w-5 h-5" /></div>
      <h2 className="text-lg font-extrabold text-ink-900">{title} is admin-only</h2>
      <p className="text-sm text-ink-500">Your account is a <b>Member</b>, so this section is hidden. Ask a workspace admin to set it up for you — or to change your role in Settings &rarr; Team.</p>
      <button onClick={() => goTo("home")} className={`${btnPrimary} mx-auto`}>Back to Home</button>
    </div>
  );
}

// One popup for every reason accountState() can go inactive — trial ran out,
// last payment failed, or the workspace was suspended. Dismissible: closing it
// still lets the tenant read everything (Live Chat history, contacts,
// analytics) — accountState() is explicitly a READ-ONLY soft block, never a
// data lock. What actually stops working is guarded server-side per write
// route (guardAccount(), src/lib/feature-guard.ts), so a dismissed popup isn't
// the only thing standing between an expired trial and a free ride: an
// attempted send still gets refused with the same message, just as a plain
// error instead of this modal reopening.
const PAYWALL_COPY: Record<AccountState, { title: string }> = {
  ok: { title: "" },   // never rendered — accountState() only reaches here when inactive
  trial_expired: { title: "Your free trial has ended" },
  past_due: { title: "Your last payment failed" },
  suspended: { title: "Your workspace is paused" },
};
function PaywallModal({ state, message, onClose }: { state: AccountState; message: string; onClose: () => void }) {
  const brand = useBrand();
  return (
    <div className="fixed inset-0 z-50 bg-ink-950/40 flex items-center justify-center p-4 u-fade-in">
      <div className="w-full max-w-md bg-white rounded-card border border-line p-6 space-y-4 u-scale-in">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-extrabold text-ink-900">{PAYWALL_COPY[state].title}</h3>
          <p className="text-sm text-ink-500 mt-1.5 leading-relaxed">{message} Your data is safe and nothing is deleted — pick a plan to pick up right where you left off.</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button onClick={onClose} className="text-xs font-semibold text-ink-400 hover:text-ink-700">Maybe later</button>
          {brand.partnerId
            ? (brand.supportEmail && <a href={`mailto:${brand.supportEmail}`} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5">Contact {brand.name}</a>)
            : <a href="/admin/billing" className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> See plans</a>}
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
// The setup checklist (steps … live) is sent to the platform owner only;
// counts and router go to everyone.
interface SystemStatus {
  steps?: Record<string, SetupStep>;
  completed?: number;
  totalRequired?: number;
  live?: boolean;
  router?: { enabled: boolean; faqEntries: number };
  counts: { contacts: number; kbDocuments: number; conversations: number; needsAttention: number };
}

function HomeTab({ goTo }: { goTo: GoTo }) {
  const { vocab } = useVocab();
  const brand = useBrand();
  const [s, setS] = useState<SystemStatus | null>(null);
  useEffect(() => { fetch("/api/admin/system/status").then(r => r.json()).then(setS).catch(() => undefined); }, []);

  const guide: { icon: React.ReactNode; title: string; text: string; cta: string; tab: Tab }[] = [
    { icon: <Database className="w-5 h-5" />, title: "1 · Teach the AI", text: "Upload your business docs (PDF, text, website URL) so the assistant can answer customer questions.", cta: "Add knowledge", tab: "assistant" },
    { icon: <FlaskConical className="w-5 h-5" />, title: "2 · Test it", text: "Ask the assistant questions in the test box — no WhatsApp needed. See whether the answer came from FAQ, cache, or AI.", cta: "Test assistant", tab: "assistant" },
    { icon: <Users className="w-5 h-5" />, title: `3 · Add ${vocab.contact.many.toLowerCase()}`, text: `Import a CSV or add ${vocab.contact.many.toLowerCase()} with tags and attributes (e.g. city, interest) for targeted broadcasts.`, cta: `Import ${vocab.contact.many.toLowerCase()}`, tab: "contacts" },
    { icon: <Send className="w-5 h-5" />, title: "4 · Broadcast", text: "Pick an approved template, choose an audience (all / tag / attribute), and send. Replies land in Live Chat where the AI answers automatically.", cta: "Send a broadcast", tab: "broadcast" },
  ];

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-4xl space-y-6">
      {/* Talko greets you here, and the expression is a status signal rather
          than decoration: it is the first thing on the first screen, so it may
          as well say something true. Empty states elsewhere only appear on an
          empty account — on a working one the mascot was effectively invisible,
          which is the bug this fixes. */}
      <div className="flex items-start gap-4">
        <Mascot
          size={64}
          className="shrink-0 -mt-1"
          mood={
            !s ? "thinking"                              // still loading
            : s.counts.needsAttention > 0 ? "oops"       // chats are waiting on a human
            : s.counts.kbDocuments === 0 ? "sleeping"    // nothing taught yet
            : "happy"
          }
          label={brand.partnerId ? "Your assistant" : "Talko, your assistant"}
        />
        <div>
          <h2 className="text-xl font-bold">Welcome</h2>
          <p className="text-sm text-slate-500 mt-1">
            {s && s.counts.needsAttention > 0
              ? <>{s.counts.needsAttention} conversation{s.counts.needsAttention === 1 ? " is" : "s are"} waiting on a human — the AI handed {s.counts.needsAttention === 1 ? "it" : "them"} over. Everything else is running.</>
              : s && s.counts.kbDocuments === 0
                ? <>Nothing in the knowledge base yet, so the assistant has no business facts to answer from. Add a document or a website URL and it starts working.</>
                : <>This platform sends WhatsApp broadcasts, and an AI assistant answers replies automatically using your knowledge base. Humans take over anytime from Live Chat.</>}
          </p>
        </div>
      </div>

      {/* At a glance */}
      {s && (
        <div className="grid grid-cols-4 gap-3">
          {([
            { label: vocab.contact.many, value: s.counts.contacts, tab: "contacts" },
            { label: "Knowledge docs", value: s.counts.kbDocuments, tab: "assistant" },
            { label: "Conversations", value: s.counts.conversations, tab: "livechat" },
            // "Need attention" counts escalated chats — open Live Chat already
            // filtered to exactly that set.
            { label: "Need attention", value: s.counts.needsAttention, tab: "livechat", intent: { filter: "escalated" } },
          ] as { label: string; value: number; tab: Tab; intent?: ChatIntent }[]).map(c => (
            <button key={c.label} data-help-title={c.label} data-help={c.intent ? "Conversations escalated to a human. Select this card to open the inbox filtered to chats needing attention." : `Open ${tabLabel(c.tab, vocab)} to review the records counted here.`} onClick={() => goTo(c.tab, c.intent)} className="bg-white border border-line rounded-2xl p-4 text-left hover:border-brand-500">
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

      {s?.router?.enabled && (
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
                <p className="text-[10px] text-rose-600 truncate"><AlertTriangle className="inline w-3 h-3 mr-0.5 align-[-1px]" />{claims(f.unsupportedClaims)[0]}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </RailCard>
  );
}

function HomeRail({ goTo }: { goTo: GoTo }) {
  const { vocab } = useVocab();
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
      <RailCard title="Audience" action={vocab.contact.many} onAction={() => goTo("contacts")}>
        {!a ? railLoading : <>
          <StatRow label={`Active ${vocab.contact.many.toLowerCase()}`} value={a.contacts.active} onClick={() => goTo("contacts")} />
          <StatRow label="Opted out" value={a.contacts.optedOut} onClick={() => goTo("optouts")} />
          <StatRow label="Sent today" value={a.messaging.sentToday} />
        </>}
      </RailCard>
      <RailCard title="Quick actions">
        <div className="grid grid-cols-2 gap-1.5">
          {([["New broadcast", "broadcast"], ["Templates", "templates"], ["Chatbot Flows", "flows"], [`Import ${vocab.contact.many.toLowerCase()}`, "contacts"], ["WhatsApp Forms", "forms"], ["AI Hub", "aihub"]] as [string, Tab][]).map(([label, tab]) => (
            <button key={tab + label} onClick={() => goTo(tab)} className="px-2.5 py-2 rounded-control border border-line text-[11px] font-bold text-ink-600 hover:border-brand-500 hover:text-brand-700 text-left">{label}</button>
          ))}
        </div>
      </RailCard>
    </aside>
  );
}
