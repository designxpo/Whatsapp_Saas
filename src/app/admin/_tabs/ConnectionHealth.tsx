"use client";

// Connection health — at the top of Integrations: every connection that's
// broken, what it means and the fix; failed deliveries with a Retry button;
// and payments that matched no order, to match or dismiss (integration-health.ts).

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { Tab } from "../_shared";
import { toast } from "@/components/toast";

type Problem = { key: string; area: string; severity: "critical" | "warning"; title: string; detail: string; since: string; fix: { label: string; tab: Tab } };
type Payment = { id: string; provider: string; paymentKey: string; amountCents: number | null; reason: "no_order" | "short_payment"; orderId: string | null; createdAt: string; candidates: { id: string; phone: string; totalCents: number; createdAt: string }[] };
type Report = { problems: Problem[]; checked: { area: string; name: string; ok: boolean }[]; unmatchedPayments: Payment[]; deadDeliveries: number };

const rupees = (c: number | null) => (c == null ? "—" : `₹${(c / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

export function ConnectionHealth({ goTo }: { goTo: (t: Tab) => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/integration-health", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Couldn't check your connections. Please try again.");
      setR(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>, key: string, done: string) {
    setBusy(key); setErr(null);
    try {
      const res = await fetch("/api/admin/integration-health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "That didn't work.");
      toast(typeof j.retried === "number" ? `${j.retried} update${j.retried === 1 ? "" : "s"} will be sent again` : done);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  }

  if (!r && !err) return <div className="flex items-center gap-2 text-sm text-ink-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking your connections…</div>;
  const problems = (r?.problems ?? []).filter(p => p.area !== "payments");
  const okCount = (r?.checked ?? []).filter(c => c.ok).length;

  return (
    <section aria-label="Connection health" className="space-y-3 rounded-card border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
          {problems.length ? <ShieldAlert className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          {problems.length ? `${problems.length} connection${problems.length === 1 ? "" : "s"} need${problems.length === 1 ? "s" : ""} attention` : "All connections are working"}
        </p>
        <button onClick={() => void load()} className="inline-flex min-h-8 items-center gap-1 rounded-control px-2 text-[12px] font-semibold text-ink-600 hover:bg-canvas hover:text-ink-900"><RefreshCw className="h-3 w-3" aria-hidden /> Check again</button>
      </div>
      {r && <p className="text-[11px] text-ink-500">{okCount} of {r.checked.length} connected accounts and tools look healthy. Based on what Meta, Google and your tools last reported.</p>}
      {err && <p role="alert" className="rounded-control border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</p>}

      {problems.length > 0 && (
        <ul className="divide-y divide-line rounded-control border border-line">
          {problems.map(p => (
            <li key={p.key} className="flex items-start gap-3 px-3 py-2.5">
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${p.severity === "critical" ? "text-red-600" : "text-amber-600"}`} aria-label={p.severity === "critical" ? "Urgent" : "Warning"} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink-900">{p.title}</p>
                <p className="text-[12px] text-ink-600">{p.detail}</p>
              </div>
              {p.area === "deliveries"
                ? <button onClick={() => void act({ action: "retry_deliveries" }, p.key, "")} disabled={busy === p.key} className="min-h-8 shrink-0 rounded-control bg-brand-700 px-2.5 py-1 text-[12px] font-bold text-white disabled:opacity-50">{busy === p.key ? "Retrying…" : "Retry them"}</button>
                : <button onClick={() => goTo(p.fix.tab)} className="min-h-8 shrink-0 rounded-control border border-line px-2.5 py-1 text-[12px] font-bold text-ink-900 hover:bg-canvas">{p.fix.label}</button>}
            </li>
          ))}
        </ul>
      )}

      {!!r?.unmatchedPayments.length && (
        <div className="space-y-2">
          <p className="text-[12px] font-bold text-ink-900">Payments to check</p>
          {r.unmatchedPayments.map(p => (
            <div key={p.id} className="space-y-1.5 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-950">
              <p><b>{rupees(p.amountCents)}</b> via {p.provider} ({p.paymentKey}) — {p.reason === "short_payment" ? `less than the total of order ${p.orderId?.slice(0, 8)}. Sort it out with the customer, then dismiss.` : "no order matched it."}</p>
              <div className="flex flex-wrap gap-1.5">
                {p.candidates.map(c => (
                  <button key={c.id} disabled={!!busy} onClick={() => void act({ action: "resolve_payment", id: p.id, orderId: c.id }, p.id, "Order marked paid")}
                    className="min-h-8 rounded-control bg-white px-2 py-1 text-[12px] font-bold text-ink-900 border border-line hover:bg-canvas disabled:opacity-50">
                    Mark order {c.id.slice(0, 8)} (+{c.phone}) paid
                  </button>
                ))}
                {p.reason === "no_order" && !p.candidates.length && <span className="text-[11px]">No unpaid order of the same amount from the last 7 days.</span>}
                <button disabled={!!busy} onClick={() => void act({ action: "resolve_payment", id: p.id, dismiss: true }, p.id, "Payment dismissed")} className="min-h-8 px-2 py-1 text-[12px] font-semibold text-amber-900 hover:underline disabled:opacity-50">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
