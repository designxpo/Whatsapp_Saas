"use client";

// Questions the AI couldn't answer (ai-gaps.ts): what customers asked that the
// knowledge base didn't cover, grouped and most-asked first. "Add answer" puts
// the answer in the knowledge base so the AI answers it from then on.

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, Loader2 } from "lucide-react";
import { Drawer } from "@/components/overlay";
import { Notice, useNotice } from "@/components/Notice";
import { PageInfo } from "@/components/PageInfo";
import { SegmentedControl } from "@/components/SegmentedControl";
import { inp } from "../_shared";
import { toast } from "@/components/toast";

interface Group { key: string; question: string; count: number; lastAt: string; platforms: string[]; reasons: string[] }
type Range = "7" | "30" | "90";
const RANGES: { value: Range; label: string }[] = [{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }];
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Facebook", youtube: "YouTube", webchat: "Web chat" };
const ago = (iso: string) => {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return h < 1 ? "just now" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function AiGaps() {
  const [range, setRange] = useState<Range>("30");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [open, setOpen] = useState<Group | null>(null);
  const [answer, setAnswer] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, say] = useNotice();
  const [formNote, sayForm] = useNotice();

  const load = useCallback(async (days: Range) => {
    const r = await fetch(`/api/admin/ai/gaps?days=${days}`).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { say(j.error || "Couldn't load the questions."); setGroups([]); return; }
    setSetup(j.setupNeeded ?? null); setGroups(j.groups ?? []);
  }, [say]);
  useEffect(() => { setGroups(null); load(range); }, [load, range]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    const r = await fetch("/api/admin/ai/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { (body.dismiss ? say : sayForm)(j.error || "That didn't work. Please try again."); return false; }
    return true;
  }
  async function save() {
    if (!open) return;
    setBusy(true); sayForm(null);
    const ok = await post({ key: open.key, answer, tag: tag || null });
    setBusy(false);
    if (!ok) return;
    setGroups(g => (g ?? []).filter(x => x.key !== open.key));
    setOpen(null);
    toast("Added to your knowledge base — the AI answers this from now on");
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="group flex items-center gap-1.5">
        <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5" /> Questions the AI couldn&apos;t answer</p>
        <PageInfo>Real questions from customers on every channel that your knowledge base didn&apos;t cover, so the AI handed off or asked for more detail. Add the answer once and it&apos;s covered from then on. Requests for a person and complaints aren&apos;t listed: handing those off is right.</PageInfo>
      </div>
      {setup ? <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">{setup}</p> : <>
        <SegmentedControl options={RANGES} value={range} onChange={setRange} size="sm" ariaLabel="Show questions from" className="max-w-xs" />
        <Notice notice={note} onClose={() => say(null)} />
        {groups === null ? (
          <div role="status" aria-label="Loading" className="space-y-2">{[0, 1].map(i => <div key={i} className="h-10 rounded-control bg-canvas animate-pulse" />)}</div>
        ) : !groups.length ? (
          <p className="text-[13px] text-slate-500">Nothing open — the AI had an answer for everything customers asked in this range.</p>
        ) : (
          <ul className="divide-y divide-line">
            {groups.map(g => (
              <li key={g.key} className="py-2.5 flex flex-wrap sm:flex-nowrap items-start gap-x-3 gap-y-2">
                {/* The buttons drop under the question on a phone. */}
                <div className="min-w-0 flex-1 max-sm:basis-full">
                  <p className="text-[13px] text-ink-900 break-words">“{g.question}”</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Asked {g.count}× · last {ago(g.lastAt)} · {g.platforms.map(p => CHANNEL[p] ?? p).join(", ")}</p>
                </div>
                <div className="flex items-center gap-1.5 sm:shrink-0">
                  <button onClick={() => { setOpen(g); setAnswer(""); setTag(""); sayForm(null); }} className="min-h-8 px-2.5 py-1 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-[12px] font-bold">Add answer</button>
                  <button onClick={async () => { if (await post({ key: g.key, dismiss: true })) { setGroups(x => (x ?? []).filter(y => y.key !== g.key)); toast("Question dismissed"); } }} className="min-h-8 px-2 py-1 rounded-control text-[12px] font-bold text-slate-600 hover:bg-canvas">Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </>}
      <Drawer open={!!open} onClose={() => !busy && setOpen(null)} title="Add an answer" width="md"
        subtitle="It goes into your knowledge base, so the AI answers this question, and ones like it, from now on."
        footer={<>
          <button onClick={() => setOpen(null)} disabled={busy} className="px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Cancel</button>
          {answer.trim().length < 3 && !busy && <span className="ml-auto text-[12px] text-slate-500">Write the answer first.</span>}
          <button onClick={save} disabled={busy || answer.trim().length < 3} title={answer.trim().length < 3 ? "Write the answer first" : undefined} className="ml-auto px-3.5 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 inline-flex items-center gap-1.5">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add to knowledge base
          </button>
        </>}>
        {open && <GapForm question={open.question} count={open.count} answer={answer} onAnswer={setAnswer} tag={tag} onTag={setTag} notice={<Notice notice={formNote} />} />}
      </Drawer>
    </section>
  );
}

function GapForm({ question, count, answer, onAnswer, tag, onTag, notice }: { question: string; count: number; answer: string; onAnswer: (v: string) => void; tag: string; onTag: (v: string) => void; notice: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Customers asked ({count}×)</p>
        <p className="text-[13px] text-ink-700 bg-canvas rounded-control px-3 py-2 break-words">{question}</p>
      </div>
      <label className="block">
        <span className="text-[11px] font-bold text-slate-400 uppercase">The answer</span>
        <textarea value={answer} onChange={e => onAnswer(e.target.value)} rows={6} maxLength={4000} className={`${inp} w-full mt-1`} placeholder="Write it the way you'd answer a customer." />
      </label>
      <label className="block">
        <span className="text-[11px] font-bold text-slate-400 uppercase">Topic tag (optional)</span>
        <input value={tag} onChange={e => onTag(e.target.value)} className={`${inp} w-full mt-1`} placeholder="e.g. Fees" />
      </label>
      {notice}
    </div>
  );
}
