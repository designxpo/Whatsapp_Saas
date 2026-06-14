"use client";

// Internal-only setup & diagnostics. Not linked from the main nav — reach it at
// /admin/setup. Shows the configuration checklist plus guided tools: which
// migrations are unapplied (+ copy SQL), which env vars are missing, and live
// Meta connectivity. The portal can't run SQL or set Vercel env itself, so it
// hands you the exact SQL to copy and deep links to the right screens.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleCheck, CircleDashed, Loader2, Copy, Check, ExternalLink, RefreshCw } from "lucide-react";

interface SetupStep { ok: boolean; label: string; detail: string }
interface SystemStatus { steps: Record<string, SetupStep>; completed: number; totalRequired: number; live: boolean }
interface SetupDiag {
  migrations: { id: string; title: string; file: string; applied: boolean; sql: string }[];
  env: { key: string; label: string; ok: boolean; fix: string }[];
  meta: { account: { ok: boolean; detail: string }; page: { ok: boolean; detail: string } };
  links: { supabaseSql: string; vercelEnv: string };
}

const STEP_ORDER = ["database", "ai", "knowledge", "whatsapp", "webhook", "crm"];

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {ok ? <CircleCheck className="w-4 h-4 text-brand-500 shrink-0 mt-0.5" /> : <CircleDashed className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [s, setS] = useState<SystemStatus | null>(null);
  const [d, setD] = useState<SetupDiag | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const loadDiag = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/system/setup").then(r => r.json()).then(setD).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    fetch("/api/admin/system/status").then(r => r.json()).then(setS).catch(() => {});
    loadDiag();
  }, [loadDiag]);

  const copy = (file: string, sql: string) => { navigator.clipboard?.writeText(sql); setCopied(file); setTimeout(() => setCopied(c => c === file ? null : c), 2000); };
  const pendingMig = d?.migrations.filter(m => !m.applied) ?? [];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="px-6 h-14 bg-white border-b border-line flex items-center gap-3">
        <button onClick={() => router.push("/admin")} className="p-1.5 rounded-lg text-slate-400 hover:bg-canvas hover:text-ink-900"><ArrowLeft className="w-4 h-4" /></button>
        <h1 className="font-bold text-sm text-ink-900">System setup &amp; diagnostics</h1>
        <span className="text-[11px] text-slate-400">internal</span>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-5">
        {/* Checklist */}
        <section className="bg-white border border-line rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-bold text-sm text-ink-900">Setup checklist</h2>
            {s && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${s.live ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-700"}`}>
                {s.live ? "All systems live" : `${s.completed}/${s.totalRequired} complete`}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-3">Each item turns green when configured. Full details in SETUP.md.</p>
          {!s ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : (
            <ul className="space-y-2">
              {STEP_ORDER.map(k => s.steps[k] && (
                <li key={k}>
                  <Row ok={s.steps[k].ok}>
                    <p className="text-sm font-semibold text-ink-900">{s.steps[k].label}</p>
                    <p className="text-xs text-slate-500">{s.steps[k].detail}</p>
                  </Row>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Guided tools */}
        <section className="bg-white border border-line rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm text-ink-900">Migrations, environment &amp; connectivity</h2>
            <button onClick={loadDiag} className="text-[11px] font-bold text-slate-500 inline-flex items-center gap-1 hover:text-ink-900"><RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Re-check</button>
          </div>

          {loading && !d ? <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>
          : !d ? <p className="text-xs text-amber-600">Couldn&apos;t load setup diagnostics.</p>
          : (
            <div className="space-y-5">
              {/* Migrations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-ink-900">Database migrations {pendingMig.length > 0 && <span className="text-amber-600">· {pendingMig.length} to run</span>}</p>
                  <a href={d.links.supabaseSql} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-700 inline-flex items-center gap-1 hover:underline">Open Supabase SQL editor <ExternalLink className="w-3 h-3" /></a>
                </div>
                <p className="text-[11px] text-slate-400">The portal can&apos;t run SQL itself. Copy each pending migration, paste it in the SQL editor, and run — then re-check.</p>
                <div className="space-y-1.5">
                  {d.migrations.map(m => (
                    <Row key={m.file} ok={m.applied}>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-ink-800 flex-1">{m.id} · {m.title}</p>
                        {m.applied
                          ? <span className="text-[10px] font-bold text-brand-600">Applied</span>
                          : <button onClick={() => copy(m.file, m.sql)} disabled={!m.sql} className="text-[11px] font-bold text-brand-700 inline-flex items-center gap-1 disabled:opacity-40">
                              {copied === m.file ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy SQL</>}
                            </button>}
                      </div>
                    </Row>
                  ))}
                </div>
              </div>

              {/* Env vars */}
              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-ink-900">Environment variables</p>
                  <a href={d.links.vercelEnv} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-700 inline-flex items-center gap-1 hover:underline">Open Vercel <ExternalLink className="w-3 h-3" /></a>
                </div>
                <p className="text-[11px] text-slate-400">Set in Vercel → Environment Variables, then redeploy. A running app reads these at boot and can&apos;t change them itself.</p>
                <div className="space-y-1.5">
                  {d.env.map(e => (
                    <Row key={e.key} ok={e.ok}>
                      <p className="text-xs font-semibold text-ink-800">{e.label} <span className="font-mono font-normal text-[10px] text-slate-400">{e.key}</span></p>
                      <p className="text-[11px] text-slate-500">{e.fix}</p>
                    </Row>
                  ))}
                </div>
              </div>

              {/* Connectivity */}
              <div className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-bold text-ink-900">Live Meta connectivity</p>
                <div className="space-y-1.5">
                  <Row ok={d.meta.account.ok}><p className="text-xs text-ink-800">Ad account</p><p className="text-[11px] text-slate-500">{d.meta.account.detail}</p></Row>
                  <Row ok={d.meta.page.ok}><p className="text-xs text-ink-800">Facebook Page</p><p className="text-[11px] text-slate-500">{d.meta.page.detail}</p></Row>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
