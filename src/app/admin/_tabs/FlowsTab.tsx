"use client";

// Chatbot Flows tab (+ its sidebar rail) — extracted from admin/page.tsx,
// lazy-loaded. Logic unchanged.
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { inp, type FlowSummary, RailCard, StatRow, flowPlatformBadge } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { EmptyState } from "../_shared";

function FlowsRail({ flows }: { flows: FlowSummary[] }) {
  const active = flows.filter(f => f.active).length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Flow status">
        <StatRow label="Flows switched on" value={active} />
        <StatRow label="Switched off" value={flows.length - active} tone={flows.length - active > 0 ? "warn" : undefined} />
        <StatRow label="Start words" value={flows.reduce((n, f) => n + f.triggerKeywords.length, 0)} />
      </RailCard>
      <RailCard title="How a flow runs">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li><b>Start</b> — a customer message matches a start word (e.g. &quot;hi&quot;, &quot;menu&quot;).</li>
          <li><b>Steps</b> — menus, questions, forms, and messages run in order.</li>
          <li><b>Fallback</b> — anything off-script is answered by the AI, then the menu resumes.</li>
        </ol>
      </RailCard>
      <RailCard title="Blocks you can use">
        <ul className="space-y-1 text-[11px] text-slate-500">
          {([["Buttons / List", "tap-to-choose menus"], ["Ask & save", "store the answer on the contact"], ["WhatsApp form", "multi-field native form"], ["Send template", "approved template mid-flow"], ["Reminder", "nudge when there's no reply"], ["Business hours", "different paths day vs. night"], ["Tell another app", "let your other software know (for developers)"]] as [string, string][]).map(([n, d]) => (
            <li key={n}><b className="text-ink-700">{n}</b> — {d}</li>
          ))}
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Every waiting block can send a <b>no-reply reminder</b> (within 24 hours of the customer&apos;s last message).</li>
          <li>Problems show as a <b>red outline</b> on the block, in plain English.</li>
          <li>Keep one flow per job — a menu flow, a lead flow — easier to test and edit.</li>
        </ul>
      </RailCard>
    </aside>
  );
}
function FlowsTab() {
  const ask = useConfirm();
  const router = useRouter();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => { fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows(d.flows ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const d = await fetch("/api/admin/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }).then(r => r.json()).catch(() => ({}));
      if (d.flow?.id) { toast(`“${name.trim()}” created — opening the builder`); router.push(`/admin/flows/${d.flow.id}`); }
      else toast({ text: d.error || "Couldn't create the flow. Please try again.", tone: "error" });
    } finally { setCreating(false); }
  }

  async function toggle(f: FlowSummary) {
    const r = await fetch(`/api/admin/flows/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !f.active }) }).catch(() => null);
    if (!r?.ok) toast({ text: "Couldn't change the flow. Please try again.", tone: "error" });
    // Switching a flow off is undone by switching it back on (same endpoint).
    else toast(f.active ? { text: `“${f.name}” switched off`, action: { label: "Undo", onClick: () => void toggle({ ...f, active: false }) } } : `“${f.name}” switched on`);
    load();
  }

  async function remove(id: string, flowName: string) {
    if (!(await ask({
      title: "Delete this flow?", tone: "danger", confirmLabel: "Delete flow",
      message: "Anyone part-way through it stops where they are, and any rule or keyword pointing at it stops working.",
    }))) return;
    const r = await fetch(`/api/admin/flows/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) toast(`“${flowName}” deleted`); else toast({ text: "Couldn't delete the flow. Please try again.", tone: "error" });
    load();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Chatbot Flows</h2><PageInfo className="text-sm text-slate-500" lead={<>A step-by-step chat with buttons that starts when a customer sends a word like &quot;hi&quot; or &quot;menu&quot; — built by dragging blocks, no code.</>}>Anything a flow can&apos;t handle goes to the AI assistant, so the customer never hits a dead end.</PageInfo>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">New flow</p>
        <div className="flex flex-wrap sm:flex-nowrap gap-2">
          <input className={inp + " flex-1 min-w-0 max-sm:basis-full"} aria-label="New flow name" placeholder="Flow name (e.g. Enquiry menu)" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") create(); }} />
          <button onClick={create} disabled={creating || !name.trim()} title={!name.trim() ? "Type a name for the flow first" : undefined} className="min-h-10 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create & open builder"}
          </button>
        </div>
        {!name.trim() && <p className="text-[12px] text-slate-500">Type a name to create a flow.</p>}
      </section>

      <div className="space-y-2">
        {flows.map(f => (
          <div key={f.id} className="bg-white rounded-card border border-line p-4 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
            <button onClick={() => router.push(`/admin/flows/${f.id}`)} className="text-left min-w-0 flex-1 max-sm:basis-full">
              <p className="text-sm font-bold text-brand-dark flex flex-wrap items-center gap-1.5 break-words">{f.name}
                {(() => { const b = flowPlatformBadge(f.platform); return <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>; })()}
              </p>
              <p className="text-[12px] text-slate-500 truncate">
                {f.triggerKeywords.length ? `Starts when someone sends: ${f.triggerKeywords.join(", ")}` : "No start words yet"} · {(f.graph?.nodes?.length ?? 1) - 1} steps
              </p>
            </button>
            {/* Phone: on/off + actions get their own line under the name. Laptop: `contents` = the same single row. */}
            <div className="flex items-center justify-end gap-3 w-full sm:contents">
            <button onClick={() => toggle(f)} role="switch" aria-checked={f.active} aria-label={`${f.name}: ${f.active ? "on" : "off"}`} className={`min-h-8 px-3 py-1 rounded-full text-[12px] font-bold shrink-0 ${f.active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{f.active ? "● On" : "○ Off"}</button>
            <button onClick={() => router.push(`/admin/flows/${f.id}`)} className="min-h-8 px-3 py-1 rounded-lg border border-line text-[12px] font-bold text-slate-600 shrink-0">Edit</button>
            <button onClick={() => remove(f.id, f.name)} aria-label={`Delete ${f.name}`} className="grid place-items-center w-9 h-9 rounded-lg text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
        {flows.length === 0 && (
          <EmptyState mood="idle" title="No flows yet"
            body={<>Type a name above and press <b>Create &amp; open builder</b>. A simple first flow: someone sends &quot;hi&quot; → welcome buttons → product info, or talk to your team.</>} />
        )}
      </div>
    </div>
    <FlowsRail flows={flows} />
    </div>
  );
}


export default FlowsTab;
