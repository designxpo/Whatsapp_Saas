"use client";

// Chatbot Flows tab (+ its sidebar rail) — extracted from admin/page.tsx,
// lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { inp, type FlowSummary, RailCard, StatRow } from "../_shared";

function FlowsRail({ flows }: { flows: FlowSummary[] }) {
  const active = flows.filter(f => f.active).length;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Flow status">
        <StatRow label="Active flows" value={active} />
        <StatRow label="Inactive" value={flows.length - active} tone={flows.length - active > 0 ? "warn" : undefined} />
        <StatRow label="Trigger keywords" value={flows.reduce((n, f) => n + f.triggerKeywords.length, 0)} />
      </RailCard>
      <RailCard title="How a flow runs">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li><b>Trigger</b> — a customer message matches a keyword (e.g. &quot;hi&quot;, &quot;menu&quot;).</li>
          <li><b>Steps</b> — menus, questions, forms, and messages run in order.</li>
          <li><b>Fallback</b> — anything off-script is answered by the AI, then the menu resumes.</li>
        </ol>
      </RailCard>
      <RailCard title="Blocks you can use">
        <ul className="space-y-1 text-[11px] text-slate-500">
          {([["Buttons / List", "tap-to-choose menus"], ["Ask & save", "store the answer on the contact"], ["WhatsApp form", "multi-field native form"], ["Send template", "approved template mid-flow"], ["Reminder", "nudge when there's no reply"], ["Business hours", "different paths day vs. night"], ["Webhook", "notify your other systems"]] as [string, string][]).map(([n, d]) => (
            <li key={n}><b className="text-ink-700">{n}</b> — {d}</li>
          ))}
        </ul>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Every waiting block can send a <b>no-reply reminder</b> (inside WhatsApp&apos;s 24h window).</li>
          <li>Problems show as a <b>red outline</b> on the block, in plain English.</li>
          <li>Keep one flow per job — a menu flow, a lead flow — easier to test and edit.</li>
        </ul>
      </RailCard>
    </aside>
  );
}
function FlowsTab() {
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
      const d = await fetch("/api/admin/flows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) }).then(r => r.json());
      if (d.flow?.id) router.push(`/admin/flows/${d.flow.id}`);
    } finally { setCreating(false); }
  }

  async function toggle(f: FlowSummary) {
    await fetch(`/api/admin/flows/${f.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !f.active }) });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this flow?")) return;
    await fetch(`/api/admin/flows/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Chatbot Flows</h2>
        <p className="text-sm text-slate-500">Drag-and-drop conversation flows triggered by keywords (e.g. &quot;hi&quot;, &quot;menu&quot;). Anything a flow can&apos;t handle falls through to the AI assistant — never a dead-end.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">New flow</p>
        <div className="flex gap-2">
          <input className={inp + " flex-1"} placeholder="Flow name (e.g. Course enquiry menu)" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") create(); }} />
          <button onClick={create} disabled={creating || !name.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create & open builder"}
          </button>
        </div>
      </section>

      <div className="space-y-2">
        {flows.map(f => (
          <div key={f.id} className="bg-white rounded-card border border-line p-4 flex items-center justify-between gap-3">
            <button onClick={() => router.push(`/admin/flows/${f.id}`)} className="text-left min-w-0 flex-1">
              <p className="text-sm font-bold text-brand-dark flex items-center gap-1.5">{f.name}
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${f.platform === "instagram" ? "bg-pink-50 text-pink-600" : f.platform === "messenger" ? "bg-blue-50 text-blue-600" : f.platform === "webchat" ? "bg-sky-50 text-sky-700" : f.platform === "all" ? "bg-amber-50 text-amber-700" : f.platform === "both" ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-700"}`}>{f.platform === "instagram" ? "Instagram" : f.platform === "messenger" ? "Facebook" : f.platform === "webchat" ? "Website" : f.platform === "all" ? "All" : f.platform === "both" ? "WA + IG" : "WhatsApp"}</span>
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {f.triggerKeywords.length ? `triggers: ${f.triggerKeywords.join(", ")}` : "no trigger keywords yet"} · {(f.graph?.nodes?.length ?? 1) - 1} steps
              </p>
            </button>
            <button onClick={() => toggle(f)} className={`px-3 py-1 rounded-full text-[11px] font-bold shrink-0 ${f.active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{f.active ? "● Active" : "○ Inactive"}</button>
            <button onClick={() => router.push(`/admin/flows/${f.id}`)} className="px-3 py-1 rounded-lg border border-line text-[11px] font-bold text-slate-600 shrink-0">Edit</button>
            <button onClick={() => remove(f.id)} className="p-1.5 text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {flows.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No flows yet — create one above. Example: trigger &quot;hi&quot; → welcome buttons → course info / talk to an agent.</p>}
      </div>
    </div>
    <FlowsRail flows={flows} />
    </div>
  );
}


export default FlowsTab;
