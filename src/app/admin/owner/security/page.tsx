"use client";

// Security — how well each business is protected at sign-in, one row per
// account (lib/securitylevels.ts). People are counted, never listed: the owner
// needs to know which accounts to chase, not every business's staff list.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { LEVEL_LABEL, type AccountSecurity, type SecurityLevel } from "@/lib/securitylevels";
import { Badge, EmptyState, MetricTile, Panel, Placeholder, Spinner, Table, Td, Th, ago, type Tone } from "../_ui";

type Row = AccountSecurity & { tenantId: string; name: string; slug: string; status: string };
type Report = { available: boolean; problem: string | null; counts: Record<SecurityLevel, number>; accounts: Row[]; matching: number; checkedAt: string };

const LEVEL_TONE: Record<SecurityLevel, Tone> = { high: "bad", partial: "warn", good: "info", secure: "ok", empty: "muted" };
const of = (n: number, total: number) => (total ? `${n} of ${total}` : "—");

export default function SecurityPage() {
  const [d, setD] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<SecurityLevel | "">("");

  const load = useCallback(async (l: SecurityLevel | "") => {
    setLoading(true);
    try {
      const r = await fetch(`/api/owner/security${l ? `?level=${l}` : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setD(j); setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { load(level); }, [load, level]);

  const pick = (l: SecurityLevel) => setLevel(cur => (cur === l ? "" : l));
  const high = d?.counts.high ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-ink-900">Security</h1>
          <p className="text-[13px] text-ink-600 mt-0.5">
            {loading && !d ? "Reading every account's sign-in protection…"
              : err ? "Couldn't read sign-in security."
              : d && !d.available ? "Not available yet."
              : high ? `${high} account${high === 1 ? "" : "s"} at high risk.`
              : "No account has an admin without an authenticator app or passkey."}
          </p>
        </div>
        <button onClick={() => load(level)} disabled={loading}
          className="shrink-0 px-3 py-1.5 rounded-control border border-line bg-white text-xs font-semibold text-ink-900 hover:border-brand-500 disabled:opacity-60 flex items-center gap-1.5">
          {loading ? <Spinner /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>

      {err && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-control px-3 py-2">{err}. Nothing is shown rather than a guess.</p>}
      {d && !d.available && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-control px-3 py-2">{d.problem}</p>}

      {d?.available && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["high", "partial", "good", "secure"] as SecurityLevel[]).map(l => (
              <MetricTile key={l} label={LEVEL_LABEL[l]} value={d.counts[l]} tone={LEVEL_TONE[l]}
                sub={level === l ? "Showing only these · click to show all" : "Click to show only these"} onClick={() => pick(l)} />
            ))}
          </div>

          <Panel title={level ? LEVEL_LABEL[level] : "Every account, riskiest first"} dense
            action={level ? <button onClick={() => setLevel("")} className="text-xs font-semibold text-brand-700 hover:underline">Show all</button> : undefined}>
            {d.accounts.length === 0
              ? <EmptyState title="No accounts here" body={level ? "No business is at this level right now." : "No businesses are registered yet."} />
              : (
                <>
                  <Table head={<tr>
                    <Th>Account</Th><Th>Level</Th><Th align="right">Authenticator or passkey</Th><Th align="right">Admins covered</Th><Th align="right">Passkeys</Th>
                  </tr>}>
                    {d.accounts.map(a => (
                      <tr key={a.tenantId} className="border-b border-line last:border-0 align-top">
                        <Td>
                          <p className="font-semibold text-ink-900">{a.name}</p>
                          <p className="text-[11px] text-ink-400">/{a.slug} · {a.status}</p>
                        </Td>
                        <Td>
                          <Badge tone={LEVEL_TONE[a.level]}>{LEVEL_LABEL[a.level]}</Badge>
                          <p className="text-[11px] text-ink-600 mt-1 max-w-xs">{a.reason}</p>
                        </Td>
                        <Td align="right" nums>{of(a.protectedPeople, a.people)}</Td>
                        <Td align="right" nums><span className={a.protectedAdmins < a.admins ? "text-red-700 font-semibold" : ""}>{of(a.protectedAdmins, a.admins)}</span></Td>
                        <Td align="right" nums>{of(a.withPasskey, a.people)}</Td>
                      </tr>
                    ))}
                  </Table>
                  {d.matching > d.accounts.length && <p className="px-3 py-2 text-[11px] text-ink-400">Showing the first {d.accounts.length} of {d.matching}. Pick a level above to narrow it.</p>}
                </>
              )}
          </Panel>

          <Panel title="What the levels mean">
            <ul className="text-xs text-ink-600 space-y-1.5">
              <li><Badge tone="bad">{LEVEL_LABEL.high}</Badge> At least one admin has no authenticator app or passkey, so only a password and an emailed code protect the WhatsApp numbers, keys, team and billing. Chase these first.</li>
              <li><Badge tone="warn">{LEVEL_LABEL.partial}</Badge> Every admin is covered, but some members aren&apos;t.</li>
              <li><Badge tone="info">{LEVEL_LABEL.good}</Badge> Everyone has an authenticator app or a passkey; not everyone has a passkey yet.</li>
              <li><Badge tone="ok">{LEVEL_LABEL.secure}</Badge> Everyone has a passkey, which can&apos;t be typed into a fake sign-in page.</li>
            </ul>
            <p className="text-[11px] text-ink-400 mt-3">Checked {ago(d.checkedAt)}.</p>
          </Panel>
        </>
      )}

      {loading && !d && !err && <Placeholder rows={6} />}
    </div>
  );
}
