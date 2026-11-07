"use client";

// Integrations hub tab — extracted from admin/page.tsx, lazy-loaded.
import { useBrand } from "@/components/BrandContext";
import { ConnectionHealth } from "./ConnectionHealth";
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { Copy, Loader2, Trash2, Check, X } from "lucide-react";
import { type Tab, inp, ImgFallback } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { Drawer } from "@/components/overlay";
import InboundIntegrations, { type ExtraTool, type AccountLink } from "@/components/inbound-integrations";
import { useVocab } from "@/lib/vocab-client";

// ── Integrations hub: per-tenant outbound webhooks (Zapier/Make/Slack/Teams) ──
type Integration = {
  id: string; kind: string; name: string; active: boolean;
  config: { url?: string; format?: string; mezmitraTenant?: string; defaultOutletId?: string | null; sheetTitle?: string; leadsTab?: string; calendarName?: string; calendarId?: string }; events: string[];
  status: "connected" | "error" | "unverified"; statusDetail: string | null;
  hasSecret: boolean; hasWebhookSecret: boolean; lastEventAt: string | null; createdAt: string;
};
const INTEGRATION_EVENTS: { key: string; label: string }[] = [
  { key: "contact.created", label: "New contact / lead" },
  { key: "message.inbound", label: "New message received" },
  { key: "conversation.escalated", label: "Chat handed to a human" },
  { key: "order.created", label: "Order placed" },
  { key: "contact.optout", label: "Contact opted out" },
  { key: "order.paid", label: "Order paid" },
  { key: "order.refunded", label: "Order refunded" },
];
const FORMAT_LABELS: Record<string, string> = { generic: "Standard (Zapier / Make / n8n)", slack: "Slack message", teams: "Microsoft Teams message" };
const KIND_LABELS: Record<string, string> = { webhook: "Zapier, Make or n8n", slack: "Slack", teams: "Microsoft Teams", hubspot: "HubSpot", pipedrive: "Pipedrive", freshsales: "Freshsales", leadsquared: "LeadSquared", razorpay: "Razorpay", stripe: "Stripe", shopify: "Shopify", woocommerce: "WooCommerce", calcom: "Cal.com", mezmitra: "Mezvaan (restaurant)", google_sheets: "Google Sheets", google_calendar: "Google Calendar" };
const CRM_KINDS = ["hubspot", "pipedrive", "freshsales", "leadsquared"];
const PAYMENT_KINDS = ["razorpay", "stripe"];
const STORE_KINDS = ["shopify", "woocommerce"];
const SCHEDULE_KINDS = ["calcom", "google_calendar"];
// Connected by sharing with the portal's Google account: no key to paste.
const GOOGLE_KINDS = ["google_sheets", "google_calendar"];
const RESTAURANT_KINDS = ["mezmitra"];
// What Mezvaan sends: each can start an API rule (Broadcast → API rules) that
// sends an approved template, with {{payload.<field>}} filling its variables.
const MEZMITRA_EVENTS: { key: string; when: string; fields: string }[] = [
  { key: "mezmitra.bill.paid", when: "A bill is paid (guest saved with consent)", fields: "outlet_name, invoice_no, total, visit_count, points_balance, review_url, marketing_opt_in" },
  { key: "mezmitra.reservation.created", when: "A table is booked by phone, by staff or on WhatsApp (Instagram and website-chat bookings are confirmed in that chat, never by WhatsApp to a typed number)", fields: "outlet_name, booking_ref, date, time, party_size, source" },
  { key: "mezmitra.reservation.reminder", when: "Before the booking (outlet's reminder time)", fields: "outlet_name, booking_ref, date, time, party_size" },
  { key: "mezmitra.reservation.cancelled", when: "A booking is cancelled", fields: "outlet_name, booking_ref, date, time" },
  { key: "mezmitra.order.ready", when: "A takeaway order is ready", fields: "outlet_name, order_no, track_url" },
];
const EVENT_KINDS = ["webhook", "slack", "teams", "hubspot", "pipedrive", "freshsales", "google_sheets"];
const TOKEN_HELP: Record<string, string> = {
  hubspot: "HubSpot → Settings → Integrations → Private Apps → create one with crm.objects.contacts read+write, then paste its token.",
  pipedrive: "Pipedrive → Settings → Personal preferences → API → copy your personal API token.",
  freshsales: "Freshsales → your profile picture → Settings → API Settings: copy the Bundle alias and Your API key. Contacts are matched on mobile number, so make Mobile a unique field (Admin settings → Contact fields) to avoid duplicates.",
  razorpay: "Razorpay → Settings → API Keys → generate keys, then paste the Key ID and Key Secret.",
  stripe: "Stripe → Developers → API keys → copy your Secret key (sk_live_… or sk_test_…).",
  shopify: "Shopify → Settings → Apps → Develop apps → create a custom app with read_products, then paste its Admin API access token.",
  woocommerce: "WooCommerce → Settings → Advanced → REST API → add a key with Read access, then paste the Consumer key and secret.",
  calcom: "Cal.com → Settings → Developer → API Keys for the key; the Event Type ID is in the event type's URL (…/event-types/123).",
  mezmitra: "In Mezvaan: Settings → Talko AI → Connect, then copy the link key. It works once, within a day. Both products link in this one step.",
  leadsquared: "LeadSquared → My Profile → Settings → API and Webhooks for the Access Key & Secret Key; the Activity code is the event code of a Custom Activity (e.g. \"WhatsApp Message\").",
};

// The catalog of connectable tools, shown as clickable logo cards. `logo` is the
// company's own mark, self-hosted under public/integrations (sources:
// integration-logos.test.ts) — the Iconify `logos:` URLs this used to load
// stopped resolving, and every card fell back to its letter. null → a lettered
// tile (none today: Mezvaan's is its app icon, copied from its own repo).
const CATALOG: { kind: string; logo: string | null; blurb: string }[] = [
  { kind: "hubspot", logo: "/integrations/hubspot.svg", blurb: "Sync new contacts into HubSpot CRM." },
  { kind: "pipedrive", logo: "/integrations/pipedrive.png", blurb: "Sync new people into Pipedrive CRM." },
  { kind: "freshsales", logo: "/integrations/freshsales.png", blurb: "Sync new contacts into Freshsales CRM." },
  { kind: "leadsquared", logo: "/integrations/leadsquared.png", blurb: "Sync every chat to the lead's LeadSquared timeline." },
  { kind: "razorpay", logo: "/integrations/razorpay.svg", blurb: "Send Razorpay payment links inside the chat." },
  { kind: "stripe", logo: "/integrations/stripe.png", blurb: "Send Stripe payment links inside the chat." },
  { kind: "shopify", logo: "/integrations/shopify.svg", blurb: "Import your Shopify product catalog." },
  { kind: "woocommerce", logo: "/integrations/woocommerce.png", blurb: "Import your WooCommerce catalog." },
  { kind: "calcom", logo: "/integrations/calcom.png", blurb: "Let customers book meetings via Cal.com." },
  { kind: "google_sheets", logo: "/integrations/google_sheets.svg", blurb: "Add a row to a Google Sheet for each event you pick." },
  { kind: "google_calendar", logo: "/integrations/google_calendar.svg", blurb: "Let customers book a time on your Google Calendar from a chat." },
  { kind: "mezmitra", logo: "/integrations/mezmitra.svg", blurb: "Restaurants: live menu and table booking in every chat, WhatsApp after bills, bookings and orders." },
  { kind: "slack", logo: "/integrations/slack.svg", blurb: "Post events to a Slack channel." },
  { kind: "teams", logo: "/integrations/teams.svg", blurb: "Post events to a Microsoft Teams channel." },
  { kind: "webhook", logo: "/integrations/webhook.svg", blurb: "Tell Zapier, Make, n8n or your own system when something happens — a new lead, an order, a hand-off." },
];

// A connector's brand mark — its catalog logo URL, falling back to a lettered tile
// when there's no logo or the image fails to load.
function Logo({ kind, logo }: { kind: string; logo: string | null }) {
  const initial = (KIND_LABELS[kind] ?? kind).replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "?";
  const box = "w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center font-extrabold text-sm shrink-0";
  if (!logo) return <div className={box}>{initial}</div>;
  return <ImgFallback url={logo} imgClass="w-10 h-10 rounded-xl bg-white border border-line object-contain p-1.5 shrink-0" boxClass={box} icon={initial} />;
}

function IntegrationsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const brand = useBrand();
  const who = brand.partnerId ? brand.name : "Talko";   // the name in-app copy uses
  const ask = useConfirm();
  const { vocab } = useVocab();
  const contactLc = vocab.contact.one.toLowerCase();
  const contactsLc = vocab.contact.many.toLowerCase();
  const leadLc = vocab.lead.one.toLowerCase();
  // Event names that mention the workspace's own nouns follow its vocabulary.
  const integrationEvents = INTEGRATION_EVENTS.map(e =>
    e.key === "contact.created" ? { ...e, label: `New ${contactLc} / ${leadLc}` }
    : e.key === "contact.optout" ? { ...e, label: `${vocab.contact.one} opted out` }
    : e);
  const [items, setItems] = useState<Integration[] | null>(null);
  // LeadSquared can be connected outside this list (older workspace settings,
  // or the server's environment). The server says whether the sync runs.
  const [lsq, setLsq] = useState<{ connected: boolean; via: "hub" | "settings" | "server" | null }>({ connected: false, via: null });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: "webhook", name: "", url: "", format: "generic", token: "", keyId: "", shopDomain: "", storeUrl: "", consumerKey: "", eventTypeId: "", fsDomain: "", lsqAccessKey: "", lsqHost: "", lsqActivityCode: "", lsqTaskCategory: "", lsqIgHandleField: "", lsqAutoCreate: false, spreadsheetUrl: "", leadsTab: "", calendarId: "", slotMinutes: "", workStart: "", workEnd: "", workDays: "", noticeHours: "", daysAhead: "", eventTitle: "", events: ["contact.created", "conversation.escalated"] as string[] });
  const isCrm = CRM_KINDS.includes(form.kind);
  const isPayment = PAYMENT_KINDS.includes(form.kind);
  const isStore = STORE_KINDS.includes(form.kind);
  const isSchedule = SCHEDULE_KINDS.includes(form.kind);
  const isRestaurant = RESTAURANT_KINDS.includes(form.kind);
  const isEventKind = EVENT_KINDS.includes(form.kind);
  const isGoogle = GOOGLE_KINDS.includes(form.kind);
  const isToken = (isCrm || isPayment || isStore || isSchedule || isRestaurant) && !isGoogle;
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/integrations").then(r => r.json()).then(d => { setItems(d.integrations ?? []); setGoogleEmail(d.googleShareEmail ?? null); if (d.leadsquared) setLsq(d.leadsquared); }).catch(() => setItems([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  function toggleEvent(key: string) {
    setForm(f => ({ ...f, events: f.events.includes(key) ? f.events.filter(e => e !== key) : [...f.events, key] }));
  }

  async function create() {
    setBusy(true); setMsg(null); setNewSecret(null);
    try {
      const d = await fetch("/api/admin/integrations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }).then(r => r.json());
      if (d.error) setMsg({ ok: false, text: d.error });
      else {
        setNewSecret(d.secret ?? null);
        setMsg({ ok: true, text: d.detail || "Added. Hit Test to confirm it's connected." });
        setForm({ kind: "webhook", name: "", url: "", format: "generic", token: "", keyId: "", shopDomain: "", storeUrl: "", consumerKey: "", eventTypeId: "", fsDomain: "", lsqAccessKey: "", lsqHost: "", lsqActivityCode: "", lsqTaskCategory: "", lsqIgHandleField: "", lsqAutoCreate: false, spreadsheetUrl: "", leadsTab: "", calendarId: "", slotMinutes: "", workStart: "", workEnd: "", workDays: "", noticeHours: "", daysAhead: "", eventTitle: "", events: ["contact.created", "conversation.escalated"] });
        setAdding(false);
        load();
      }
    } catch { setMsg({ ok: false, text: "Connection error." }); }
    finally { setBusy(false); }
  }

  async function test(id: string) {
    setTesting(id); setMsg(null);
    try {
      const d = await fetch(`/api/admin/integrations/${id}/verify`, { method: "POST" }).then(r => r.json());
      setMsg({ ok: !!d.verify?.ok, text: d.verify?.detail || d.error || "Test failed." });
      load();
    } catch { setMsg({ ok: false, text: "Connection error." }); }
    finally { setTesting(null); }
  }

  async function sync(id: string) {
    setSyncing(id); setMsg(null);
    try {
      const d = await fetch(`/api/admin/integrations/${id}/sync`, { method: "POST" }).then(r => r.json());
      setMsg({ ok: !!d.success, text: d.message || d.error || "Import failed." });
    } catch { setMsg({ ok: false, text: "Connection error." }); }
    finally { setSyncing(null); }
  }

  async function toggleActive(i: Integration) {
    const r = await fetch(`/api/admin/integrations/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !i.active }) }).catch(() => null);
    if (!r?.ok) { toast({ text: "Couldn't change it. Please try again.", tone: "error" }); load(); return; }
    // Pausing is undone by resuming — the same switch, the other way.
    toast(i.active
      ? { text: `${i.name} paused`, action: { label: "Undo", onClick: () => void toggleActive({ ...i, active: false }) } }
      : `${i.name} resumed`);
    load();
  }

  async function remove(i: Integration) {
    if (!(await ask({
      title: "Delete this integration?", tone: "danger", confirmLabel: "Delete integration",
      message: "Events stop being sent to it immediately. Anything on the far side that depends on them goes quiet.",
      facts: [{ label: "Integration", value: i.name }],
    }))) return;
    const r = await fetch(`/api/admin/integrations/${i.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast(`${i.name} removed`); else toast({ text: "Couldn't remove it. Please try again.", tone: "error" });
    load();
  }

  // Clicking a catalog card opens the setup form for THAT connector (kind fixed).
  function openSetup(kind: string) {
    setForm({ kind, name: "", url: "", format: "generic", token: "", keyId: "", shopDomain: "", storeUrl: "", consumerKey: "", eventTypeId: "", fsDomain: "", lsqAccessKey: "", lsqHost: "", lsqActivityCode: "", lsqTaskCategory: "", lsqIgHandleField: "", lsqAutoCreate: false, spreadsheetUrl: "", leadsTab: "", calendarId: "", slotMinutes: "", workStart: "", workEnd: "", workDays: "", noticeHours: "", daysAhead: "", eventTitle: "", events: ["contact.created", "conversation.escalated"] });
    setMsg(null); setNewSecret(null); setAdding(true);
  }

  // Why "Add integration" is off, in words — the first thing still missing.
  const addMissing: string | null =
    isEventKind && !isRestaurant && !form.events.length ? "Pick at least one event to send."
    : isRestaurant ? (!form.token.trim() ? "Paste your Mezvaan key first." : null)
    : form.kind === "google_sheets" ? (!googleEmail ? "Google access isn't set up for this portal yet." : !form.spreadsheetUrl.trim() ? "Paste your sheet's link first." : null)
    : form.kind === "google_calendar" ? (!googleEmail ? "Google access isn't set up for this portal yet." : !form.calendarId.trim() ? "Enter your calendar's id first." : null)
    : isSchedule ? (!form.token.trim() ? "Paste your API key first." : !form.eventTypeId.trim() ? "Enter the event type first." : null)
    : isStore ? (!form.token.trim() ? "Paste your access token first." : form.kind === "shopify" ? (!form.shopDomain.trim() ? "Enter your shop domain first." : null) : (!form.storeUrl.trim() ? "Enter your store address first." : !form.consumerKey.trim() ? "Paste your consumer key first." : null))
    : form.kind === "leadsquared" ? (!form.token.trim() || !form.lsqAccessKey.trim() ? "Paste your LeadSquared keys first." : !form.lsqHost.trim() ? "Enter your LeadSquared API host first." : !form.lsqActivityCode.trim() ? "Enter the activity code first." : null)
    : form.kind === "freshsales" ? (!form.token.trim() ? "Paste your API key first." : !form.fsDomain.trim() ? "Enter your Freshsales domain first." : null)
    : isCrm || isPayment ? (form.kind === "razorpay" && !form.keyId.trim() ? "Enter your Razorpay Key ID first." : !form.token.trim() ? "Paste your secret key first." : null)
    : !form.url.trim() ? "Paste the link first." : null;

  const statusBadge = (s: Integration["status"]) => {
    const map = { connected: "bg-emerald-100 text-emerald-700", error: "bg-red-100 text-red-600", unverified: "bg-slate-100 text-slate-500" };
    const label = { connected: "Connected", error: "Error", unverified: "Not tested" };
    return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${map[s]}`}>{label[s]}</span>;
  };

  // What the single catalog needs from this tab: the tools only the portal-side
  // connection covers, and the account connection for tools the catalog already has.
  const countOf = (kind: string) => (items ?? []).filter(i => i.kind === kind).length;
  const extraTools: ExtraTool[] = [
    { kind: "hubspot", group: "crm" }, { kind: "pipedrive", group: "crm" }, { kind: "freshsales", group: "crm" }, { kind: "leadsquared", group: "crm" },
    { kind: "stripe", group: "payments" },
    { kind: "slack", group: "more" }, { kind: "teams", group: "more" }, { kind: "webhook", group: "more" }, { kind: "mezmitra", group: "more" },
  ].map(x => {
    const c = CATALOG.find(k => k.kind === x.kind)!;
    return { kind: x.kind, name: KIND_LABELS[x.kind], logo: c.logo, color: "#334155", blurb: c.blurb, group: x.group as ExtraTool["group"], connected: x.kind === "leadsquared" ? Math.max(countOf(x.kind), lsq.connected ? 1 : 0) : countOf(x.kind) };
  });
  const accountLinks: Record<string, AccountLink> = {
    shopify: { kind: "shopify", title: "Import your product catalog", blurb: `Bring your Shopify products into ${who} so the AI and checkout can use them.`, connected: countOf("shopify") },
    woocommerce: { kind: "woocommerce", title: "Import your product catalog", blurb: `Bring your WooCommerce products into ${who} so the AI and checkout can use them.`, connected: countOf("woocommerce") },
    razorpay: { kind: "razorpay", title: "Send payment links in chat", blurb: `Connect your Razorpay keys so ${who} can send payment links inside the chat and confirm paid orders.`, connected: countOf("razorpay") },
    calcom: { kind: "calcom", title: "Let customers book meetings", blurb: "Connect Cal.com so a chatbot flow's “Book meeting” step can book real slots.", connected: countOf("calcom") },
    google_sheets: { kind: "google_sheets", title: "Log events to a sheet", blurb: "Add a row to a tab of your sheet for each event you pick: new leads, hand-offs, opt-outs, orders.", connected: countOf("google_sheets") },
    google_calendar: { kind: "google_calendar", title: "Connect your calendar for booking", blurb: "Share your Google Calendar with the portal so a chatbot flow's “Book meeting” step offers your free times and books the one the customer picks.", connected: countOf("google_calendar") },
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Integrations</h2><PageInfo className="text-sm text-slate-500" lead={<>Connect the tools you already use — no code required.</>}><p>Connect the tools you already use — no code required. Each tool appears once below. Most turn what happens in your store, payments, bookings and lead sources into WhatsApp messages; some also let {who} act in your account (import a catalog, send payment links, sync {vocab.lead.many.toLowerCase()} to a CRM, post alerts to Slack, Teams or Zapier).</p><p>Pick a tool below. Most tell {who} when something happens (an order, a payment, a booking, a new lead) and Talko sends the matching WhatsApp message. Cards marked “+” also let {who} act in your account, and the CRM, alert and webhook cards work from Talko outwards.</p></PageInfo>
      </div>

      <ConnectionHealth goTo={goTo} />

      {msg && !adding && <p className={`text-[13px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? <Check className="inline w-3.5 h-3.5 mr-1 align-[-2px]" /> : <X className="inline w-3.5 h-3.5 mr-1 align-[-2px]" />}{msg.text}</p>}

      {newSecret && (
        <div className="bg-amber-50 border border-amber-200 rounded-card p-4 space-y-1.5">
          <p className="text-xs font-bold text-amber-800">Secret code — copy it now, it won’t be shown again.</p>
          <p className="text-[12px] text-amber-800">Give it to whoever set up the receiving side, so they can check messages really come from {who}. Slack and Teams don’t need it.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 break-all">{newSecret}</code>
            <button onClick={() => { navigator.clipboard?.writeText(newSecret); toast("Secret copied"); }} aria-label="Copy secret" className="grid place-items-center w-9 h-9 rounded-control border border-amber-300 text-amber-800 hover:bg-amber-100 shrink-0"><Copy className="w-3.5 h-3.5" /></button>
          </div>
          <details className="text-[11px] text-amber-800">
            <summary className="cursor-pointer font-semibold">For developers</summary>
            <p className="mt-1">Each request carries an <span className="font-mono">X-Alabs-Signature</span> header: the HMAC-SHA256 of the raw body, keyed with this secret.</p>
          </details>
        </div>
      )}

      {/* Connected integrations — manage, test, pause or remove */}
      {items === null && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}
      {!!items?.length && <div className="space-y-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">Connected ({items.length})</p>
        {items.map(i => (
          <section key={i.id} className="bg-white rounded-card border border-line p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-ink-900 truncate">{i.name}</h3>
                  {statusBadge(i.status)}
                  {!i.active && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Paused</span>}
                </div>
                <p className="text-[11px] text-slate-500 truncate">{RESTAURANT_KINDS.includes(i.kind) ? `Mezvaan · ${String(i.config.mezmitraTenant ?? "restaurant")} · live menu + table booking` : SCHEDULE_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]}${i.config.calendarName ? ` · ${i.config.calendarName}` : ""} · books meetings` : i.kind === "google_sheets" ? `Google Sheets${i.config.sheetTitle ? ` · ${i.config.sheetTitle}` : ""} · “${i.config.leadsTab || "Portal log"}” tab` : STORE_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · imports products` : PAYMENT_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · payment links` : i.kind === "leadsquared" ? `LeadSquared · syncs every chat to the lead timeline` : CRM_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · syncs contacts` : `${FORMAT_LABELS[i.config.format ?? "generic"]} · ${i.config.url}`}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {STORE_KINDS.includes(i.kind) && <button onClick={() => sync(i.id)} disabled={syncing === i.id} className="min-h-9 px-2.5 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{syncing === i.id ? "Importing…" : "Sync now"}</button>}
                <button onClick={() => test(i.id)} disabled={testing === i.id} className="min-h-9 px-2.5 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas disabled:opacity-60">{testing === i.id ? "Testing…" : "Test"}</button>
                <button onClick={() => toggleActive(i)} className="min-h-9 px-2.5 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">{i.active ? "Pause" : "Resume"}</button>
                <button onClick={() => remove(i)} aria-label={`Remove ${i.name}`} title="Remove" className="grid place-items-center w-9 h-9 text-red-500 hover:text-red-600 hover:bg-red-50 rounded-control"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {RESTAURANT_KINDS.includes(i.kind)
                ? <>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">The AI answers menu and table questions live</span>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">“Book table” flow step</span>
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Opt-outs sent back to Mezvaan</span>
                  </>
                : SCHEDULE_KINDS.includes(i.kind)
                ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Books meetings from a flow’s “Book meeting” node</span>
                : STORE_KINDS.includes(i.kind)
                ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Imports your product catalog</span>
                : PAYMENT_KINDS.includes(i.kind)
                ? <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Sends a payment link on checkout</span>
                : i.events.map(e => <span key={e} className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">{integrationEvents.find(x => x.key === e)?.label ?? e}</span>)}
            </div>
            {i.status === "error" && i.statusDetail && <p className="text-[11px] text-red-600">{i.statusDetail}</p>}
            {i.lastEventAt && <p className="text-[11px] text-slate-500">Last sent {new Date(i.lastEventAt).toLocaleString()}</p>}
            {PAYMENT_KINDS.includes(i.kind) && <PaymentWebhookCard integration={i} onSaved={load} />}
            {RESTAURANT_KINDS.includes(i.kind) && <MezmitraCard integration={i} onSaved={load} goTo={goTo} />}
          </section>
        ))}
      </div>}

      {/* Connected, but not through this list: say so, rather than showing a
          working CRM as "not connected". */}
      {lsq.connected && lsq.via !== "hub" && !items?.some(i => i.kind === "leadsquared") && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-control px-3 py-2.5 flex items-start gap-1.5">
          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span><b>LeadSquared is connected</b> {lsq.via === "server" ? "with keys set on the server" : "through your earlier LeadSquared settings"}, and chats are syncing. Connect it here as well if you want to manage the keys from this page.</span>
        </p>
      )}

      {/* LSQ → portal inbound webhook: only meaningful once LSQ is connected */}
      {(lsq.connected || !!items?.some(i => i.kind === "leadsquared")) && <LsqInboundCard />}

      {/* ONE catalog: the incoming-events tools, plus the tools that only act from the
          portal side. Shopify, WooCommerce, Razorpay and Cal.com are one card each —
          their account connection (catalog import, payment links, meetings) opens
          from that card's panel. */}
      <InboundIntegrations extras={extraTools} accountLinks={accountLinks} onOpenAccount={openSetup} />

      <Drawer open={adding} onClose={() => { setAdding(false); setMsg(null); setNewSecret(null); }} width="md"
        title={<span className="flex items-center gap-3"><Logo kind={form.kind} logo={CATALOG.find(c => c.kind === form.kind)?.logo ?? null} />Set up {KIND_LABELS[form.kind]}</span>}
        subtitle={CATALOG.find(c => c.kind === form.kind)?.blurb}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={create} disabled={busy || !!addMissing} title={addMissing ?? undefined} aria-describedby={addMissing ? "integration-missing" : undefined} className="min-h-10 px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Add integration"}</button>
            <button onClick={() => { setAdding(false); setMsg(null); }} className="min-h-10 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">Cancel</button>
            {addMissing && !busy && <span id="integration-missing" className="text-[12px] text-slate-500">{addMissing}</span>}
          </div>
        }>
        <div className="space-y-3">
          <input className={`${inp} w-full`} placeholder={isToken ? `Name (e.g. ${KIND_LABELS[form.kind]})` : "Name (e.g. Slack #leads, Zapier orders)"} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          {isGoogle ? (
            <GoogleSetup kind={form.kind as "google_sheets" | "google_calendar"} email={googleEmail} form={form} set={patch => setForm(f => ({ ...f, ...patch }))} />
          ) : isToken ? (
            <div className="space-y-2">
              {form.kind === "razorpay" && <input className={`${inp} w-full`} placeholder="Razorpay Key ID (rzp_…)" value={form.keyId} onChange={e => setForm({ ...form, keyId: e.target.value })} />}
              {form.kind === "shopify" && <input className={`${inp} w-full`} placeholder="Shop domain (my-store.myshopify.com)" value={form.shopDomain} onChange={e => setForm({ ...form, shopDomain: e.target.value })} />}
              {form.kind === "woocommerce" && <>
                <input className={`${inp} w-full`} placeholder="Store URL (https://shop.example.com)" value={form.storeUrl} onChange={e => setForm({ ...form, storeUrl: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Consumer key (ck_…)" value={form.consumerKey} onChange={e => setForm({ ...form, consumerKey: e.target.value })} />
              </>}
              {form.kind === "calcom" && <input className={`${inp} w-full`} placeholder="Event Type ID (e.g. 123)" value={form.eventTypeId} onChange={e => setForm({ ...form, eventTypeId: e.target.value })} />}
              {form.kind === "freshsales" && <input className={`${inp} w-full`} placeholder="Bundle alias (yourcompany.myfreshworks.com)" value={form.fsDomain} onChange={e => setForm({ ...form, fsDomain: e.target.value })} />}
              {form.kind === "leadsquared" && <>
                <input className={`${inp} w-full`} placeholder="Access Key" value={form.lsqAccessKey} onChange={e => setForm({ ...form, lsqAccessKey: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="API host (e.g. https://api-in21.leadsquared.com)" value={form.lsqHost} onChange={e => setForm({ ...form, lsqHost: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Activity code (e.g. 100)" value={form.lsqActivityCode} onChange={e => setForm({ ...form, lsqActivityCode: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Task category (optional, default 2)" value={form.lsqTaskCategory} onChange={e => setForm({ ...form, lsqTaskCategory: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="IG handle field (optional, e.g. mx_Instagram)" value={form.lsqIgHandleField} onChange={e => setForm({ ...form, lsqIgHandleField: e.target.value })} />
              </>}
              <input className={`${inp} w-full`} type="password" placeholder={form.kind === "razorpay" ? "Razorpay Key Secret" : form.kind === "stripe" ? "Stripe secret key (sk_…)" : form.kind === "shopify" ? "Admin API access token" : form.kind === "woocommerce" ? "Consumer secret (cs_…)" : form.kind === "calcom" ? "Cal.com API key" : form.kind === "freshsales" ? "Freshsales API key" : form.kind === "mezmitra" ? "Mezvaan link key (mzk_…)" : form.kind === "leadsquared" ? "Secret Key" : `${KIND_LABELS[form.kind]} API token`} value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} />
              <p className="text-[11px] text-slate-500">{TOKEN_HELP[form.kind]}</p>
              {isPayment && <p className="text-[11px] text-slate-500">A payment link is sent automatically when a customer checks out an order.</p>}
              {isStore && <p className="text-[11px] text-slate-500">After connecting, hit “Sync now” to import your products into the catalog. One-way; re-sync anytime.</p>}
              {isSchedule && <p className="text-[11px] text-slate-500">Add a “Book meeting” node to a chatbot flow — it shows live Cal.com slots and books the chosen time.</p>}
              {isRestaurant && <p className="text-[11px] text-slate-500">Once linked, the AI reads the live menu and books tables in Mezvaan, and your catalog here is switched off for chats so there is only one menu. Mezvaan’s bill, booking and order events can start API rules.</p>}
              {form.kind === "leadsquared" && <>
                <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
                  <input type="checkbox" className="accent-brand-700" checked={form.lsqAutoCreate} onChange={e => setForm({ ...form, lsqAutoCreate: e.target.checked })} />
                  Auto-create {vocab.lead.many.toLowerCase()} for new inbound {contactsLc} (off = only sync to existing ones)
                </label>
                <p className="text-[11px] text-slate-500">Every chat syncs to the lead’s timeline; stage &amp; owner show in Live Chat. Pipeline stages and CRM drips also use this connection.</p>
              </>}
            </div>
          ) : (
            <>
              <input className={`${inp} w-full`} placeholder={form.kind === "slack" ? "Slack incoming webhook URL (hooks.slack.com/…)" : form.kind === "teams" ? "Teams incoming webhook URL" : "https://hooks.zapier.com/… (Zapier / Make / n8n)"} value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
              <p className="text-[11px] text-slate-500">
                {form.kind === "slack" ? "Slack → Apps → Incoming Webhooks → add one for a channel, then paste its URL. We post a ready-to-read message."
                  : form.kind === "teams" ? "Teams → channel → Connectors → Incoming Webhook → create one, then paste its URL. We post a ready-to-read message."
                  : <>Paste the address your Zapier, Make, n8n or Pabbly step gave you. Each time something you pick below happens, {who} tells it right away.</>}
              </p>
              {form.kind !== "slack" && form.kind !== "teams" && (
                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer font-semibold">For developers</summary>
                  <p className="mt-1">We POST a JSON event to this URL, signed with an <span className="font-mono">X-Alabs-Signature</span> header (HMAC-SHA256 of the body using the secret shown after you add it). Any tool that accepts a webhook works.</p>
                </details>
              )}
            </>
          )}
          {isEventKind && !isRestaurant && <div>
            <label className="text-xs font-bold text-slate-400 uppercase">{isCrm ? `When to sync ${contactsLc}` : "Send these events"}</label>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {integrationEvents.map(e => (
                <label key={e.key} className="flex items-center gap-1.5 text-xs text-ink-700 cursor-pointer">
                  <input type="checkbox" className="accent-brand-700" checked={form.events.includes(e.key)} onChange={() => toggleEvent(e.key)} />
                  {e.label}
                </label>
              ))}
            </div>
          </div>}
          {msg && !msg.ok && <p className="text-[13px] font-medium text-red-600"><X className="inline w-3.5 h-3.5 mr-1 align-[-2px]" />{msg.text}</p>}
        </div>
      </Drawer>

      <div className="border-t border-line pt-5">
      </div>
    </div>
  );
}

// ── Google Sheets / Calendar — share with the portal's Google address ───────
type GoogleForm = { spreadsheetUrl: string; leadsTab: string; calendarId: string; slotMinutes: string; workStart: string; workEnd: string; workDays: string; noticeHours: string; daysAhead: string; eventTitle: string };
function GoogleSetup({ kind, email, form, set }: { kind: "google_sheets" | "google_calendar"; email: string | null; form: GoogleForm; set: (p: Partial<GoogleForm>) => void }) {
  const [copied, setCopied] = useState(false);
  if (!email) {
    return <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-3 py-2.5">The portal&apos;s Google access isn&apos;t set up yet, so a {kind === "google_sheets" ? "sheet" : "calendar"} can&apos;t be connected. Ask the portal&apos;s administrator to add the Google service account key (GOOGLE_SERVICE_ACCOUNT_JSON).</p>;
  }
  const steps = kind === "google_sheets"
    ? ["Open the sheet and click Share.", "Paste the address above, choose Editor, untick Notify people, and click Share.", "Copy the sheet's link from your browser and paste it below."]
    : ["In Google Calendar, open Settings, then click your calendar on the left.", "Under Share with specific people, click Add people, paste the address above, and choose Make changes to events.", "Scroll to Integrate calendar, copy the Calendar ID, and paste it below."];
  const field = (key: keyof GoogleForm, placeholder: string, label: string) => (
    <label className="block space-y-0.5">
      <span className="text-[11px] font-bold text-slate-600">{label}</span>
      <input className={`${inp} w-full`} placeholder={placeholder} value={form[key]} onChange={e => set({ [key]: e.target.value } as Partial<GoogleForm>)} />
    </label>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-card border border-line p-3 space-y-2">
        <p className="text-xs font-bold text-ink-900">First, share your {kind === "google_sheets" ? "sheet" : "calendar"} with the portal</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 text-xs bg-canvas border border-line rounded px-2 py-1.5 break-all">{email}</code>
          <button onClick={() => { navigator.clipboard?.writeText(email); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="px-2 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas shrink-0">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
        </div>
        <ol className="list-decimal pl-4 space-y-0.5 text-[11px] text-ink-700">{steps.map(s => <li key={s}>{s}</li>)}</ol>
        <p className="text-[11px] text-slate-500">The portal reaches only this {kind === "google_sheets" ? "sheet" : "calendar"}, and only while it is shared. To stop it, remove the address in Google&apos;s Share settings.</p>
      </div>
      {kind === "google_sheets" ? <>
        {field("spreadsheetUrl", "https://docs.google.com/spreadsheets/d/…", "Sheet link *")}
        {field("leadsTab", "Portal log", "Tab to add rows to (created if missing)")}
        <p className="text-[11px] text-slate-500">To message people from rows in a sheet instead, use the Google Sheets card under Add an integration.</p>
      </> : <>
        {field("calendarId", "you@yourbusiness.com", "Calendar ID *")}
        <div className="grid grid-cols-2 gap-2">
          {field("slotMinutes", "30", "Appointment length (minutes)")}
          {field("workDays", "Mon-Sat", "Working days")}
          {field("workStart", "10:00", "Day starts")}
          {field("workEnd", "19:00", "Day ends")}
          {field("noticeHours", "2", "Minimum notice (hours)")}
          {field("daysAhead", "7", "Days ahead to offer")}
        </div>
        {field("eventTitle", "Call with {{name}}", "Event title ({{name}} is the customer)")}
        <p className="text-[11px] text-slate-500">Add a “Book meeting” node to a chatbot flow. It offers free times from this calendar, checks the chosen one is still free, and books it. The customer isn&apos;t added as a guest (Google allows that only for Workspace accounts with extra setup); their name and number go in the event.</p>
      </>}
    </div>
  );
}

// ── Mezvaan — default outlet + the events Mezvaan sends ─────────────────────
// The default outlet is used when a guest doesn't name one (multi-outlet
// restaurants). Events turn into WhatsApp messages through API rules, each with
// an approved template — nothing is sent until the owner sets one up.
function MezmitraCard({ integration: i, onSaved, goTo }: { integration: Integration; onSaved: () => void; goTo: (t: Tab) => void }) {
  const brand = useBrand();
  const who = brand.partnerId ? brand.name : "Talko";
  const [outlets, setOutlets] = useState<{ id: string; name: string; city: string | null; bookingOn: boolean }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch(`/api/admin/integrations/${i.id}/outlets`).then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setOutlets(d.outlets ?? []); })
      .catch(() => setError("Couldn't load outlets."));
  }, [i.id]);
  const current = i.config.defaultOutletId ?? "";
  async function pick(id: string) {
    setSaving(true);
    const r = await fetch(`/api/admin/integrations/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultOutletId: id || null }) }).catch(() => null);
    if (r?.ok) toast("Default outlet saved"); else toast({ text: "Couldn't save the outlet. Please try again.", tone: "error" });
    setSaving(false); onSaved();
  }
  return (
    <div className="mt-1 rounded-control bg-canvas p-3 space-y-2">
      {error ? <p className="text-[11px] text-red-600">{error}</p>
        : outlets === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" />
        : outlets.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-ink-700">
            Default outlet
            <select className={inp} aria-label="Default outlet" value={current} disabled={saving} onChange={e => pick(e.target.value)}>
              <option value="">Ask the guest</option>
              {outlets.map(o => <option key={o.id} value={o.id}>{o.name}{o.city ? `, ${o.city}` : ""}{o.bookingOn ? "" : " (booking off)"}</option>)}
            </select>
          </label>
        )}
      {outlets?.length === 1 && !outlets[0].bookingOn && <p className="text-[11px] text-amber-700">Table booking in chat is off — turn it on in Mezvaan (Settings → Talko AI).</p>}
      <p className="text-[12px] text-slate-600">Mezvaan tells {who} when something happens at your restaurant — a table booked, a bill paid. Nothing is sent to guests until you choose a WhatsApp message for it under <b>Broadcast → API broadcasting</b>.</p>
      <details className="text-[11px] text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-500">Events Mezvaan sends ({MEZMITRA_EVENTS.length}) — for setting up the messages</summary>
        <ul className="space-y-1 mt-1.5">
          {MEZMITRA_EVENTS.map(e => (
            <li key={e.key}><code className="font-mono text-ink-800">{e.key}</code> — {e.when}. <span className="text-slate-500">Details you can use in the message: {e.fields}</span></li>
          ))}
        </ul>
        <p className="mt-1.5 text-slate-500">Review requests count as marketing: only send them to guests who agreed (condition <code className="font-mono">marketing_opt_in equals true</code>) and at most once every few months (e.g. 2160 hours).</p>
      </details>
      <button onClick={() => goTo("broadcast")} className="min-h-8 text-[12px] font-bold text-brand-700 hover:underline">Choose the messages in Broadcast →</button>
    </div>
  );
}

// ── Payment webhook (per-tenant) — confirm orders the moment a pay link is paid ─
// Every tenant uses their OWN Razorpay/Stripe account, so each needs their own
// webhook pointing at their own URL and verified with their own secret. This
// card shows that URL and lets them paste the signing secret (stored encrypted,
// never echoed back). Without it, orders stay "pending" until reconciled.
function PaymentWebhookCard({ integration: i, onSaved }: { integration: Integration; onSaved: () => void }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const isStripe = i.kind === "stripe";
  // The portal origin == the app origin, so the endpoint the provider must call.
  const url = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/${i.kind}/${i.id}` : "";

  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  async function save() {
    if (!secret.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch(`/api/admin/integrations/${i.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookSecret: secret.trim() }),
      }).then(r => r.json());
      if (d.error) setMsg({ ok: false, text: d.error });
      else { setMsg(null); toast("Saved — orders now confirm on their own when paid"); setSecret(""); onSaved(); }
    } catch { setMsg({ ok: false, text: "Connection error." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-1 pt-3 border-t border-line/70 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.06em]">Confirm orders automatically when paid</p>
        {i.hasWebhookSecret
          ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Set up</span>
          : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Not set up — orders stay pending</span>}
      </div>
      <p className="text-[12px] text-slate-600">So {isStripe ? "Stripe" : "Razorpay"} can tell us the moment a customer pays, add the address below in your {isStripe ? "Stripe" : "Razorpay"} account once:</p>
      <p className="text-[11px] text-slate-500">
        {isStripe
          ? <>In Stripe → <b>Developers → Webhooks → Add endpoint</b>, paste the URL below, select the event <span className="font-mono">checkout.session.completed</span>, then copy the endpoint&apos;s <b>Signing secret</b> (<span className="font-mono">whsec_…</span>) and paste it here.</>
          : <>In Razorpay → <b>Settings → Webhooks → Add New Webhook</b>, paste the URL below, tick the event <span className="font-mono">payment_link.paid</span>, set a <b>Secret</b> of your choosing, then paste that same secret here.</>}
      </p>
      <div className="space-y-1">
        <p className="text-[11px] font-bold text-ink-500 uppercase tracking-wide">Address to paste</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 min-w-0 text-[11px] font-mono bg-canvas border border-line rounded px-2 py-1.5 truncate" title={url}>{url}</code>
          <button onClick={copy} aria-label="Copy address" className="grid place-items-center w-9 h-9 rounded-control border border-line text-ink-600 hover:bg-canvas shrink-0">{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input className={`${inp} flex-1 min-w-0`} type="password" aria-label={isStripe ? "Signing secret" : "Secret"} placeholder={isStripe ? "Signing secret (whsec_…)" : "The secret you set in Razorpay"} value={secret} onChange={e => setSecret(e.target.value)} />
        <button onClick={save} disabled={busy || !secret.trim()} title={!secret.trim() ? "Paste the secret first" : undefined} className="min-h-9 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 shrink-0">{busy ? "Saving…" : i.hasWebhookSecret ? "Rotate" : "Save"}</button>
      </div>
      {msg && <p className={`text-[11px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? <Check className="inline w-3.5 h-3.5 mr-1 align-[-2px]" /> : <X className="inline w-3.5 h-3.5 mr-1 align-[-2px]" />}{msg.text}</p>}
    </div>
  );
}

// ── LSQ → portal inbound webhook (Phase 4: lead-arrived / owner-assigned) ─────
// Shows the URL + secret to paste into LeadSquared Automations (Lead Created /
// Owner Changed / Stage Changed → Webhook action). The portal then keeps the
// contact in sync and auto-assigns the lead's conversation to the team member
// whose email matches the LSQ owner.
function LsqInboundCard() {
  const ask = useConfirm();
  const [cfg, setCfg] = useState<{ url: string; secret: string; header: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/admin/lsq-webhook").then(r => r.json()).then(d => { if (d.url) setCfg(d); }).catch(() => {}); }, []);

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(k => (k === key ? null : k)), 1500); } catch { /* blocked */ }
  };
  async function rotate() {
    if (!(await ask({
      title: "Rotate the inbound secret?", tone: "caution", confirmLabel: "Rotate secret",
      message: "The old secret stops working the moment this is done. Every LeadSquared automation still using it fails with a 401 until you paste the new one in — so have LeadSquared open before you continue.",
    }))) return;
    setBusy(true);
    try {
      const d = await fetch("/api/admin/lsq-webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotate: true }) }).then(r => r.json());
      if (d.url) { setCfg(d); toast("New secret ready — paste it into LeadSquared now"); }
      else toast({ text: "Couldn't make a new secret. Please try again.", tone: "error" });
    } catch { toast({ text: "Couldn't reach the server. Please try again.", tone: "error" }); }
    finally { setBusy(false); }
  }

  if (!cfg) return null;
  const samplePayload = `{"event":"lead_created","Phone":"@{Lead:Phone,}","Mobile":"@{Lead:Mobile,}","FirstName":"@{Lead:FirstName,}","LastName":"@{Lead:LastName,}","EmailAddress":"@{Lead:EmailAddress,}","OwnerEmail":"@{Lead:OwnerIdEmailAddress,}","OwnerName":"@{Lead:OwnerIdName,}","ProspectStage":"@{Lead:ProspectStage,}","ProspectID":"@{Lead:ProspectID,}","Source":"@{Lead:Source,}"}`;
  return (
    <section className="bg-white rounded-card border border-line p-4 space-y-2.5">
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase">LeadSquared → portal (inbound webhook)</p><PageInfo className="text-xs text-slate-500 mt-0.5" lead={<>In LSQ, create Automations with a <b>Webhook</b> action posting to this URL.</>}>In LSQ, create Automations (Lead Created / Owner Changed / Stage Changed) with a <b>Webhook</b> action posting to this URL. The portal syncs the contact (stage, owner, source as attributes), auto-assigns the chat to the matching team member, and — if you&apos;ve turned on <b>Sequences → Landing-page form → WhatsApp flow</b> — sends the welcome template + starts your flow on a form lead (10-digit numbers are auto country-coded).</PageInfo>
      </div>
      {[{ k: "url", label: "POST URL", v: cfg.url }, { k: "secret", label: `Secret (header ${cfg.header} or ?secret=)`, v: cfg.secret }, { k: "body", label: "Webhook body (mail-merge JSON — change event per automation)", v: samplePayload }].map(row => (
        <div key={row.k} className="space-y-1">
          <p className="text-[11px] font-bold text-ink-500 uppercase tracking-wide">{row.label}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-[11px] font-mono bg-canvas border border-line rounded px-2 py-1.5 truncate" title={row.v}>{row.v}</code>
            <button onClick={() => copy(row.v, row.k)} aria-label={`Copy ${row.label}`} className="grid place-items-center w-9 h-9 rounded-control border border-line text-ink-600 hover:bg-canvas shrink-0">{copied === row.k ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
        <p className="text-[11px] text-ink-400 min-w-0">Set <code className="font-mono">event</code> to <code className="font-mono">lead_created</code> / <code className="font-mono">owner_changed</code> / <code className="font-mono">stage_changed</code> per automation. Owner emails must match your team members&apos; login emails.</p>
        <button onClick={rotate} disabled={busy} className="min-h-8 px-2.5 py-1 rounded-control border border-line text-[12px] font-bold text-ink-600 hover:bg-canvas shrink-0 disabled:opacity-60">{busy ? "…" : "Rotate secret"}</button>
      </div>
    </section>
  );
}

export default IntegrationsTab;
