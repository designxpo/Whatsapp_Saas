"use client";

// Integrations hub tab — extracted from admin/page.tsx, lazy-loaded.
import { useState, useEffect, useCallback } from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { type Tab, inp } from "../_shared";

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

  const statusBadge = (s: Integration["status"]) => {
    const map = { connected: "bg-emerald-100 text-emerald-700", error: "bg-red-100 text-red-600", unverified: "bg-slate-100 text-slate-500" };
    const label = { connected: "Connected", error: "Error", unverified: "Not tested" };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${map[s]}`}>{label[s]}</span>;
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Integrations</h2>
        <p className="text-sm text-slate-500">Connect the tools you already use — no code required. Send events to Zapier/Make/n8n/Slack/Teams, sync leads to HubSpot, Pipedrive or LeadSquared, take payments via Razorpay or Stripe, import a Shopify/WooCommerce catalog, or let customers book via Cal.com.</p>
      </div>

      {msg && <p className={`text-[13px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}

      {newSecret && (
        <div className="bg-amber-50 border border-amber-200 rounded-card p-4 space-y-1.5">
          <p className="text-xs font-bold text-amber-800">Signing secret — copy it now, it won't be shown again.</p>
          <p className="text-[11px] text-amber-700">Use it to verify the <span className="font-mono">X-Alabs-Signature</span> header (HMAC-SHA256 of the body). Slack/Teams don't need it.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-amber-200 rounded px-2 py-1.5 break-all">{newSecret}</code>
            <button onClick={() => { navigator.clipboard?.writeText(newSecret); }} className="px-2 py-1.5 rounded-control border border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100 shrink-0"><Copy className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      {/* Existing connections */}
      <div className="space-y-2">
        {items === null && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}
        {items?.length === 0 && <p className="text-sm text-slate-400 bg-white rounded-card border border-line p-5 text-center">No integrations connected yet — add one below.</p>}
        {items?.map(i => (
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
      </div>

      {/* Add a webhook */}
      {adding ? (
        <section className="bg-white rounded-card border border-line p-5 space-y-3">
          <h3 className="text-sm font-bold text-ink-900">Add an integration</h3>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase">Type</label>
            <select className={`${inp} w-full mt-1`} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
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
                <p className="text-[11px] text-slate-500">Every chat syncs to the lead's timeline; stage &amp; owner show in Live Chat. Pipeline stages and CRM drips also use this connection.</p>
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
        <button onClick={() => { setAdding(true); setNewSecret(null); }} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold"><Plus className="w-4 h-4" /> Add an integration</button>
      )}
    </div>
  );
}


export default IntegrationsTab;
