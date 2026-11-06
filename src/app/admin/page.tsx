"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSlidingPill } from "@/lib/use-nav-motion";
import { useInboxAlerts, type ReviewBellAlert } from "@/lib/use-inbox-alerts";
import { requestReviewFocus, reviewIdFromHref } from "@/lib/review-focus";
import { AlertsBell } from "@/components/alerts-bell";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand } from "@/components/BrandContext";
import { brandCopy } from "@/lib/whitelabel";
import { setPartnerMetaApp } from "@/lib/embedded-signup-client";
import { useTabInUrl } from "@/lib/tab-url";
import { TabErrorBoundary } from "@/components/tab-error-boundary";
import { type Tab, type ChatIntent, type GoTo, DEFAULT_TENANT_ID, btnPrimary } from "./_shared";
import { type Entitlements, type AccountState, tabAllowed, tabRoleAllowed, accountState } from "@/lib/entitlement-registry";
import { Send, LogOut, MessageSquare, ShieldCheck, ListTodo, ChevronDown, AlertTriangle, Eye, CreditCard, Menu, Search, X, LifeBuoy } from "lucide-react";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/toast";
import { Modal } from "@/components/overlay";
import { useProductTour, TourButton } from "@/components/ProductTour";
import { VocabProvider, useVocab } from "@/lib/vocab-client";
import type { Vocab } from "@/lib/vocab";
import { NAV_GROUPS, TAB_TITLES, WHATSAPP_SECTION, SETTINGS_SECTION_EVENT, activeNavKey, navItemState, canOpen, paletteEntries, attentionLabels, badgeText, type NavKey, type PaletteEntry } from "./_components/shell-logic";
import { useMediaQuery, useDrawerFocus, useTodaySummary, DESKTOP_QUERY } from "./_components/shell-hooks";
import { NavIconFor } from "./_components/nav-icons";
import { CommandPalette } from "./_components/CommandPalette";
import { MobileTabBar } from "./_components/MobileTabBar";
import { HomeTab } from "./_components/HomeTab";

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
const TodayTab = dynamic(() => import("./_tabs/TodayTab"), { ssr: false, loading: () => tabLoading });
const ResultsTab = dynamic(() => import("./_tabs/ResultsTab"), { ssr: false, loading: () => tabLoading });
const BookingsTab = dynamic(() => import("./_tabs/BookingsTab"), { ssr: false, loading: () => tabLoading });
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
  today: () => import("./_tabs/TodayTab"),
  results: () => import("./_tabs/ResultsTab"),
  bookings: () => import("./_tabs/BookingsTab"),
  reviews: () => import("./_tabs/ReviewsTab"),
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

// The menu (NAV_GROUPS), screen titles (TAB_TITLES) and who may see what
// (navItemState / canOpen) live in ./_components/shell-logic.ts, so the
// sidebar, the phone tab bar, the search box and Home all agree.
// Every section the address bar may name (?tab=…).
const ALL_TABS = Object.keys(TAB_TITLES) as Tab[];

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
  // The phone/tablet menu (below lg the sidebar is an off-canvas drawer).
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // A pending deep-link for Live Chat (set by Home cards / Pipeline / Contacts,
  // consumed by LiveChatTab on arrival). goTo switches tab and carries it along.
  const [chatIntent, setChatIntent] = useState<ChatIntent | null>(null);
  const goTo = useCallback<GoTo>((t, intent) => { setChatIntent(intent ?? null); setTab(t); setNavOpen(false); }, []);
  const clearChatIntent = useCallback(() => setChatIntent(null), []);
  // The section lives in the URL (?tab=flows): a refresh stays on it, Back and
  // Forward move between sections, and a full-page redirect back into the SPA
  // (the YouTube "Connect with Google" round trip returns to /admin?tab=youtube)
  // lands on the right one (lib/tab-url.ts).
  useTabInUrl(tab, setTab, ALL_TABS, "home");
  const [me, setMe] = useState<{ email: string; name: string; role: string; team?: string | null; isPlatformOwner?: boolean; tenantId?: string } | null>(null);
  // Whether /api/admin/me has answered (even with an error). Until it has,
  // menu items that depend on role or plan show a neutral placeholder.
  const [meLoaded, setMeLoaded] = useState(false);
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
      // White-label: connect through the partner's own Meta app (only set for
      // a partner workspace whose partner has one switched on).
      if (d.metaApp?.appId) setPartnerMetaApp({ appId: d.metaApp.appId, fbConfigId: d.metaApp.fbConfigId ?? null });
      setMe(u);
      setEnt(d.entitlements ?? null);
      setBanner(d.banner ?? null);
    }).catch(() => {}).finally(() => setMeLoaded(true));
  }, [router]);

  // If the active tab isn't entitled (e.g. deep-linked or after a plan change),
  // fall back to Home so a hidden feature can never render.
  useEffect(() => { if (ent && !tabAllowed(tab, ent)) setTab("home"); }, [ent, tab]);

  // A member who deep-links (?tab=growth) or follows an old bookmark to an
  // admin-only tab gets an explanation instead of an empty list — the tab's own
  // API would just 403 into a blank screen. Only evaluated once /api/admin/me
  // has answered, so it never flashes for an admin.
  const roleBlocked = !!me && !tabRoleAllowed(tab, me.role);
  const canOpenTab = useCallback((t: Tab) => canOpen(t, ent, me?.role), [ent, me?.role]);

  // Settings keeps its section in ?section= and reads it when it opens. A jump
  // to a section (the WhatsApp menu item, search) writes it first; the nonce
  // re-opens Settings when it is already showing, so the jump still lands.
  const [settingsNonce, setSettingsNonce] = useState(0);
  const setSectionParam = (section: string | null) => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (section) q.set("section", section); else q.delete("section");
      const qs = q.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    } catch { /* Settings opens on its first section */ }
  };
  const openSettings = useCallback((section: string | null) => {
    setSectionParam(section);
    setSettingsSection(section);
    setSettingsNonce(n => n + 1);
    goTo("settings");
  }, [goTo]);
  const openNav = useCallback((key: NavKey) => {
    if (key === "whatsapp") openSettings(WHATSAPP_SECTION);
    else if (key === "settings") openSettings(null);
    else goTo(key);
  }, [goTo, openSettings]);

  const impersonating = !!me?.isPlatformOwner && !!me?.tenantId && me.tenantId !== DEFAULT_TENANT_ID;
  async function exitImpersonation() {
    await fetch("/api/owner/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) }).catch(() => {});
    router.push("/admin/owner"); router.refresh();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/login");
  }

  // Below lg the sidebar is a drawer: a dialog while open, closed on Escape,
  // on the backdrop, after picking a screen, and when the window grows wide.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const asideRef = useRef<HTMLElement>(null);
  const closeNav = useCallback(() => setNavOpen(false), []);

  // The support chat (layout.tsx loads it for customers) floats a round button
  // over the bottom-right corner — on a phone that sits on top of the chat
  // list and the reply box. Once it has loaded, it opens from "Chat with
  // support" in the menu instead; the loader hides its floating button on
  // phones whenever the page carries data-twc-trig (and opens on any
  // [data-alabs-chat] click). Laptops keep the floating button.
  const [hasSupport, setHasSupport] = useState(false);
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      if ((window as unknown as { AlabsWC?: unknown }).AlabsWC) {
        document.documentElement.setAttribute("data-twc-trig", "1");
        setHasSupport(true);
        clearInterval(t);
      } else if (++tries > 40) clearInterval(t);
    }, 750);
    return () => clearInterval(t);
  }, []);
  useDrawerFocus(navOpen && !isDesktop, asideRef, closeNav);
  useEffect(() => { if (isDesktop) setNavOpen(false); }, [isDesktop]);

  // ⌘K / Ctrl+K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); setNavOpen(false); setSearchOpen(o => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [shortcut, setShortcut] = useState("Ctrl K");
  useEffect(() => { if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut("⌘K"); }, []);

  // The sidebar's active pill glides to the section picked (lib/use-nav-motion.ts).
  const navList = useRef<HTMLDivElement>(null);
  // Which part of Settings is open (Settings announces it), so the menu can
  // highlight WhatsApp for WhatsApp numbers. Results highlights Analytics.
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  useEffect(() => {
    try { setSettingsSection(new URLSearchParams(window.location.search).get("section")); } catch { /* none */ }
    const on = (e: Event) => setSettingsSection(typeof (e as CustomEvent).detail === "string" ? (e as CustomEvent).detail : null);
    window.addEventListener(SETTINGS_SECTION_EVENT, on);
    return () => window.removeEventListener(SETTINGS_SECTION_EVENT, on);
  }, []);
  const navTab = activeNavKey(tab, settingsSection);
  // "More tools" stays folded unless opened (remembered) or one of its screens is open.
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => { try { setMoreOpen(localStorage.getItem("talko-nav-more") === "1"); } catch { /* default folded */ } }, []);
  const toggleMore = () => setMoreOpen(o => { const n = !o; try { localStorage.setItem("talko-nav-more", n ? "1" : "0"); } catch { /* this visit only */ } return n; });
  // Today's work, every minute: the header badge (overdue) and Home share it.
  const today = useTodaySummary(!!me);
  // "xy": the pill is measured again when the items change height (the
  // phone menu shows each item's hint on a second line).
  const pill = useSlidingPill(navList, navTab, [ent, me?.role, meLoaded, moreOpen, isDesktop], "xy");
  // Chats waiting for a person: the bell, the tab title, a chime and desktop
  // notifications, on every screen (lib/use-inbox-alerts.ts). Its count is THE
  // "Waiting for you" number — Live Chat's badge, the phone's Inbox tab, Home.
  // A review alert opens that review in Reviews (lib/review-focus.ts).
  const openReviewAlert = useCallback((a: ReviewBellAlert) => {
    const id = a.reviewId ?? reviewIdFromHref(a.href);
    if (id) requestReviewFocus(id);
    goTo("reviews");
  }, [goTo]);
  const alerts = useInboxAlerts(chat => goTo("livechat", { openPhone: chat.phone }), openReviewAlert);
  const words = attentionLabels({ waiting: alerts.count, overdue: today.overdue });

  const account = accountState(ent);
  const tourBlocked = !me || (!paywallDismissed && !me.isPlatformOwner && !account.active);
  const startTour = useProductTour({ tenantId: me?.tenantId ?? DEFAULT_TENANT_ID, email: me?.email ?? "", activeTab: tab, blocked: tourBlocked, impersonating });
  // From the phone menu: close it first, so the tour points at the bottom bar.
  const startTourFromMenu = () => { setNavOpen(false); setSearchOpen(false); setTimeout(startTour, 350); };

  const palette = useMemo(() => paletteEntries({ ent, role: me?.role, loaded: meLoaded, label: t => tabLabel(t, vocab) }), [ent, me?.role, meLoaded, vocab]);
  const pick = (e: PaletteEntry) => {
    setSearchOpen(false);
    if (e.action === "tour") { setTimeout(startTour, 250); return; }
    if (e.tab === "settings") openSettings(e.section ?? null);
    else if (e.tab) goTo(e.tab, e.intent);
  };
  const canBroadcast = canOpenTab("broadcast") && meLoaded;

  return (
    <ConfirmProvider>
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:px-4 focus:py-2.5 focus:rounded-control focus:bg-ink-950 focus:text-white focus:text-sm focus:font-semibold">Skip to content</a>
    <div className="min-h-screen flex bg-canvas">
      {navOpen && !isDesktop && <div className="fixed inset-0 z-40 bg-ink-950/40 u-fade-in lg:hidden" onClick={closeNav} aria-hidden />}
      <aside ref={asideRef} id="portal-nav" aria-label="Menu"
        {...(navOpen && !isDesktop ? { role: "dialog", "aria-modal": true } : {})}
        className={`fixed inset-y-0 left-0 z-50 w-[min(20rem,86vw)] lg:sticky lg:top-0 lg:z-auto lg:w-64 shrink-0 bg-white border-r border-line flex flex-col h-[100dvh] lg:h-screen transition-[transform,visibility] duration-300 ease-out motion-reduce:transition-none ${navOpen ? "translate-x-0 visible shadow-2xl" : "-translate-x-full invisible lg:translate-x-0 lg:visible lg:shadow-none"}`}>
        {/* Logo block */}
        <div className="px-5 py-4 lg:px-6 lg:pt-6 lg:pb-5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <BrandLogo height={28} className="max-w-[150px]" fallback={
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-control bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-4 h-4 text-white" aria-hidden />
                </div>
                <p className="text-[13px] font-bold text-ink-900 leading-tight">{brand.name}</p>
              </div>
            } />
            {brand.tagline && <p className="text-[12px] text-ink-500 leading-tight truncate mt-1.5">{brand.tagline}</p>}
          </div>
          <button type="button" onClick={closeNav} data-autofocus aria-label="Close menu" className="lg:hidden -mr-2 -mt-1 w-11 h-11 inline-flex items-center justify-center rounded-full text-ink-600 hover:bg-canvas">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        {/* Owner-only: jump to the platform control plane. Tenants never see this. */}
        {me?.isPlatformOwner && (
          <div className="px-3 pb-1 lg:px-4 lg:pb-3">
            <a href="/admin/owner" className="w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-bold text-white bg-brand-700 hover:bg-brand-800 transition-colors" title="Manage every tenant, billing and feature flags">
              <ShieldCheck className="w-[18px] h-[18px]" aria-hidden /> Owner Portal
            </a>
          </div>
        )}

        {/* Phones and tablets: search and the header's spare buttons live here. */}
        <div className="lg:hidden px-3 pb-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setNavOpen(false); setSearchOpen(true); }} className="flex-1 min-w-[8rem] min-h-11 inline-flex items-center gap-2 px-3 rounded-full border border-line bg-canvas text-[13px] text-ink-600">
            <Search className="w-4 h-4" aria-hidden /> Search
          </button>
          <TourButton onStart={startTourFromMenu} blocked={tourBlocked} className="min-h-11" />
        </div>

        {/* Grouped nav — items the tenant's plan or role doesn't include are
            hidden; until /api/admin/me answers they show as placeholders. */}
        <nav aria-label="Workspace navigation" className="flex-1 px-3 py-2 lg:px-4 lg:pt-3 lg:pb-4 overflow-y-auto overscroll-contain">
          <div ref={navList} className="relative">
          <span aria-hidden className="nav-pill absolute left-0 top-0 rounded-[20px] lg:rounded-full bg-ink-950" style={pill.style} data-ready={pill.ready || undefined} />
          {NAV_GROUPS.map(g => {
            const items = g.items.map(n => ({ n, state: navItemState(n.key, ent, me?.role, meLoaded) })).filter(x => x.state !== "hide");
            if (!items.length) return null;
            const folding = g.group === "More tools";
            const shown = !folding || moreOpen || items.some(x => x.n.key === navTab);
            return (
            <div key={g.group} className="mb-4 lg:mb-6 lg:last:mb-0">
              {folding
                ? <button type="button" onClick={toggleMore} aria-expanded={shown} className="w-full min-h-10 lg:min-h-0 flex items-center justify-between px-3 mb-1.5 lg:mb-2.5 lg:pt-0.5 text-[12px] lg:text-[11px] font-medium text-ink-500 uppercase tracking-[0.06em] lg:tracking-[0.08em] hover:text-ink-700">
                    {g.group}<ChevronDown className={`w-3.5 h-3.5 transition-transform ${shown ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                : <p className="px-3 mb-1.5 lg:mb-2.5 lg:pt-0.5 text-[12px] lg:text-[11px] font-medium text-ink-500 uppercase tracking-[0.06em] lg:tracking-[0.08em]">{g.group}</p>}
              {shown && <div className="space-y-0.5 lg:space-y-1">
                {items.map(({ n, state }) => {
                  if (state === "pending") return <div key={n.key} aria-hidden className="h-10 mx-1 rounded-full bg-slate-100 animate-pulse" />;
                  const active = navTab === n.key;
                  const label = n.key === "whatsapp" ? n.label : tabLabel(n.key, vocab);
                  return (
                    <button type="button" key={n.key} data-tour-nav={n.key} data-tour-title={label} data-help-title={label} data-nav-key={n.key} aria-current={active ? "page" : undefined} data-help={n.hint}
                      onClick={() => openNav(n.key)}
                      onMouseEnter={() => n.key !== "whatsapp" && preloadTab(n.key)} onFocus={() => n.key !== "whatsapp" && preloadTab(n.key)}
                      className={`nav-item relative w-full flex items-center gap-3 min-h-12 lg:min-h-0 lg:h-10 px-3 py-2 lg:py-0 rounded-[20px] lg:rounded-full text-[14px] lg:text-[13px] font-medium text-left ${active ? "text-white" : "text-ink-600 hover:bg-canvas"}`}>
                      <NavIconFor icon={n.icon} className="w-[18px] h-[18px] shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{label}</span>
                        <span className={`lg:hidden block text-[12px] font-normal leading-snug ${active ? "text-white/80" : "text-ink-500"}`}>{n.hint}</span>
                      </span>
                      {n.key === "livechat" && alerts.count > 0 && <>
                        <span aria-hidden className="ml-auto min-w-[22px] lg:min-w-5 h-[22px] lg:h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold leading-[22px] lg:leading-5 text-center tabular-nums">{badgeText(alerts.count)}</span>
                        <span className="sr-only">, {words.waiting}</span>
                      </>}
                    </button>
                  );
                })}
              </div>}
            </div>
            );
          })}
          </div>
        </nav>

        <div className="p-3 lg:px-4 lg:py-4 border-t border-line space-y-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {canBroadcast && (
            <button type="button" onClick={() => goTo("broadcast")} className={`${btnPrimary} md:hidden w-full justify-center min-h-11 mb-2`}>
              <Send className="w-4 h-4" aria-hidden /> New broadcast
            </button>
          )}
          {me && (
            <div className="flex items-center gap-2.5 px-3 py-1.5">
              <div aria-hidden className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[12px] font-bold shrink-0">
                {(me.name || me.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink-900 truncate leading-tight">{me.name || me.email}</p>
                <p className="text-[12px] text-ink-500 leading-tight">{me.role === "member" ? "Member" : me.role === "lead" ? "Team lead" : "Admin"}</p>
              </div>
            </div>
          )}
          {/* Owner returning from a tenant they're viewing. Tenants never see this. */}
          {impersonating && (
            <button type="button" onClick={exitImpersonation} className="w-full flex items-center gap-3 h-10 px-3 rounded-full text-[13px] font-bold text-brand-700 hover:bg-brand-50 transition-colors" title="Back to the Owner Portal">
              <ShieldCheck className="w-4 h-4" aria-hidden /> Exit to Owner Portal
            </button>
          )}
          {hasSupport && (
            <button type="button" data-alabs-chat onClick={closeNav} className="min-[769px]:hidden w-full flex items-center gap-3 min-h-11 px-3 rounded-full text-[13px] font-medium text-ink-600 hover:bg-canvas transition-colors">
              <LifeBuoy className="w-[18px] h-[18px]" aria-hidden /> Chat with support
            </button>
          )}
          <button type="button" onClick={logout} className="w-full flex items-center gap-3 min-h-11 lg:min-h-0 lg:h-10 px-3 rounded-full text-[13px] font-medium text-ink-600 hover:bg-red-50 hover:text-red-600 transition-colors">
            <LogOut className="w-[18px] h-[18px]" aria-hidden /> Log out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {!account.active && (
          <div className="shrink-0 px-4 sm:px-6 py-2 text-[12px] font-semibold text-center bg-red-50 text-red-700 border-b border-red-200 flex flex-wrap items-center justify-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden /> {brandCopy(account.message, brand)}
            {brand.partnerId
              ? (brand.supportEmail && <a href={`mailto:${brand.supportEmail}`} className="px-2.5 py-1 rounded-control bg-red-600 text-white text-[12px] font-bold hover:bg-red-700">Contact {brand.name}</a>)
              : <a href="/admin/billing" className="px-2.5 py-1 rounded-control bg-red-600 text-white text-[12px] font-bold hover:bg-red-700">Manage billing</a>}
          </div>
        )}
        {banner && (
          <div className={`shrink-0 px-4 sm:px-6 py-2 text-[12px] font-medium text-center ${banner.level === "warning" ? "bg-amber-50 text-amber-800 border-b border-amber-200" : banner.level === "success" ? "bg-emerald-50 text-emerald-800 border-b border-emerald-200" : "bg-brand-50 text-brand-800 border-b border-brand-100"}`}>
            <b>{banner.title}</b>{banner.body ? ` — ${banner.body}` : ""}
          </div>
        )}
        {me?.isPlatformOwner && !impersonating && (
          <div className="min-h-9 py-1 sm:py-1.5 px-4 shrink-0 bg-brand-50 border-b border-brand-100 flex items-center justify-center gap-x-3 text-[12px] text-brand-800 font-semibold text-center">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {/* One line on a phone: the inbox needs the height more than the sentence does. */}
            <span className="sm:hidden">Owner preview</span>
            <span className="hidden sm:inline">Owner preview — this is the platform&apos;s default workspace</span>
            <a href="/admin/owner" className="shrink-0 px-2.5 py-1 rounded-control bg-brand-700 text-white text-[12px] font-bold hover:bg-brand-800"><span className="sm:hidden">Owner Portal</span><span className="hidden sm:inline">Open Owner Portal</span></a>
          </div>
        )}
        {impersonating && (
          <div className="min-h-9 py-1 sm:py-1.5 px-4 shrink-0 bg-amber-50 border-b border-amber-200 flex items-center justify-center gap-x-3 text-[12px] text-amber-800 font-semibold text-center">
            <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="sm:hidden">Viewing a customer&apos;s workspace</span>
            <span className="hidden sm:inline">You&apos;re viewing a tenant&apos;s workspace as the owner</span>
            <button type="button" onClick={exitImpersonation} className="shrink-0 px-2.5 py-1 rounded-control bg-amber-700 text-white text-[12px] font-bold hover:bg-amber-800"><span className="sm:hidden">Exit</span><span className="hidden sm:inline">Exit to Owner Portal</span></button>
          </div>
        )}
        {/* Topbar */}
        <header className="glass-bar h-14 sm:h-16 shrink-0 border-b flex items-center gap-2 px-2 sm:px-6 sticky top-0 z-20">
          <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-expanded={navOpen} aria-controls="portal-nav"
            className="lg:hidden w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full text-ink-700 hover:bg-canvas">
            <Menu className="w-5 h-5" aria-hidden />
          </button>
          <p className="min-w-0 flex-1 truncate text-[13px] text-ink-500">
            <span className="hidden sm:inline">{brand.name} <span className="mx-1">/</span> </span>
            <span className="text-ink-900 font-semibold sm:font-medium text-[15px] sm:text-[13px]">{tabLabel(tab, vocab)}</span>
          </p>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" aria-keyshortcuts="Meta+K Control+K"
              data-help="Jump to any screen, setting or action by typing its name."
              className="h-10 w-10 lg:w-auto lg:pl-3.5 lg:pr-2 lg:min-w-[160px] xl:min-w-[210px] inline-flex items-center justify-center lg:justify-start gap-2 rounded-full border border-line bg-white text-ink-600 lg:text-ink-700 hover:bg-canvas">
              <Search className="w-4 h-4" aria-hidden />
              <span className="hidden lg:inline text-[13px] font-semibold">Search</span>
              <kbd className="hidden lg:inline ml-auto px-2 py-0.5 rounded-full border border-line bg-canvas text-[12px] font-sans text-ink-500">{shortcut}</kbd>
            </button>
            {me && (
              <button type="button" onClick={() => goTo("today")} aria-current={tab === "today" ? "page" : undefined}
                data-help-title="Today" data-help="Everything waiting for a person — who should do it and by when. Overdue first."
                className={`relative inline-flex items-center justify-center gap-1.5 h-10 min-w-10 px-2.5 sm:px-3 rounded-full border text-[13px] font-semibold ${tab === "today" ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-white text-ink-700 hover:bg-canvas"}`}>
                <ListTodo className="w-4 h-4" aria-hidden /> <span className="sr-only sm:not-sr-only">Today</span>
                {today.overdue > 0 && <>
                  <span aria-hidden className="absolute -top-1 -right-1 sm:static min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold leading-5 text-center tabular-nums">{badgeText(today.overdue)}</span>
                  <span className="sr-only">, {words.overdue}</span>
                </>}
              </button>
            )}
            <AlertsBell alerts={alerts} onOpen={chat => goTo("livechat", { openPhone: chat.phone })} onOpenReview={openReviewAlert} onOpenAll={() => goTo("livechat", { filter: "waiting" })} />
            {me && <TourButton onStart={startTour} blocked={tourBlocked} className="hidden xl:inline-flex" />}
            {canBroadcast && (
              <button type="button" data-help="Choose an approved template and audience, review the message, then send or schedule your broadcast." onClick={() => goTo("broadcast")} className={`${btnPrimary} hidden md:flex h-10`}>
                <Send className="w-4 h-4" aria-hidden /> New broadcast
              </button>
            )}
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 p-4 sm:p-6 pb-24 md:pb-6 overflow-x-hidden focus:outline-none">
          {roleBlocked ? <AdminOnlyTab title={tabLabel(tab, vocab)} goTo={goTo} /> : <TabErrorBoundary key={tab === "settings" ? `settings:${settingsNonce}` : tab} title={tabLabel(tab, vocab)} onHome={() => setTab("home")}>
          {tab === "home" && <HomeTab goTo={goTo} me={me} waiting={{ count: alerts.count, chats: alerts.chats, loaded: alerts.loaded }} today={today} canOpenTab={canOpenTab} />}
          {tab === "today" && <TodayTab goTo={goTo} />}
          {tab === "bookings" && <BookingsTab goTo={goTo} />}
          {tab === "livechat" && <LiveChatTab goTo={goTo} intent={chatIntent} clearIntent={clearChatIntent} />}
          {tab === "broadcast" && <BroadcastTab goTo={goTo} />}
          {tab === "ads" && <AdsTab goTo={goTo} />}
          {tab === "instagram" && <InstagramTab goTo={goTo} />}
          {tab === "facebook" && <FacebookTab goTo={goTo} />}
          {tab === "youtube" && <YoutubeTab goTo={goTo} />}
          {tab === "webchat" && <WebchatTab />}
          {tab === "reviews" && <ReviewsTab isAdmin={me?.role === "admin"} />}
          {tab === "assistant" && <AssistantTab goTo={goTo} />}
          {tab === "flows" && <FlowsTab />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "catalog" && <CatalogTab />}
          {tab === "growth" && <GrowthTab />}
          {tab === "handlehub" && <HandleHubTab />}
          {tab === "aihub" && <AiHubTab goTo={goTo} />}
          {tab === "templates" && <TemplatesTab />}
          {tab === "forms" && <FormsTab goTo={goTo} />}
          {(tab === "analytics" || tab === "results") && me?.role === "admin" && <InsightsSwitch tab={tab} goTo={goTo} />}
          {tab === "analytics" && <AnalyticsTab isAdmin={me?.role === "admin"} goTo={goTo} />}
          {tab === "results" && <ResultsTab goTo={goTo} />}
          {tab === "contacts" && <ContactsTab goTo={goTo} />}
          {tab === "pipeline" && <PipelineTab goTo={goTo} />}
          {tab === "campaigns" && <CampaignsTab goTo={goTo} />}
          {tab === "optouts" && <OptoutsTab />}
          {tab === "setup" && <SetupTab goTo={goTo} />}
          {tab === "integrations" && <IntegrationsTab goTo={goTo} />}
          {tab === "settings" && <SettingsTab goTo={goTo} />}
          {tab === "security" && <SecurityTab />}
          {tab === "team" && <TeamProgressTab me={me ? { role: me.role as "admin" | "lead" | "member", team: (me.team ?? null) as import("@/lib/team-vocab").Team | null } : null} goTo={goTo} />}
          </TabErrorBoundary>}
        </main>
      </div>
      <MobileTabBar tab={tab} onGo={goTo} onMore={() => setNavOpen(true)} moreOpen={navOpen}
        waiting={alerts.count} overdue={today.overdue} contactsLabel={tabLabel("contacts", vocab)} show={canOpenTab} />
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} entries={palette} onPick={pick} />
      {!me?.isPlatformOwner && !account.active && (
        <PaywallModal open={!paywallDismissed} state={account.state} message={account.message} onClose={() => setPaywallDismissed(true)} />
      )}
    </div>
    <Toaster />
    </ConfirmProvider>
  );
}

// Shown when a member opens an admin-only tab by URL. A read-only explanation
// with a way out — never a blank screen and never a silent redirect.
function AdminOnlyTab({ title, goTo }: { title: string; goTo: GoTo }) {
  return (
    <div className="max-w-md mx-auto mt-16 text-center space-y-3">
      <div className="w-11 h-11 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center mx-auto"><ShieldCheck className="w-5 h-5" aria-hidden /></div>
      <h2 className="text-lg font-extrabold text-ink-900">{title} is admin-only</h2>
      <p className="text-sm text-ink-500">Your account is a <b>Member</b>, so this section is hidden. Ask a workspace admin to set it up for you — or to change your role in Settings &rarr; Team.</p>
      <button type="button" onClick={() => goTo("home")} className={`${btnPrimary} mx-auto`}>Back to Home</button>
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
//
// A real dialog (overlay.tsx's Modal): role="dialog", aria-modal, focus kept
// inside, Escape and the backdrop close it, focus returns afterwards.
const PAYWALL_COPY: Record<AccountState, { title: string }> = {
  ok: { title: "" },   // never rendered — accountState() only reaches here when inactive
  trial_expired: { title: "Your free trial has ended" },
  past_due: { title: "Your last payment failed" },
  suspended: { title: "Your workspace is paused" },
};
function PaywallModal({ open, state, message, onClose }: { open: boolean; state: AccountState; message: string; onClose: () => void }) {
  const brand = useBrand();
  return (
    <Modal open={open} onClose={onClose} size="sm" title={PAYWALL_COPY[state].title}
      footer={<>
        <button type="button" onClick={onClose} className="min-h-10 px-3 rounded-control text-[13px] font-semibold text-ink-600 hover:bg-canvas">Maybe later</button>
        <span className="flex-1" />
        {brand.partnerId
          ? (brand.supportEmail && <a href={`mailto:${brand.supportEmail}`} className="min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-bold inline-flex items-center gap-1.5">Contact {brand.name}</a>)
          : <a href="/admin/billing" className="min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-bold inline-flex items-center gap-1.5"><CreditCard className="h-4 w-4" aria-hidden /> See plans</a>}
      </>}>
      <div className="flex items-start gap-3">
        <div aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
          <CreditCard className="h-5 w-5" />
        </div>
        <p className="text-sm text-ink-600 leading-relaxed">{brandCopy(message, brand)} Your data is safe and nothing is deleted — pick a plan to pick up right where you left off.</p>
      </div>
    </Modal>
  );
}

// Analytics has two views: activity (messages, chats, team) and Results
// (revenue by source — admins only). One menu entry, a switch on the page.
function InsightsSwitch({ tab, goTo }: { tab: Tab; goTo: GoTo }) {
  return (
    <div role="tablist" aria-label="Analytics view" className="mb-4 inline-flex rounded-full border border-line bg-white p-0.5">
      {([["analytics", "Activity"], ["results", "Results"]] as const).map(([k, label]) => (
        <button type="button" key={k} role="tab" aria-selected={tab === k} onClick={() => goTo(k)}
          className={`min-h-9 rounded-full px-4 text-[13px] font-bold ${tab === k ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-canvas"}`}>{label}</button>
      ))}
    </div>
  );
}
