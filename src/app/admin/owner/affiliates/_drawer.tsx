"use client";

// Affiliate drawer — full referred-tenant list and commission ledger for one
// affiliate, plus the one mutation this feature needs: marking pending
// commission rows as paid (payout itself happens off-platform, manually).

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { Drawer, Badge, Panel, Spinner, Table, Th, Td, money, ago, PAYMENT_TONE, type Tone } from "../_ui";

type Detail = {
  affiliate: { id: string; name: string; email: string; phone: string | null; code: string; commissionPct: number; status: string; payoutMethod: string | null; createdAt: string };
  referrals: { tenantId: string; company: string | null; plan: string; paymentStatus: string; createdAt: string }[];
  commissions: { id: string; tenantId: string; company: string | null; plan: string; amountCents: number; commissionCents: number; status: "pending" | "paid" | "void"; paidAt: string | null; createdAt: string }[];
  error?: string;
};

const COMMISSION_TONE: Record<string, Tone> = { pending: "warn", paid: "ok", void: "muted" };

export function AffiliateDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setD(null); setErr(null); setSelected(new Set());
    try {
      const r = await fetch(`/api/owner/affiliates/${id}`);
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || `Couldn't load (HTTP ${r.status})`); return; }
      setD(j);
    } catch { setErr("Couldn't reach the server."); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const pending = (d?.commissions ?? []).filter(c => c.status === "pending");
  const selectedCents = pending.filter(c => selected.has(c.id)).reduce((s, c) => s + c.commissionCents, 0);

  async function markPaid() {
    if (!selected.size) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/owner/affiliates/${id}/payout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionIds: Array.from(selected) }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      await load(); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't mark as paid."); }
    finally { setBusy(false); }
  }

  const a = d?.affiliate;
  return (
    <Drawer open onClose={onClose} title={a?.name ?? "Loading…"} subtitle={a && (
      <span>{a.email} · code <code className="bg-canvas border border-line rounded px-1">{a.code}</code> · {a.commissionPct}% commission</span>
    )}>
      {err && <div className="bg-red-50 border border-red-200 rounded-card px-3 py-2 text-[13px] text-red-700">{err}</div>}
      {!d && !err && <div className="flex justify-center py-10"><Spinner /></div>}

      {d && (
        <>
          <Panel title="Referred tenants" dense>
            {!d.referrals.length ? (
              <p className="text-[13px] text-ink-600 p-4">No tenants referred yet.</p>
            ) : (
              <Table head={<tr><Th>Company</Th><Th>Plan</Th><Th>Status</Th><Th align="right">Since</Th></tr>}>
                {d.referrals.map(t => (
                  <tr key={t.tenantId}>
                    <Td>{t.company || "—"}</Td>
                    <Td>{t.plan}</Td>
                    <Td><Badge tone={PAYMENT_TONE[t.paymentStatus] ?? "muted"}>{t.paymentStatus}</Badge></Td>
                    <Td align="right" nums>{ago(t.createdAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>

          <Panel title="Commission ledger" action={selected.size > 0 && (
            <button onClick={markPaid} disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Mark {selected.size} paid ({money(selectedCents)})
            </button>
          )} dense>
            {!d.commissions.length ? (
              <p className="text-[13px] text-ink-600 p-4">No commission recorded yet — this affiliate&apos;s referred tenants haven&apos;t made a subscription payment.</p>
            ) : (
              <Table head={
                <tr><Th w="28px" /><Th>Company</Th><Th>Plan</Th><Th align="right">Charge</Th><Th align="right">Commission</Th><Th>Status</Th><Th align="right">Date</Th></tr>
              }>
                {d.commissions.map(c => (
                  <tr key={c.id} className={c.status === "pending" ? "hover:bg-canvas cursor-pointer" : ""}
                    onClick={() => {
                      if (c.status !== "pending") return;
                      setSelected(s => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; });
                    }}>
                    <Td>{c.status === "pending" && (
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => {}} className="pointer-events-none" />
                    )}</Td>
                    <Td>{c.company || "—"}</Td>
                    <Td>{c.plan}</Td>
                    <Td align="right" nums>{money(c.amountCents)}</Td>
                    <Td align="right" nums><b>{money(c.commissionCents)}</b></Td>
                    <Td><Badge tone={COMMISSION_TONE[c.status]}>{c.status}</Badge></Td>
                    <Td align="right" nums>{ago(c.paidAt ?? c.createdAt)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </>
      )}
    </Drawer>
  );
}
