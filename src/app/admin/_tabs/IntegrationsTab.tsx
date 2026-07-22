"use client";

// Integrations hub tab — extracted from admin/page.tsx, lazy-loaded.
import { useState, useEffect, useCallback } from "react";
import { Copy, Loader2, Trash2, ArrowLeft } from "lucide-react";
import { type Tab, inp, ImgFallback } from "../_shared";

// ── Integrations hub: per-tenant outbound webhooks (Zapier/Make/Slack/Teams) ──
type Integration = {
  id: string; kind: string; name: string; active: boolean;
  config: { url?: string; format?: string }; events: string[];
  status: "connected" | "error" | "unverified"; statusDetail: string | null;
  hasSecret: boolean; lastEventAt: string | null; createdAt: string;
};
const INTEGRATION_EVENTS: { key: string; label: string }[] = [
  { key: "contact.created", label: "New contact / lead" },
  { key: "message.inbound", label: "New message received" },
  { key: "conversation.escalated", label: "Chat handed to a human" },
  { key: "order.created", label: "Order placed" },
  { key: "contact.optout", label: "Contact opted out" },
];
const FORMAT_LABELS: Record<string, string> = { generic: "Standard (Zapier / Make / n8n)", slack: "Slack message", teams: "Microsoft Teams message" };
const KIND_LABELS: Record<string, string> = { webhook: "Webhook (Zapier / Make / n8n)", slack: "Slack", teams: "Microsoft Teams", hubspot: "HubSpot", pipedrive: "Pipedrive", leadsquared: "LeadSquared", razorpay: "Razorpay", stripe: "Stripe", shopify: "Shopify", woocommerce: "WooCommerce", calcom: "Cal.com" };
const CRM_KINDS = ["hubspot", "pipedrive", "leadsquared"];
const PAYMENT_KINDS = ["razorpay", "stripe"];
const STORE_KINDS = ["shopify", "woocommerce"];
const SCHEDULE_KINDS = ["calcom"];
const EVENT_KINDS = ["webhook", "slack", "teams", "hubspot", "pipedrive"];
const TOKEN_HELP: Record<string, string> = {
  hubspot: "HubSpot → Settings → Integrations → Private Apps → create one with crm.objects.contacts read+write, then paste its token.",
  pipedrive: "Pipedrive → Settings → Personal preferences → API → copy your personal API token.",
  razorpay: "Razorpay → Settings → API Keys → generate keys, then paste the Key ID and Key Secret.",
  stripe: "Stripe → Developers → API keys → copy your Secret key (sk_live_… or sk_test_…).",
  shopify: "Shopify → Settings → Apps → Develop apps → create a custom app with read_products, then paste its Admin API access token.",
  woocommerce: "WooCommerce → Settings → Advanced → REST API → add a key with Read access, then paste the Consumer key and secret.",
  calcom: "Cal.com → Settings → Developer → API Keys for the key; the Event Type ID is in the event type's URL (…/event-types/123).",
  leadsquared: "LeadSquared → My Profile → Settings → API and Webhooks for the Access Key & Secret Key; the Activity code is the event code of a Custom Activity (e.g. \"WhatsApp Message\").",
};

// The catalog of connectable tools, shown as clickable logo cards. `logo` is an
// explicit, verified-working URL per brand — full-colour Iconify `logos:` marks
// where available, Simple Icons for the two Iconify lacks (Razorpay, Cal.com).
// null → a lettered tile (LeadSquared, which no public icon set carries). Both
// hosts are allowed by the app CSP (frame-ancestors only) and used by the site.
const CATALOG: { kind: string; logo: string | null; blurb: string }[] = [
  { kind: "hubspot", logo: "https://api.iconify.design/logos:hubspot.svg", blurb: "Sync new contacts into HubSpot CRM." },
  { kind: "pipedrive", logo: "https://api.iconify.design/logos:pipedrive.svg", blurb: "Sync new people into Pipedrive CRM." },
  { kind: "leadsquared", logo: null, blurb: "Sync every chat to the lead's LeadSquared timeline." },
  { kind: "razorpay", logo: "https://cdn.simpleicons.org/razorpay", blurb: "Send Razorpay payment links inside the chat." },
  { kind: "stripe", logo: "https://api.iconify.design/logos:stripe.svg", blurb: "Send Stripe payment links inside the chat." },
  { kind: "shopify", logo: "https://api.iconify.design/logos:shopify.svg", blurb: "Import your Shopify product catalog." },
  { kind: "woocommerce", logo: "https://api.iconify.design/logos:woocommerce.svg", blurb: "Import your WooCommerce catalog." },
  { kind: "calcom", logo: "https://cdn.simpleicons.org/caldotcom", blurb: "Let customers book meetings via Cal.com." },
  { kind: "slack", logo: "https://api.iconify.design/logos:slack-icon.svg", blurb: "Post events to a Slack channel." },
  { kind: "teams", logo: "https://api.iconify.design/logos:microsoft-teams.svg", blurb: "Post events to a Microsoft Teams channel." },
  { kind: "webhook", logo: "https://api.iconify.design/logos:zapier-icon.svg", blurb: "Send signed events to Zapier, Make, n8n or any webhook." },
];

// A connector's brand mark — its catalog logo URL, falling back to a lettered tile
// when there's no logo or the image fails to load.
function Logo({ kind, logo }: { kind: string; logo: string | null }) {
  const initial = (KIND_LABELS[kind] ?? kind).replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "?";
  const box = "w-10 h-10 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center font-extrabold text-sm shrink-0";
  if (!logo) return <div className={box}>{initial}</div>;
  return <ImgFallback url={logo} imgClass="w-10 h-10 rounded-xl bg-canvas object-contain p-2 shrink-0" boxClass={box} icon={initial} />;
}

function IntegrationsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [items, setItems] = useState<Integration[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ kind: "webhook", name: "", url: "", format: "generic", token: "", keyId: "", shopDomain: "", storeUrl: "", consumerKey: "", eventTypeId: "", lsqAccessKey: "", lsqHost: "", lsqActivityCode: "", lsqTaskCategory: "", lsqIgHandleField: "", lsqAutoCreate: false, events: ["contact.created", "conversation.escalated"] as string[] });
  const isCrm = CRM_KINDS.includes(form.kind);
  const isPayment = PAYMENT_KINDS.includes(form.kind);
  const isStore = STORE_KINDS.includes(form.kind);
  const isSchedule = SCHEDULE_KINDS.includes(form.kind);
  const isEventKind = EVENT_KINDS.includes(form.kind);
  const isToken = isCrm || isPayment || isStore || isSchedule;
  const [syncing, setSyncing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/integrations").then(r => r.json()).then(d => setItems(d.integrations ?? [])).catch(() => setItems([]));
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
        setMsg({ ok: true, text: "Added. Hit Test to confirm it's connected." });
        setForm({ kind: "webhook", name: "", url: "", format: "generic", token: "", keyId: "", shopDomain: "", storeUrl: "", consumerKey: "", eventTypeId: "", lsqAccessKey: "", lsqHost: "", lsqActivityCode: "", lsqTaskCategory: "", lsqIgHandleField: "", lsqAutoCreate: false, events: ["contact.created", "conversation.escalated"] });
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
    await fetch(`/api/admin/integrations/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !i.active }) });
    load();
  }

  async function remove(i: Integration) {
    if (!confirm(`Delete "${i.name}"? Events will stop being sent there.`)) return;
    await fetch(`/api/admin/integrations/${i.id}`, { method: "DELETE" });
    load();
  }

  // Clicking a catalog card opens the setup form for THAT connector (kind fixed).
  function openSetup(kind: string) {
    setForm({ kind, name: "", url: "", format: "generic", token: "", keyId: "", shopDomain: "", storeUrl: "", consumerKey: "", eventTypeId: "", lsqAccessKey: "", lsqHost: "", lsqActivityCode: "", lsqTaskCategory: "", lsqIgHandleField: "", lsqAutoCreate: false, events: ["contact.created", "conversation.escalated"] });
    setMsg(null); setNewSecret(null); setAdding(true);
  }

  const statusBadge = (s: Integration["status"]) => {
    const map = { connected: "bg-emerald-100 text-emerald-700", error: "bg-red-100 text-red-600", unverified: "bg-slate-100 text-slate-500" };
    const label = { connected: "Connected", error: "Error", unverified: "Not tested" };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${map[s]}`}>{label[s]}</span>;
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Integrations</h2>
        <p className="text-sm text-slate-500">Connect the tools you already use — no code required. Send events to Zapier/Make/n8n/Slack/Teams, sync leads to HubSpot, Pipedrive or LeadSquared, take payments via Razorpay or Stripe, import a Shopify/WooCommerce catalog, or let customers book via Cal.com.</p>
      </div>

      {msg && <p className={`text-[13px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}

      {newSecret && (
        <div className="bg-amber-50 border border-amber-200 rounded-card p-4 space-y-1.5">
          <p className="text-xs font-bold text-amber-800">Signing secret — copy it now, it won’t be shown again.</p>
          <p className="text-[11px] text-amber-700">Use it to verify the <span className="font-mono">X-Alabs-Signature</span> header (HMAC-SHA256 of the body). Slack/Teams don’t need it.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 break-all">{newSecret}</code>
            <button onClick={() => { navigator.clipboard?.writeText(newSecret); }} className="px-2 py-1.5 rounded-control border border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100 shrink-0"><Copy className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* Connected integrations — manage, test, pause or remove */}
      {items === null && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}
      {!!items?.length && <div className="space-y-2">
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">Connected ({items.length})</p>
        {items.map(i => (
          <section key={i.id} className="bg-white rounded-card border border-line p-4 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-ink-900 truncate">{i.name}</h3>
                  {statusBadge(i.status)}
                  {!i.active && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">Paused</span>}
                </div>
                <p className="text-[11px] text-slate-500 truncate">{SCHEDULE_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · books meetings` : STORE_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · imports products` : PAYMENT_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · payment links` : i.kind === "leadsquared" ? `LeadSquared · syncs every chat to the lead timeline` : CRM_KINDS.includes(i.kind) ? `${KIND_LABELS[i.kind]} · syncs contacts` : `${FORMAT_LABELS[i.config.format ?? "generic"]} · ${i.config.url}`}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {STORE_KINDS.includes(i.kind) && <button onClick={() => sync(i.id)} disabled={syncing === i.id} className="px-2.5 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{syncing === i.id ? "Importing…" : "Sync now"}</button>}
                <button onClick={() => test(i.id)} disabled={testing === i.id} className="px-2.5 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas disabled:opacity-60">{testing === i.id ? "Testing…" : "Test"}</button>
                <button onClick={() => toggleActive(i)} className="px-2.5 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">{i.active ? "Pause" : "Resume"}</button>
                <button onClick={() => remove(i)} className="p-1.5 text-red-400 hover:text-red-600 rounded-control"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {SCHEDULE_KINDS.includes(i.kind)
                ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Books meetings from a flow’s “Book meeting” node</span>
                : STORE_KINDS.includes(i.kind)
                ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Imports your product catalog</span>
                : PAYMENT_KINDS.includes(i.kind)
                ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Sends a payment link on checkout</span>
                : i.events.map(e => <span key={e} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">{INTEGRATION_EVENTS.find(x => x.key === e)?.label ?? e}</span>)}
            </div>
            {i.status === "error" && i.statusDetail && <p className="text-[11px] text-red-600">{i.statusDetail}</p>}
            {i.lastEventAt && <p className="text-[10px] text-slate-400">Last event sent {new Date(i.lastEventAt).toLocaleString()}</p>}
          </section>
        ))}
      </div>}

      {/* LSQ → portal inbound webhook: only meaningful once LSQ is connected */}
      {!!items?.some(i => i.kind === "leadsquared") && <LsqInboundCard />}

      {/* Add an integration — browse the logo catalog, then set up the chosen one */}
      {adding ? (
        <section className="bg-white rounded-card border border-line p-5 space-y-3">
          <div className="flex items-center gap-2.5">
            <Logo kind={form.kind} logo={CATALOG.find(c => c.kind === form.kind)?.logo ?? null} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-ink-900 truncate">Set up {KIND_LABELS[form.kind]}</h3>
              <p className="text-[11px] text-slate-500 truncate">{CATALOG.find(c => c.kind === form.kind)?.blurb}</p>
            </div>
            <button onClick={() => { setAdding(false); setMsg(null); setNewSecret(null); }} className="text-[11px] font-bold text-brand-700 hover:underline flex items-center gap-0.5 shrink-0"><ArrowLeft className="w-3.5 h-3.5" /> All integrations</button>
          </div>
          <input className={`${inp} w-full`} placeholder={isToken ? `Name (e.g. ${KIND_LABELS[form.kind]})` : "Name (e.g. Slack #leads, Zapier orders)"} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          {isToken ? (
            <div className="space-y-2">
              {form.kind === "razorpay" && <input className={`${inp} w-full`} placeholder="Razorpay Key ID (rzp_…)" value={form.keyId} onChange={e => setForm({ ...form, keyId: e.target.value })} />}
              {form.kind === "shopify" && <input className={`${inp} w-full`} placeholder="Shop domain (my-store.myshopify.com)" value={form.shopDomain} onChange={e => setForm({ ...form, shopDomain: e.target.value })} />}
              {form.kind === "woocommerce" && <>
                <input className={`${inp} w-full`} placeholder="Store URL (https://shop.example.com)" value={form.storeUrl} onChange={e => setForm({ ...form, storeUrl: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Consumer key (ck_…)" value={form.consumerKey} onChange={e => setForm({ ...form, consumerKey: e.target.value })} />
              </>}
              {form.kind === "calcom" && <input className={`${inp} w-full`} placeholder="Event Type ID (e.g. 123)" value={form.eventTypeId} onChange={e => setForm({ ...form, eventTypeId: e.target.value })} />}
              {form.kind === "leadsquared" && <>
                <input className={`${inp} w-full`} placeholder="Access Key" value={form.lsqAccessKey} onChange={e => setForm({ ...form, lsqAccessKey: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="API host (e.g. https://api-in21.leadsquared.com)" value={form.lsqHost} onChange={e => setForm({ ...form, lsqHost: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Activity code (e.g. 100)" value={form.lsqActivityCode} onChange={e => setForm({ ...form, lsqActivityCode: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Task category (optional, default 2)" value={form.lsqTaskCategory} onChange={e => setForm({ ...form, lsqTaskCategory: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="IG handle field (optional, e.g. mx_Instagram)" value={form.lsqIgHandleField} onChange={e => setForm({ ...form, lsqIgHandleField: e.target.value })} />
              </>}
              <input className={`${inp} w-full`} type="password" placeholder={form.kind === "razorpay" ? "Razorpay Key Secret" : form.kind === "stripe" ? "Stripe secret key (sk_…)" : form.kind === "shopify" ? "Admin API access token" : form.kind === "woocommerce" ? "Consumer secret (cs_…)" : form.kind === "calcom" ? "Cal.com API key" : form.kind === "leadsquared" ? "Secret Key" : `${KIND_LABELS[form.kind]} API token`} value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} />
              <p className="text-[11px] text-slate-500">{TOKEN_HELP[form.kind]}</p>
              {isPayment && <p className="text-[11px] text-slate-500">A payment link is sent automatically when a customer checks out an order.</p>}
              {isStore && <p className="text-[11px] text-slate-500">After connecting, hit “Sync now” to import your products into the catalog. One-way; re-sync anytime.</p>}
              {isSchedule && <p className="text-[11px] text-slate-500">Add a “Book meeting” node to a chatbot flow — it shows live Cal.com slots and books the chosen time.</p>}
              {form.kind === "leadsquared" && <>
                <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer">
                  <input type="checkbox" className="accent-brand-700" checked={form.lsqAutoCreate} onChange={e => setForm({ ...form, lsqAutoCreate: e.target.checked })} />
                  Auto-create a lead for new inbound contacts (off = only sync to existing leads)
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
                  : "We POST a signed JSON event to this URL — works with Zapier, Make, n8n, Pabbly and any tool that accepts a webhook."}
              </p>
            </>
          )}
          {isEventKind && <div>
            <label className="text-xs font-bold text-slate-400 uppercase">{isCrm ? "Sync a contact on" : "Send these events"}</label>
            <div className="grid grid-cols-2 gap-1.5 mt-1.5">
              {INTEGRATION_EVENTS.map(e => (
                <label key={e.key} className="flex items-center gap-1.5 text-xs text-ink-700 cursor-pointer">
                  <input type="checkbox" className="accent-brand-700" checked={form.events.includes(e.key)} onChange={() => toggleEvent(e.key)} />
                  {e.label}
                </label>
              ))}
            </div>
          </div>}
          <div className="flex items-center gap-2">
            <button onClick={create} disabled={busy || (isEventKind && !form.events.length) || (
              isSchedule ? (!form.token.trim() || !form.eventTypeId.trim())
              : isStore ? (!form.token.trim() || (form.kind === "shopify" ? !form.shopDomain.trim() : !form.storeUrl.trim() || !form.consumerKey.trim()))
              : form.kind === "leadsquared" ? (!form.token.trim() || !form.lsqAccessKey.trim() || !form.lsqHost.trim() || !form.lsqActivityCode.trim())
              : isCrm || isPayment ? (!form.token.trim() || (form.kind === "razorpay" && !form.keyId.trim()))
              : !form.url.trim()
            )} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Add integration"}</button>
            <button onClick={() => { setAdding(false); setMsg(null); }} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">Cancel</button>
          </div>
        </section>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]">Add an integration</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CATALOG.map(c => {
              const conns = (items ?? []).filter(i => i.kind === c.kind);
              return (
                <button key={c.kind} onClick={() => openSetup(c.kind)} className="text-left bg-white rounded-card border border-line p-4 flex flex-col gap-2 hover:border-brand-500 hover:shadow-sm transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <Logo kind={c.kind} logo={c.logo} />
                    {!!conns.length && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">{conns.length > 1 ? `${conns.length} connected` : "Connected"}</span>}
                  </div>
                  <p className="text-sm font-bold text-ink-900 leading-tight">{KIND_LABELS[c.kind]}</p>
                  <p className="text-[11px] text-slate-500 leading-snug">{c.blurb}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LSQ → portal inbound webhook (Phase 4: lead-arrived / owner-assigned) ─────
// Shows the URL + secret to paste into LeadSquared Automations (Lead Created /
// Owner Changed / Stage Changed → Webhook action). The portal then keeps the
// contact in sync and auto-assigns the lead's conversation to the team member
// whose email matches the LSQ owner.
function LsqInboundCard() {
  const [cfg, setCfg] = useState<{ url: string; secret: string; header: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/admin/lsq-webhook").then(r => r.json()).then(d => { if (d.url) setCfg(d); }).catch(() => {}); }, []);

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(k => (k === key ? null : k)), 1500); } catch { /* blocked */ }
  };
  async function rotate() {
    if (!confirm("Rotate the inbound secret? Every LSQ automation using the old one starts failing (401) until updated.")) return;
    setBusy(true);
    try {
      const d = await fetch("/api/admin/lsq-webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotate: true }) }).then(r => r.json());
      if (d.url) setCfg(d);
    } finally { setBusy(false); }
  }

  if (!cfg) return null;
  const samplePayload = `{"event":"lead_created","Phone":"@{Lead:Phone,}","Mobile":"@{Lead:Mobile,}","FirstName":"@{Lead:FirstName,}","LastName":"@{Lead:LastName,}","EmailAddress":"@{Lead:EmailAddress,}","OwnerEmail":"@{Lead:OwnerIdEmailAddress,}","OwnerName":"@{Lead:OwnerIdName,}","ProspectStage":"@{Lead:ProspectStage,}","ProspectID":"@{Lead:ProspectID,}","Source":"@{Lead:Source,}"}`;
  return (
    <section className="bg-white rounded-card border border-line p-4 space-y-2.5">
      <div>
        <p className="text-xs font-bold text-slate-400 uppercase">LeadSquared → portal (inbound webhook)</p>
        <p className="text-[11px] text-slate-500 mt-0.5">In LSQ, create Automations (Lead Created / Owner Changed / Stage Changed) with a <b>Webhook</b> action posting to this URL. The portal syncs the contact (stage, owner, source as attributes), auto-assigns the chat to the matching team member, and — if you&apos;ve turned on <b>Sequences → Landing-page form → WhatsApp flow</b> — sends the welcome template + starts your flow on a form lead (10-digit numbers are auto country-coded).</p>
      </div>
      {[{ k: "url", label: "POST URL", v: cfg.url }, { k: "secret", label: `Secret (header ${cfg.header} or ?secret=)`, v: cfg.secret }, { k: "body", label: "Webhook body (mail-merge JSON — change event per automation)", v: samplePayload }].map(row => (
        <div key={row.k} className="space-y-1">
          <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wide">{row.label}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-[11px] font-mono bg-canvas border border-line rounded px-2 py-1.5 truncate" title={row.v}>{row.v}</code>
            <button onClick={() => copy(row.v, row.k)} className="px-2 py-1.5 rounded-control border border-line text-[10px] font-bold text-ink-600 hover:bg-canvas shrink-0">{copied === row.k ? "✓" : <Copy className="w-3.5 h-3.5" />}</button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-ink-400">Set <code className="font-mono">event</code> to <code className="font-mono">lead_created</code> / <code className="font-mono">owner_changed</code> / <code className="font-mono">stage_changed</code> per automation. Owner emails must match your team members&apos; login emails.</p>
        <button onClick={rotate} disabled={busy} className="px-2.5 py-1 rounded-control border border-line text-[10px] font-bold text-ink-500 hover:bg-canvas shrink-0 disabled:opacity-60">{busy ? "…" : "Rotate secret"}</button>
      </div>
    </section>
  );
}

export default IntegrationsTab;
