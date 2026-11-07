"use client";

// Catalog (commerce) — extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { Plus, ShoppingBag, Trash2, Workflow, Image as ImageIcon, Receipt, Search, ChevronDown, Loader2, MessageSquareText, Check, X, AlertTriangle } from "lucide-react";
import { inp, ImageUpload, ImgFallback, EmptyState } from "../_shared";
import { toast } from "@/components/toast";
import { Modal } from "@/components/overlay";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useConfirm } from "@/components/confirm-dialog";
import { useVocab } from "@/lib/vocab-client";

// ── Catalog (commerce) ────────────────────────────────────────────────────────
type ProductRow = { id: string; name: string; description: string | null; priceCents: number; currency: string; imageUrl: string | null; retailerId: string | null; metaProductId: string | null; catalogId: string | null; available: boolean; buttonText: string | null; buttonUrl: string | null };
const EMPTY_PRODUCT = { id: undefined as string | undefined, name: "", description: "", price: "", currency: "INR", imageUrl: "", retailerId: "", metaProductId: "", catalogId: "", available: true, buttonText: "", buttonUrl: "" };

// Image that falls back to a placeholder icon when the URL is missing or fails
// to load (e.g. a non-image link was pasted), instead of a broken-image glyph.
// ImgFallback now lives in ./_shared.

function CatalogTab() {
  const ask = useConfirm();
  const { vocab } = useVocab();
  const productLc = vocab.product.one.toLowerCase();
  const productsLc = vocab.product.many.toLowerCase();
  const [view, setView] = useState<"products" | "orders">("products");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [form, setForm] = useState<typeof EMPTY_PRODUCT | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  // Live FX rates for the editor's converted-price hint (non-PII, best-effort).
  const [fx, setFx] = useState<Record<string, number>>({});
  const formCurrency = form?.currency;
  useEffect(() => {
    if (!formCurrency) { setFx({}); return; }
    fetch(`/api/admin/currency?from=${encodeURIComponent(formCurrency.toUpperCase())}&to=USD,EUR,GBP,INR`).then(r => r.json()).then(d => setFx(d.rates ?? {})).catch(() => setFx({}));
  }, [formCurrency]);
  const load = useCallback(() => { fetch("/api/admin/products").then(r => r.json()).then(d => setProducts(d.products ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function makeCheckout() {
    setCheckoutBusy(true); setMsg(null); setCheckoutId(null);
    try {
      const res = await fetch("/api/admin/checkout-flow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Checkout" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || "Couldn't create the checkout form. Please try again.");
      else if (d.published) { setCheckoutId(d.id); toast("Checkout form ready to use in your chatbot flows"); }
      else setMsg(`Created the checkout form but WhatsApp didn't accept it: ${(d.validationErrors?.length ? d.validationErrors.join("; ") : d.publishError) || "it didn't pass WhatsApp's checks"}`);
    } catch {
      setMsg("Couldn't reach the server. Check your connection and try again.");
    } finally { setCheckoutBusy(false); }
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg(`Give the ${productLc} a name first.`); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name: form.name, description: form.description, priceCents: Math.round((Number(form.price) || 0) * 100), currency: form.currency, imageUrl: form.imageUrl || null, retailerId: form.retailerId || null, metaProductId: form.metaProductId || null, catalogId: form.catalogId || null, available: form.available, buttonText: form.buttonText || null, buttonUrl: form.buttonUrl || null }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Couldn't save. Please try again."); else { toast(`${form.name.trim()} saved`); setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(p: ProductRow) {
    if (!(await ask({ title: `Delete this ${productLc}?`, tone: "danger", confirmLabel: `Delete ${productLc}`, message: "Customers can no longer see or order it. Past orders keep their details.", facts: [{ label: vocab.product.one, value: p.name }] }))) return;
    const r = await fetch("/api/admin/products", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) }).catch(() => null);
    if (r?.ok) toast(`${p.name} deleted`); else toast({ text: "Couldn't delete it. Please try again.", tone: "error" });
    load();
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><ShoppingBag className="w-5 h-5" /> Catalog</h2><PageInfo className="text-sm text-slate-500" lead={<>What you sell. Send any of these in a chat, and customers can add to cart and pay without leaving WhatsApp.</>}>If someone leaves items in their cart, your cart-reminder {vocab.sequence.one.toLowerCase()} follows up with them automatically.</PageInfo>
        </div>
        {view === "products" && <div className="flex flex-wrap items-center sm:justify-end gap-2 sm:shrink-0">
          <button onClick={makeCheckout} disabled={checkoutBusy} title="Make a step-by-step checkout form (address, then payment) that opens inside WhatsApp" className="min-h-9 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60"><Workflow className="w-3.5 h-3.5" /> {checkoutBusy ? "Creating…" : "Create checkout form"}</button>
          <button onClick={() => { setForm({ ...EMPTY_PRODUCT }); setMsg(null); }} className="min-h-9 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add {productLc}</button>
        </div>}
      </div>

      <SegmentedControl
        className="max-w-xs"
        ariaLabel="Catalog view"
        value={view}
        onChange={setView}
        options={[
          { value: "products", label: vocab.product.many, icon: <ShoppingBag className="w-3.5 h-3.5" /> },
          { value: "orders", label: "Orders", icon: <Receipt className="w-3.5 h-3.5" /> },
        ]}
      />

      {view === "orders" ? <OrdersView /> : <>
      {checkoutId && <p className="text-[12px] text-emerald-800 bg-emerald-50 rounded-control px-3 py-2">Your checkout form is ready. In <b>Chatbot Flows</b>, add a “WhatsApp form” step and pick it — when the customer submits it, their cart becomes an order. <span className="text-emerald-700">(Form id <code className="font-mono">{checkoutId}</code>)</span></p>}
      {!form && msg && <p className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {msg}{/credential|token|WABA|not configured/i.test(msg) ? " — a checkout form needs a connected WhatsApp number first (Settings → WhatsApp numbers)." : ""}</p>}

      {products.map(p => (
        <div key={p.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
          <ImgFallback url={p.imageUrl ?? ""} imgClass="w-12 h-12 rounded-lg object-cover shrink-0" boxClass="w-12 h-12 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ShoppingBag className="w-5 h-5 text-ink-300" />} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{p.name} {!p.available && <span className="text-[11px] font-bold text-red-700">· Hidden from customers</span>}</p>
            <p className="text-[11px] text-ink-500">{p.currency} {(p.priceCents / 100).toFixed(2)}{p.retailerId ? ` · SKU ${p.retailerId}` : ""}</p>
          </div>
          <button onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? "", price: String(p.priceCents / 100), currency: p.currency, imageUrl: p.imageUrl ?? "", retailerId: p.retailerId ?? "", metaProductId: p.metaProductId ?? "", catalogId: p.catalogId ?? "", available: p.available, buttonText: p.buttonText ?? "", buttonUrl: p.buttonUrl ?? "" })} className="min-h-9 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(p)} aria-label={`Delete ${p.name}`} title="Delete" className="grid h-9 w-9 place-items-center text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!products.length && !form && (
        <div className="bg-white rounded-card border border-line">
          <EmptyState mood="sleeping" title={`No ${productsLc} yet`}
            body={`Add what you sell with a photo and price. You can then send ${productsLc} in any chat, and customers can order and pay without leaving WhatsApp.`}
            action={<button onClick={() => { setForm({ ...EMPTY_PRODUCT }); setMsg(null); }} className="min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add {productLc}</button>} />
        </div>
      )}

      {/* The shared Modal: a titled dialog that closes on Escape and keeps Tab inside. */}
      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? `Edit ${productLc}` : `New ${productLc}`}>
        {form && (<div className="flex flex-col xl:flex-row gap-5">
          <div className="flex-1 space-y-2 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={inp} placeholder="Product name" aria-label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div className="flex gap-2"><input className={`${inp} min-w-0`} placeholder="Price" aria-label="Price" inputMode="decimal" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /><input className={`${inp} w-20 shrink-0`} placeholder="INR" aria-label="Currency" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <ImgFallback url={form.imageUrl} imgClass="w-14 h-14 rounded-lg object-cover border border-line shrink-0" boxClass="w-14 h-14 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ImageIcon className="w-5 h-5 text-ink-300" />} />
              <div className="flex-1 space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <ImageUpload onUploaded={url => setForm({ ...form, imageUrl: url })} />
                  {form.imageUrl && <button onClick={() => setForm({ ...form, imageUrl: "" })} className="min-h-8 px-1 text-[12px] font-semibold text-ink-500 hover:text-red-600">Remove photo</button>}
                </div>
                <input className={`${inp} w-full`} placeholder="…or paste an image link" aria-label="Image link" value={form.imageUrl} onChange={e => setForm({ ...form, imageUrl: e.target.value })} />
              </div>
            </div>
            <textarea className={`${inp} sm:col-span-2`} rows={2} placeholder="Description" aria-label="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <input className={inp} aria-label="Product code (SKU)" placeholder={form.id ? "Your product code (SKU)" : "Product code (SKU) — made for you if blank"} value={form.retailerId} onChange={e => setForm({ ...form, retailerId: e.target.value })} />
            <input className={inp} aria-label="Facebook catalog product id (optional)" placeholder="Facebook catalog product id (optional)" value={form.metaProductId} onChange={e => setForm({ ...form, metaProductId: e.target.value })} />
            <input className={inp} maxLength={20} placeholder='Button label (e.g. "Buy now") — max 20' aria-label="Button label" value={form.buttonText} onChange={e => setForm({ ...form, buttonText: e.target.value })} />
            <input className={inp} placeholder="Button link (https://… — required to use a custom button)" aria-label="Button link" value={form.buttonUrl} onChange={e => setForm({ ...form, buttonUrl: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-8 items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.available} onChange={e => setForm({ ...form, available: e.target.checked })} /> Show to customers</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="min-h-10 px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : `Save ${productLc}`}</button>
            <button onClick={() => setForm(null)} className="min-h-10 px-2 py-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-700">{msg}</p>}
          </div>
          <div className="xl:w-64 shrink-0">
            <p className="text-[11px] font-medium text-ink-500 uppercase tracking-[0.06em] mb-1.5">Preview in chat</p>
            <div className="bg-[#e5ddd5] rounded-control p-3">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <ImgFallback url={form.imageUrl} imgClass="w-full h-32 object-cover" boxClass="h-32 bg-slate-100 flex items-center justify-center text-slate-300" icon={<ImageIcon className="w-7 h-7" />} />
                <div className="p-2.5 space-y-0.5">
                  <p className="text-[13px] font-semibold text-slate-800 break-words">{form.name || "Product name"}</p>
                  <p className="text-[13px] font-bold text-slate-900">{form.currency || "INR"} {(Number(form.price) || 0).toFixed(2)}</p>
                  {(() => {
                    const amt = Number(form.price) || 0;
                    const targets = Object.entries(fx).filter(([, r]) => r > 0).slice(0, 2);
                    return amt > 0 && targets.length ? <p className="text-[11px] text-slate-500">≈ {targets.map(([c, r]) => `${c} ${(amt * r).toFixed(2)}`).join(" · ")}</p> : null;
                  })()}
                  {form.description.trim() && <p className="text-[11px] text-slate-500 break-words line-clamp-2">{form.description}</p>}
                </div>
                <div className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-700">{form.buttonText.trim() || "View"}</div>
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-500 leading-snug">
              {form.buttonUrl.trim()
                ? <>Custom card: image + this button → <span className="font-mono break-all">{form.buttonUrl}</span>. Pick the “Custom card” style on a chatbot flow’s Product step.</>
                : <>The standard card shows WhatsApp’s own “View” button. Add a button link above to send a custom card with your label instead.</>}
            </p>
          </div>
        </div>)}
      </Modal>
      </>}
    </div>
  );
}


// ── Orders (in-chat checkout) ─────────────────────────────────────────────────
type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
type OrderItem = { productId: string; name: string; qty: number; priceCents: number };
type Order = { id: string; phone: string; items: OrderItem[]; totalCents: number; currency: string; status: OrderStatus; paymentRef: string | null; provider: string | null; paidAt: string | null; refundedAt: string | null; refundRef: string | null; refundAmountCents: number | null; createdAt: string };
type Stats = { counts: Record<OrderStatus, number>; total: number; revenueCents: number };

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  fulfilled: "bg-brand-50 text-brand-700",
  cancelled: "bg-slate-100 text-slate-500",
  refunded: "bg-rose-100 text-rose-600",
};
const STATUS_LABEL: Record<OrderStatus, string> = { pending: "Pending", paid: "Paid", fulfilled: "Fulfilled", cancelled: "Cancelled", refunded: "Refunded" };
// Manual transitions offered per current status (mirrors the server guard).
const NEXT_ACTIONS: Record<OrderStatus, { to: OrderStatus; label: string; primary?: boolean }[]> = {
  pending:   [{ to: "paid", label: "Mark paid", primary: true }, { to: "cancelled", label: "Cancel" }],
  paid:      [{ to: "fulfilled", label: "Mark fulfilled", primary: true }, { to: "refunded", label: "Refund" }, { to: "cancelled", label: "Cancel" }],
  fulfilled: [{ to: "refunded", label: "Refund" }, { to: "cancelled", label: "Cancel" }],
  cancelled: [],
  refunded:  [],
};
const money = (cents: number, ccy: string) => `${ccy} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const FILTERS: { value: "" | OrderStatus; label: string }[] = [
  { value: "", label: "All" }, { value: "pending", label: "Pending" }, { value: "paid", label: "Paid" },
  { value: "fulfilled", label: "Fulfilled" }, { value: "cancelled", label: "Cancelled" }, { value: "refunded", label: "Refunded" },
];

// Order-confirmation WhatsApp template setup. A UTILITY template is the only way
// to message a customer once the 24h window closes, so this is what lets a paid
// order be confirmed hours after checkout. One-click create → Meta approval →
// markOrderPaid uses it automatically. WhatsApp only (IG/Messenger confirmations
// are best-effort in-window text).
function ConfirmTemplateCard() {
  const [state, setState] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/order-confirmation-template").then(r => r.json())
      .then(d => { setState(d.state ?? "none"); setReason(d.reason ?? null); setNotice(d.notice ?? null); })
      .catch(() => setState("none"));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setNotice(null);
    try {
      const d = await fetch("/api/admin/order-confirmation-template", { method: "POST" }).then(r => r.json());
      if (d.error) setNotice(d.error);
      else { setState(d.status ?? "PENDING"); setNotice(d.note ?? null); toast("Sent to WhatsApp for approval — usually minutes to a few hours"); }
    } catch { setNotice("Couldn't reach the server. Please try again."); }
    finally { setBusy(false); }
  }

  if (state === null) return null;   // still loading — don't flash
  const approved = state === "APPROVED";
  const pending = state === "PENDING" || state === "IN_APPEAL" || state === "PAUSED";
  const rejected = state === "REJECTED" || state === "DISABLED";
  const tone = approved ? "border-emerald-200 bg-emerald-50" : rejected ? "border-red-200 bg-red-50" : pending ? "border-amber-200 bg-amber-50" : "border-line bg-white";

  return (
    <section className={`rounded-card border p-3.5 space-y-2 ${tone}`}>
      <div className="flex flex-wrap sm:flex-nowrap items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${approved ? "bg-emerald-100 text-emerald-700" : "bg-brand-50 text-brand-700"}`}><MessageSquareText className="w-4 h-4" /></div>
        <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-2.75rem)]">
          <p className="text-sm font-bold text-ink-900">WhatsApp order confirmation</p>
          {approved ? (
            <p className="flex items-start gap-1.5 text-[12px] text-emerald-800"><Check className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Live — every paid order gets a WhatsApp confirmation, even if the customer last messaged you more than 24 hours ago.</p>
          ) : pending ? (
            <p className="text-[12px] text-amber-800">Sent to WhatsApp for approval (usually minutes to a few hours). Until then, a paid order is confirmed with a normal message only if the customer messaged you within the last 24 hours.</p>
          ) : rejected ? (
            <p className="text-[12px] text-red-700">WhatsApp didn&apos;t approve the message{reason ? `: ${reason}` : ""}. Press Resubmit to try again.</p>
          ) : (
            <p className="text-[12px] text-slate-600">Send every paid order a WhatsApp confirmation, even when the customer hasn&apos;t messaged you in the last 24 hours. Set it up once — WhatsApp approves the message, then it goes out on its own. (Instagram and Facebook orders are confirmed with a normal message; nothing to set up.)</p>
          )}
          {notice && <p className="text-[11px] text-slate-500 mt-1">{notice}</p>}
        </div>
        {!approved && !pending && (
          <button onClick={create} disabled={busy} className="min-h-9 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 shrink-0 max-sm:ml-11">
            {busy ? "Submitting…" : rejected ? "Resubmit" : "Set up"}
          </button>
        )}
      </div>
      {(approved || pending) && <p className="text-[11px] text-ink-500">Manage or preview this template anytime in <b>Templates</b> (name <span className="font-mono">order_confirmation</span>).</p>}
    </section>
  );
}

function OrdersView() {
  const ask = useConfirm();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<"" | OrderStatus>("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Refund is a two-step action on purpose: we don't move money, so it can't be
  // a one-click status flip — it needs the reference from the brand's dashboard.
  const [refundFor, setRefundFor] = useState<string | null>(null);
  const [refundRef, setRefundRef] = useState("");
  const [refundAmt, setRefundAmt] = useState("");   // blank = the full order total

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (filter) qs.set("status", filter);
    if (search.trim()) qs.set("q", search.trim());
    fetch(`/api/admin/orders?${qs}`).then(r => r.json()).then(d => { setOrders(d.orders ?? []); setStats(d.stats ?? null); }).catch(() => setOrders([]));
  }, [filter, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  // Cancelling can't be reversed (the server allows no way back), so ask first.
  async function cancelOrder(o: Order) {
    if (!(await ask({ title: "Cancel this order?", tone: "danger", confirmLabel: "Cancel order", cancelLabel: "Keep order",
      message: "It can't be reopened afterwards. If the customer already paid, refund them in your payment dashboard first.",
      facts: [{ label: "Order", value: `#${o.id.slice(0, 8)} · ${money(o.totalCents, o.currency)}` }] }))) return;
    await move(o, "cancelled");
  }

  async function move(o: Order, to: OrderStatus, ref?: string, amountCents?: number) {
    setBusy(o.id); setMsg(null);
    try {
      const d = await fetch("/api/admin/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, status: to, refundRef: ref, refundAmountCents: amountCents }) }).then(r => r.json());
      if (d.error) setMsg({ ok: false, text: d.error });
      else { setMsg(null); toast(`Order #${o.id.slice(0, 8)} marked ${STATUS_LABEL[to].toLowerCase()}`); setRefundFor(null); setRefundRef(""); setRefundAmt(""); load(); }
    } catch { setMsg({ ok: false, text: "Couldn't reach the server. Please try again." }); }
    finally { setBusy(null); }
  }

  const stat = (label: string, value: string, tone = "text-ink-900") => (
    <div className="bg-white rounded-card border border-line px-3.5 py-2.5">
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-[0.06em]">{label}</p>
      <p className={`text-lg font-extrabold ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <ConfirmTemplateCard />
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {stat("Revenue (paid)", money(stats.revenueCents, orders?.[0]?.currency ?? "INR"), "text-emerald-700")}
          {stat("Orders", String(stats.total))}
          {stat("Awaiting payment", String(stats.counts.pending), stats.counts.pending ? "text-amber-700" : "text-ink-900")}
          {stat("To fulfil", String(stats.counts.paid), stats.counts.paid ? "text-brand-700" : "text-ink-900")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(f => (
            <button key={f.value || "all"} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value} className={`min-h-8 px-2.5 py-1 rounded-full text-[12px] font-bold transition-colors ${filter === f.value ? "bg-brand-700 text-white" : "bg-canvas text-ink-500 hover:text-ink-800"}`}>
              {f.label}{stats && f.value && stats.counts[f.value] ? ` ${stats.counts[f.value]}` : ""}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-ink-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className={`${inp} pl-8 w-48`} placeholder="Search by phone" aria-label="Search orders by phone" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? <Check className="inline w-3.5 h-3.5 mr-1 align-[-2px]" /> : <X className="inline w-3.5 h-3.5 mr-1 align-[-2px]" />}{msg.text}</p>}

      {orders === null && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}
      {orders?.length === 0 && <p className="text-xs text-ink-500 py-6 text-center">No orders {filter ? `with status “${STATUS_LABEL[filter as OrderStatus]}”` : "yet"}. They appear here the moment a customer checks out in chat.</p>}

      <div className="space-y-2">
        {orders?.map(o => {
          const open = expanded === o.id;
          const itemCount = o.items.reduce((s, i) => s + (i.qty || 1), 0);
          return (
            <div key={o.id} className="bg-white rounded-card border border-line overflow-hidden">
              <button onClick={() => setExpanded(open ? null : o.id)} className="w-full flex items-center gap-3 p-3 text-left hover:bg-canvas/60 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Receipt className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{o.phone || "Unknown"} · <span className="font-mono text-[11px] text-ink-400">#{o.id.slice(0, 8)}</span></p>
                  <p className="text-[11px] text-ink-400">{itemCount} item{itemCount === 1 ? "" : "s"} · {new Date(o.createdAt).toLocaleString()}{o.provider ? ` · ${o.provider}` : ""}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-ink-900">{money(o.totalCents, o.currency)}</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-ink-300 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <div className="border-t border-line px-3 py-2.5 space-y-2.5 bg-canvas/40">
                  <div className="space-y-1">
                    {o.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between text-[12px]">
                        <span className="text-ink-700 truncate">{it.qty} × {it.name}</span>
                        <span className="text-ink-500 font-medium tabular-nums">{money(it.priceCents * it.qty, o.currency)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-[12px] font-bold text-ink-900 pt-1 border-t border-line/70">
                      <span>Total</span><span className="tabular-nums">{money(o.totalCents, o.currency)}</span>
                    </div>
                  </div>
                  {(o.paymentRef || o.paidAt) && <p className="text-[11px] text-ink-500">{o.paidAt ? `Paid ${new Date(o.paidAt).toLocaleString()}` : "Not paid yet"}{o.paymentRef ? ` · ref ${o.paymentRef}` : ""}</p>}
                  {o.refundedAt && <p className="text-[11px] text-rose-700">Refunded {new Date(o.refundedAt).toLocaleString()}{o.refundAmountCents != null ? ` · ${money(o.refundAmountCents, o.currency)}` : ""}{o.refundRef ? ` · ref ${o.refundRef}` : ""}</p>}
                  {NEXT_ACTIONS[o.status].length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {NEXT_ACTIONS[o.status].map(a => (
                          <button key={a.to} onClick={() => a.to === "refunded" ? (setRefundFor(refundFor === o.id ? null : o.id), setRefundRef(""), setRefundAmt("")) : a.to === "cancelled" ? void cancelOrder(o) : move(o, a.to)} disabled={busy === o.id}
                            className={`min-h-8 px-2.5 py-1 rounded-control text-[12px] font-bold disabled:opacity-60 ${a.primary ? "bg-brand-700 hover:bg-brand-600 text-white" : "border border-line text-ink-600 hover:bg-white"}`}>
                            {busy === o.id ? "…" : a.label}
                          </button>
                        ))}
                      </div>
                      {refundFor === o.id && (
                        <div className="rounded-control border border-rose-200 bg-rose-50/60 p-2 space-y-1.5">
                          <p className="text-[11px] text-rose-800 leading-snug">Refund {money(o.totalCents, o.currency)} in your {o.provider === "stripe" ? "Stripe" : o.provider === "razorpay" ? "Razorpay" : "payment"} dashboard first — we never move money for you. Then paste the refund reference so this order can be reconciled. Leave the amount blank for a full refund.</p>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input className={`${inp} w-56`} aria-label="Refund reference" placeholder="Refund reference (rfnd_… / re_… / UTR)" value={refundRef} onChange={e => setRefundRef(e.target.value)} />
                            <input className={`${inp} w-32`} inputMode="decimal" aria-label="Refund amount (blank for the full amount)" placeholder={`Amount (${(o.totalCents / 100).toLocaleString()})`} value={refundAmt} onChange={e => setRefundAmt(e.target.value)} />
                            <button onClick={() => move(o, "refunded", refundRef.trim(), refundAmt.trim() ? Math.round(parseFloat(refundAmt) * 100) : undefined)} disabled={busy === o.id || !refundRef.trim()} title={!refundRef.trim() ? "Paste the refund reference first" : undefined}
                              className="min-h-8 px-2.5 py-1 rounded-control text-[12px] font-bold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50">
                              {busy === o.id ? "…" : "Record refund"}
                            </button>
                            <button onClick={() => { setRefundFor(null); setRefundRef(""); }} className="min-h-8 px-2.5 py-1 rounded-control text-[12px] font-bold border border-line text-ink-600 hover:bg-white">Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : <p className="text-[11px] text-ink-500">This order is closed — no further actions.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-ink-500">Refund records a refund you issued in your own Razorpay/Stripe dashboard — we never move money for you, so it asks for the gateway&apos;s refund reference and keeps it against the order. “Mark paid” is for offline/COD reconciliation and doesn&apos;t re-send the customer a confirmation.</p>
    </div>
  );
}

export default CatalogTab;
