"use client";

// Catalog (commerce) — extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { Plus, ShoppingBag, Trash2, Workflow, Image as ImageIcon, Receipt, Search, ChevronDown, Loader2 } from "lucide-react";
import { inp, ImageUpload, ImgFallback } from "../_shared";
import { SegmentedControl } from "@/components/SegmentedControl";

// ── Catalog (commerce) ────────────────────────────────────────────────────────
type ProductRow = { id: string; name: string; description: string | null; priceCents: number; currency: string; imageUrl: string | null; retailerId: string | null; metaProductId: string | null; catalogId: string | null; available: boolean; buttonText: string | null; buttonUrl: string | null };
const EMPTY_PRODUCT = { id: undefined as string | undefined, name: "", description: "", price: "", currency: "INR", imageUrl: "", retailerId: "", metaProductId: "", catalogId: "", available: true, buttonText: "", buttonUrl: "" };

// Image that falls back to a placeholder icon when the URL is missing or fails
// to load (e.g. a non-image link was pasted), instead of a broken-image glyph.
// ImgFallback now lives in ./_shared.

function CatalogTab() {
  const [view, setView] = useState<"products" | "orders">("products");
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
        body: JSON.stringify({ id: form.id, name: form.name, description: form.description, priceCents: Math.round((Number(form.price) || 0) * 100), currency: form.currency, imageUrl: form.imageUrl || null, retailerId: form.retailerId || null, metaProductId: form.metaProductId || null, catalogId: form.catalogId || null, available: form.available, buttonText: form.buttonText || null, buttonUrl: form.buttonUrl || null }) });
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><ShoppingBag className="w-5 h-5" /> Catalog</h2>
          <p className="text-sm text-slate-500">Products you can send in chat and sell via in-chat checkout. Abandoned carts auto-enroll into your cart-recovery sequence.</p>
        </div>
        {view === "products" && <div className="flex items-center gap-2 shrink-0">
          <button onClick={makeCheckout} disabled={checkoutBusy} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60"><Workflow className="w-3.5 h-3.5" /> {checkoutBusy ? "Creating…" : "Create checkout flow"}</button>
          <button onClick={() => { setForm({ ...EMPTY_PRODUCT }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add product</button>
        </div>}
      </div>

      <SegmentedControl
        className="max-w-xs"
        ariaLabel="Catalog view"
        value={view}
        onChange={setView}
        options={[
          { value: "products", label: "Products", icon: <ShoppingBag className="w-3.5 h-3.5" /> },
          { value: "orders", label: "Orders", icon: <Receipt className="w-3.5 h-3.5" /> },
        ]}
      />

      {view === "orders" ? <OrdersView /> : <>
      {checkoutId && <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded-control px-3 py-2">Published a multi-screen checkout flow — id <code className="font-mono">{checkoutId}</code>. Use it in a flow&apos;s “WhatsApp form” node; on submit, the order is created from the contact&apos;s open cart.</p>}
      {!form && msg && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">⚠ {msg}{/credential|token|WABA|not configured/i.test(msg) ? " — checkout flows need a connected WhatsApp number with WhatsApp Flows access." : ""}</p>}

      {products.map(p => (
        <div key={p.id} className="bg-white rounded-card border border-line p-3 flex items-center gap-3">
          <ImgFallback url={p.imageUrl ?? ""} imgClass="w-12 h-12 rounded-lg object-cover shrink-0" boxClass="w-12 h-12 rounded-lg bg-canvas flex items-center justify-center shrink-0" icon={<ShoppingBag className="w-5 h-5 text-ink-300" />} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{p.name} {!p.available && <span className="text-[10px] font-bold text-red-500">· hidden</span>}</p>
            <p className="text-[11px] text-ink-400">{p.currency} {(p.priceCents / 100).toFixed(2)}{p.retailerId ? ` · SKU ${p.retailerId}` : ""}</p>
          </div>
          <button onClick={() => setForm({ id: p.id, name: p.name, description: p.description ?? "", price: String(p.priceCents / 100), currency: p.currency, imageUrl: p.imageUrl ?? "", retailerId: p.retailerId ?? "", metaProductId: p.metaProductId ?? "", catalogId: p.catalogId ?? "", available: p.available, buttonText: p.buttonText ?? "", buttonUrl: p.buttonUrl ?? "" })} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(p.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      {!products.length && !form && <p className="text-xs text-ink-400">No products yet.</p>}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4 u-fade-in" onClick={() => setForm(null)}>
        <div onClick={e => e.stopPropagation()} className="bg-white rounded-card border border-line shadow-float p-4 my-8 w-full max-w-3xl flex flex-col xl:flex-row gap-5 u-scale-in">
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
            <input className={inp} maxLength={20} placeholder='Button label (e.g. "Buy now") — max 20' value={form.buttonText} onChange={e => setForm({ ...form, buttonText: e.target.value })} />
            <input className={inp} placeholder="Button link (https://… — required to use a custom button)" value={form.buttonUrl} onChange={e => setForm({ ...form, buttonUrl: e.target.value })} />
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
                <div className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600">{form.buttonText.trim() || "View"}</div>
              </div>
            </div>
            <p className="mt-1.5 text-[10px] text-ink-400 leading-snug">
              {form.buttonUrl.trim()
                ? <>Custom card: image + this button → <span className="font-mono break-all">{form.buttonUrl}</span>. Use the “Custom card” style on a flow’s Product node.</>
                : <>Native catalog card shows WhatsApp’s own “View” button. Add a button link above to send a custom card with your label instead.</>}
            </p>
          </div>
        </div>
        </div>
      )}
      </>}
    </div>
  );
}


// ── Orders (in-chat checkout) ─────────────────────────────────────────────────
type OrderStatus = "pending" | "paid" | "fulfilled" | "cancelled" | "refunded";
type OrderItem = { productId: string; name: string; qty: number; priceCents: number };
type Order = { id: string; phone: string; items: OrderItem[]; totalCents: number; currency: string; status: OrderStatus; paymentRef: string | null; provider: string | null; paidAt: string | null; createdAt: string };
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

function OrdersView() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<"" | OrderStatus>("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (filter) qs.set("status", filter);
    if (search.trim()) qs.set("q", search.trim());
    fetch(`/api/admin/orders?${qs}`).then(r => r.json()).then(d => { setOrders(d.orders ?? []); setStats(d.stats ?? null); }).catch(() => setOrders([]));
  }, [filter, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search]);

  async function move(o: Order, to: OrderStatus) {
    setBusy(o.id); setMsg(null);
    try {
      const d = await fetch("/api/admin/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: o.id, status: to }) }).then(r => r.json());
      if (d.error) setMsg({ ok: false, text: d.error });
      else { setMsg({ ok: true, text: `Order #${o.id.slice(0, 8)} → ${STATUS_LABEL[to]}.` }); load(); }
    } catch { setMsg({ ok: false, text: "Connection error." }); }
    finally { setBusy(null); }
  }

  const stat = (label: string, value: string, tone = "text-ink-900") => (
    <div className="bg-white rounded-card border border-line px-3.5 py-2.5">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.06em]">{label}</p>
      <p className={`text-lg font-extrabold ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {stat("Revenue (paid)", money(stats.revenueCents, orders?.[0]?.currency ?? "INR"), "text-emerald-700")}
          {stat("Orders", String(stats.total))}
          {stat("Awaiting payment", String(stats.counts.pending), stats.counts.pending ? "text-amber-600" : "text-ink-900")}
          {stat("To fulfil", String(stats.counts.paid), stats.counts.paid ? "text-brand-700" : "text-ink-900")}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(f => (
            <button key={f.value || "all"} onClick={() => setFilter(f.value)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${filter === f.value ? "bg-brand-700 text-white" : "bg-canvas text-ink-500 hover:text-ink-800"}`}>
              {f.label}{stats && f.value && stats.counts[f.value] ? ` ${stats.counts[f.value]}` : ""}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-ink-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className={`${inp} pl-8 w-48`} placeholder="Search by phone" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {msg && <p className={`text-[12px] font-medium ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.ok ? "✓ " : "✗ "}{msg.text}</p>}

      {orders === null && <Loader2 className="w-5 h-5 animate-spin text-slate-300" />}
      {orders?.length === 0 && <p className="text-xs text-ink-400 py-6 text-center">No orders {filter ? `with status “${STATUS_LABEL[filter as OrderStatus]}”` : "yet"}. They appear here the moment a customer checks out in chat.</p>}

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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
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
                  {(o.paymentRef || o.paidAt) && <p className="text-[10px] text-ink-400">{o.paidAt ? `Paid ${new Date(o.paidAt).toLocaleString()}` : "Not paid yet"}{o.paymentRef ? ` · ref ${o.paymentRef}` : ""}</p>}
                  {NEXT_ACTIONS[o.status].length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {NEXT_ACTIONS[o.status].map(a => (
                        <button key={a.to} onClick={() => move(o, a.to)} disabled={busy === o.id}
                          className={`px-2.5 py-1 rounded-control text-[11px] font-bold disabled:opacity-60 ${a.primary ? "bg-brand-700 hover:bg-brand-600 text-white" : "border border-line text-ink-600 hover:bg-white"}`}>
                          {busy === o.id ? "…" : a.label}
                        </button>
                      ))}
                    </div>
                  ) : <p className="text-[10px] text-ink-400">This order is closed — no further actions.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-ink-400">Refund marks the order as refunded here for your records — issue the actual refund in your Razorpay/Stripe dashboard. “Mark paid” is for offline/COD reconciliation and doesn&apos;t re-send the customer a confirmation.</p>
    </div>
  );
}

export default CatalogTab;
