"use client";

// Knowledge checks — questions your AI should get right, run against your
// knowledge base on demand (nothing is sent to anyone), plus documents that
// may be out of date. Admins only (kb-tests.ts, kb-review.ts).

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Loader2, Play, Plus, Trash2, XCircle } from "lucide-react";
import { inp } from "../_shared";
import { toast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";

type Test = { id: string; question: string; mustInclude: string[]; mustAvoid: string[]; expectHandoff: boolean; lastRunAt: string | null; lastPassed: boolean | null; lastReply: string | null; lastDetail: string | null };
type Doc = { id: string; title: string; reviewBy: string | null; why: string };

const inMonths = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const list = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

export function KbChecksCard() {
  const [tests, setTests] = useState<Test[] | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [hidden, setHidden] = useState(false);
  const [running, setRunning] = useState(false);
  const [q, setQ] = useState(""); const [inc, setInc] = useState(""); const [avoid, setAvoid] = useState(""); const [handoff, setHandoff] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ask = useConfirm();

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([fetch("/api/admin/kb/tests"), fetch("/api/admin/kb/review")]);
    if (t.status === 403 || t.status === 401) { setHidden(true); return; }
    const tj = await t.json(); const rj = await r.json().catch(() => ({ docs: [] }));
    setTests(tj.tests ?? []); setDocs(rj.docs ?? []);
  }, []);
  useEffect(() => { void load().catch(e => setErr(String(e))); }, [load]);

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/admin/kb/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "That didn't work.");
    return j;
  }
  async function runAll() {
    setRunning(true); setErr(null);
    try { await post({ action: "run" }); await load(); toast("Checks finished — results below"); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setRunning(false);
  }
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try { await post({ action: "add", question: q, mustInclude: list(inc), mustAvoid: list(avoid), expectHandoff: handoff }); setQ(""); setInc(""); setAvoid(""); setHandoff(false); setAdding(false); toast("Check saved"); await load(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); }
  }
  async function remove(t: Test) {
    if (!(await ask({ title: "Delete this check?", tone: "danger", confirmLabel: "Delete check", facts: [{ label: "Question", value: t.question }] }))) return;
    const r = await fetch(`/api/admin/kb/tests?id=${encodeURIComponent(t.id)}`, { method: "DELETE" }).catch(() => null);
    if (!r?.ok) { toast({ text: "Couldn't delete the check. Please try again.", tone: "error" }); return; }
    // Undo re-adds the same check (its past results start fresh).
    toast({ text: "Check deleted", action: { label: "Undo", onClick: () => { void post({ action: "add", question: t.question, mustInclude: t.mustInclude, mustAvoid: t.mustAvoid, expectHandoff: t.expectHandoff }).then(() => { toast("Check restored"); return load(); }).catch(() => toast({ text: "Couldn't restore it.", tone: "error" })); } } });
    await load();
  }
  async function reviewed(id: string, months: number) {
    const r = await fetch("/api/admin/kb/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId: id, reviewBy: inMonths(months) }) }).catch(() => null);
    if (r?.ok) toast(`Marked as still right — we'll ask again in ${months} months`); else toast({ text: "Couldn't save. Please try again.", tone: "error" });
    await load();
  }

  if (hidden || tests === null) return null;
  const ran = tests.filter(t => t.lastPassed !== null);
  const passed = ran.filter(t => t.lastPassed).length;

  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-5" aria-label="Knowledge checks">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink-900">Knowledge checks</p>
          <p className="text-[12px] text-ink-600">Questions your AI should get right. Run them after changing your documents — nothing is sent to customers.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAdding(a => !a)} aria-expanded={adding} className="inline-flex min-h-9 items-center gap-1 rounded-control border border-line px-2.5 py-1.5 text-xs font-bold text-ink-700 hover:bg-canvas"><Plus className="h-3.5 w-3.5" /> Add</button>
          <button onClick={() => void runAll()} disabled={running || !tests.length} title={!tests.length ? "Add a check first" : undefined} className="inline-flex min-h-9 items-center gap-1 rounded-control bg-brand-700 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {running ? "Running…" : "Run all"}
          </button>
        </div>
      </div>
      {ran.length > 0 && <p className={`text-[12px] font-semibold ${passed === ran.length ? "text-emerald-700" : "text-amber-700"}`}>{passed} of {ran.length} passed last time.</p>}
      {err && <p role="alert" className="text-[12px] text-red-600">{err}</p>}

      {adding && (
        <form onSubmit={add} className="space-y-2 rounded-control bg-canvas p-3">
          <input value={q} onChange={e => setQ(e.target.value)} required maxLength={500} placeholder="What a customer would ask, e.g. Do you deliver on Sundays?" className={`${inp} w-full`} aria-label="Question" />
          <input value={inc} onChange={e => setInc(e.target.value)} placeholder="The answer must mention (comma-separated), e.g. Sunday, 10 am" className={`${inp} w-full`} aria-label="Must mention" />
          <input value={avoid} onChange={e => setAvoid(e.target.value)} placeholder="The answer must never say (comma-separated), e.g. free delivery" className={`${inp} w-full`} aria-label="Must not say" />
          <label className="flex items-center gap-2 text-[12px] text-ink-700"><input type="checkbox" checked={handoff} onChange={e => setHandoff(e.target.checked)} /> The AI should hand this to a person instead of answering</label>
          <div className="flex items-center justify-end gap-2">{!q.trim() && <span className="text-[12px] text-ink-500">Type the customer&apos;s question first.</span>}<button disabled={!q.trim()} className="min-h-9 rounded-control bg-brand-700 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Save check</button></div>
        </form>
      )}

      {!tests.length ? <p className="text-[12px] text-ink-500">No checks yet. Add a few real customer questions, or start from a setup pack in Setup Guide.</p> : (
        <ul className="divide-y divide-line rounded-control border border-line">
          {tests.map(t => (
            <li key={t.id} className="flex items-start gap-2 px-3 py-2 text-[12px]">
              {t.lastPassed === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Passed" />
                : t.lastPassed === false ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="Failed" />
                : <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-line" aria-label="Not run yet" />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900">{t.question}</p>
                <p className="text-ink-500">{t.expectHandoff ? "Should go to a person." : [t.mustInclude.length ? `Must mention: ${t.mustInclude.join(", ")}` : "Should be answered", t.mustAvoid.length ? `never: ${t.mustAvoid.join(", ")}` : ""].filter(Boolean).join(" · ")}</p>
                {t.lastDetail && <p className={t.lastPassed ? "text-emerald-700" : "text-red-700"}>{t.lastDetail}</p>}
                {t.lastReply && <details className="text-ink-600"><summary className="cursor-pointer">The answer</summary><p className="whitespace-pre-wrap">{t.lastReply}</p></details>}
              </div>
              <button onClick={() => void remove(t)} aria-label={`Delete “${t.question}”`} className="-my-1 grid h-8 w-8 shrink-0 place-items-center rounded-control text-ink-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}

      {docs.length > 0 && (
        <div className="space-y-1.5 rounded-control border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-amber-900"><CalendarClock className="h-3.5 w-3.5" /> {docs.length} document{docs.length === 1 ? "" : "s"} may be out of date</p>
          {docs.slice(0, 8).map(d => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-amber-950">
              <span><b>{d.title}</b> — {d.why}</span>
              <span className="flex gap-1">
                <button onClick={() => void reviewed(d.id, 3)} className="min-h-8 rounded-control border border-amber-300 bg-white px-2 py-0.5 text-[12px] font-bold">Still right — check again in 3 months</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
