"use client";

// AI Hub tab (agents, function-calling, prompts, key) + its sidebar rail —
// extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Check, Loader2, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { type Tab, inp, type AiAgentT, type AiParamT, type AiFunctionT, type AiPromptT, RailCard, StatRow } from "../_shared";

function AiHubRail({ goTo, agents, fns, prompts, autoRoute, tone }: { goTo: (t: Tab) => void; agents: AiAgentT[]; fns: AiFunctionT[]; prompts: AiPromptT[]; autoRoute: boolean | null; tone: boolean | null }) {
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Hub status">
        <StatRow label="AI agents" value={agents.length} />
        <StatRow label="Default agent" value={agents.find(a => a.active)?.name ?? "—"} />
        <StatRow label="Auto-routing" value={autoRoute === null ? "…" : autoRoute ? "ON" : "OFF"} tone={autoRoute === false ? "warn" : undefined} />
        <StatRow label="Persona tone" value={tone === null ? "…" : tone ? "ON" : "OFF"} />
        <StatRow label="Lead-capture functions" value={fns.length} />
        <StatRow label="Writing tools" value={prompts.length} />
      </RailCard>
      <RailCard title="How it fits together">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li>A customer asks something on WhatsApp.</li>
          <li><b>Auto-routing</b> picks the best agent for that topic.</li>
          <li>The agent answers using your <b>AI Knowledge Base</b>.</li>
          <li>Mid-chat, <b>lead capture</b> quietly saves details — name, what they're interested in, city…</li>
        </ol>
        <button onClick={() => goTo("assistant")} className="text-[11px] font-bold text-brand-700 flex items-center gap-1">Open AI Knowledge Base <ArrowRight className="w-3 h-3" /></button>
      </RailCard>
      <RailCard title="Starter setup">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Two agents: <b>Sales</b> (pricing, offers, how to buy) and <b>Support</b> (existing customers).</li>
          <li>One <b>capture_lead</b> function saving name, what they're interested in, and city.</li>
          <li>Writing tools: Friendly tone, Translate to Hindi, Shorten.</li>
        </ul>
      </RailCard>
    </aside>
  );
}
// ── AI Hub: agent personas, function-calling lead capture, assist prompts ─────
// AiAgentT/AiParamT/AiFunctionT/AiPromptT now live in ./_shared (used by AiHubRail above + the AI Hub tab).

const EMPTY_AGENT: AiAgentT = { name: "", description: "", persona: "", constraintsText: "", productInfo: "", model: null, active: false, routingKeywords: "" };
const EMPTY_FN: AiFunctionT = { name: "", description: "", parameters: [{ name: "", description: "", required: true, saveToAttribute: "" }], webhookUrl: null, escalate: false, active: true };

// Per-tenant AI provider + key. The key is validated with a live test call,
// then stored encrypted server-side. No key = auto-replies are off for this
// workspace. Embeddings always use the platform's shared Gemini key.
type AiKeyStatusT = { configured: boolean; provider: string; model: string; keyHint: string | null };
const AI_MODEL_HINT: Record<string, string> = { gemini: "gemini-2.5-flash", openai: "gpt-4o-mini", anthropic: "claude-opus-4-8" };
const AI_KEY_HELP: Record<string, string> = {
  gemini: "Google AI Studio key — aistudio.google.com/apikey",
  openai: "OpenAI key — platform.openai.com/api-keys",
  anthropic: "Anthropic key — console.anthropic.com",
};
function AiKeyCard() {
  const [status, setStatus] = useState<AiKeyStatusT | null>(null);
  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/ai/key").then(r => r.json()).then((d: AiKeyStatusT) => { setStatus(d); if (d.provider) setProvider(d.provider); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!apiKey.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/ai/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey: apiKey.trim(), model: model.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) setMsg({ ok: false, text: d.error ?? "Failed to save key" });
      else { setStatus(d); setApiKey(""); setMsg({ ok: true, text: "Key validated and saved." }); }
    } catch { setMsg({ ok: false, text: "Network error" }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("Remove this AI key? AI auto-replies will stop for this workspace until you add one.")) return;
    setBusy(true); setMsg(null);
    try { const d = await fetch("/api/admin/ai/key", { method: "DELETE" }).then(r => r.json()); setStatus(d); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-brand-dark flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> AI provider & key</h3>
        {status && (status.configured
          ? <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Connected · {status.provider} · {status.keyHint}</span>
          : <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Not configured — AI replies off</span>)}
      </div>
      <p className="text-[12px] text-slate-500">Bring your own AI key — usage is billed to your provider account. Used for chat replies only; document search (embeddings) runs on the platform.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <select value={provider} onChange={e => setProvider(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm">
          <option value="gemini">Google Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder={`Model (default ${AI_MODEL_HINT[provider]})`} className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
      </div>
      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "Enter a new key to replace the saved one" : "Paste your API key"} className="w-full rounded-control border border-line px-3 py-2 text-sm font-mono" />
      <p className="text-[11px] text-slate-400">{AI_KEY_HELP[provider]}</p>
      {msg && <p className={`text-[12px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || !apiKey.trim()} className="bg-brand-700 text-white rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Validate & save
        </button>
        {status?.configured && <button onClick={remove} disabled={busy} className="text-red-600 border border-red-200 rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50">Remove</button>}
      </div>
    </section>
  );
}

function AiHubTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [sub, setSub] = useState<"agents" | "functions" | "prompts">("agents");
  const [agentFormOpen, setAgentFormOpen] = useState(false);
  const [agents, setAgents] = useState<AiAgentT[]>([]);
  const [agent, setAgent] = useState<AiAgentT>(EMPTY_AGENT);
  const [fns, setFns] = useState<AiFunctionT[]>([]);
  const [fn, setFn] = useState<AiFunctionT | null>(null);
  const [prompts, setPrompts] = useState<AiPromptT[]>([]);
  const [pName, setPName] = useState(""); const [pText, setPText] = useState("");
  const [autoRoute, setAutoRoute] = useState<boolean | null>(null);
  const [tone, setTone] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents(d.agents ?? [])).catch(() => {});
    fetch("/api/admin/ai/functions").then(r => r.json()).then(d => setFns(d.functions ?? [])).catch(() => {});
    fetch("/api/admin/ai/prompts").then(r => r.json()).then(d => setPrompts(d.prompts ?? [])).catch(() => {});
    fetch("/api/admin/ai/routing").then(r => r.json()).then(d => { setAutoRoute(d.auto === true); setTone(d.tone !== false); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function generatePersona() {
    if (!agent.description.trim()) return;
    setBusy("gen");
    try {
      const d = await fetch("/api/admin/ai/agents/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: agent.name, description: agent.description }) }).then(r => r.json());
      if (d.persona) setAgent(a => ({ ...a, persona: d.persona }));
      else alert(d.error ?? "Generation failed");
    } finally { setBusy(""); }
  }
  async function saveAgent() {
    if (!agent.name.trim()) return;
    setBusy("agent");
    try { await fetch("/api/admin/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agent) }); setAgent(EMPTY_AGENT); setAgentFormOpen(false); load(); }
    finally { setBusy(""); }
  }
  async function saveFn() {
    if (!fn?.name.trim()) return;
    setBusy("fn");
    try { await fetch("/api/admin/ai/functions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fn) }); setFn(null); load(); }
    finally { setBusy(""); }
  }
  async function addPrompt() {
    if (!pName.trim() || !pText.trim()) return;
    await fetch("/api/admin/ai/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: pName, prompt: pText }) });
    setPName(""); setPText(""); load();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Sparkles className="w-5 h-5" /> AI Hub</h2>
        <p className="text-sm text-slate-500">Three simple things live here: <b>AI agents</b> — who the AI is when it replies, <b>Lead capture</b> — the details it saves mid-chat, and <b>Writing tools</b> — one-tap rewrites for your team in Live Chat.</p>
      </div>

      <AiKeyCard />

      <div className="flex gap-2">
        {([["agents", "AI agents"], ["functions", "Lead capture"], ["prompts", "Writing tools"]] as ["agents" | "functions" | "prompts", string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} className={`px-4 py-2 rounded-lg text-sm font-bold ${sub === k ? "bg-brand-700 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>

      {sub === "agents" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        An <b>agent</b> is a personality + job for the AI — e.g. <i>Maya, the sales assistant</i>. Create one per role; with auto-routing on, the best-matching agent answers each customer automatically.
      </div>

      <section className="bg-white rounded-card border border-line p-5">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={async () => { const d = await fetch("/api/admin/ai/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: !autoRoute }) }).then(r => r.json()); setAutoRoute(d.auto === true); }}
            className={`text-left rounded-control border p-3 transition-colors ${autoRoute ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
            <p className="text-xs font-bold text-ink-900">⚡ Auto-routing <span className={autoRoute ? "text-brand-700" : "text-slate-400"}>{autoRoute === null ? "…" : autoRoute ? "ON" : "OFF"}</span></p>
            <p className="text-[11px] text-slate-500 mt-0.5">Switch to the right agent automatically based on what the customer asks.</p>
          </button>
          <button onClick={async () => { const d = await fetch("/api/admin/ai/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tone: !tone }) }).then(r => r.json()); setTone(d.tone !== false); }}
            className={`text-left rounded-control border p-3 transition-colors ${tone ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
            <p className="text-xs font-bold text-ink-900">🎭 Persona tone <span className={tone ? "text-brand-700" : "text-slate-400"}>{tone === null ? "…" : tone ? "ON" : "OFF"}</span></p>
            <p className="text-[11px] text-slate-500 mt-0.5">Instant FAQ &amp; cached answers are rewritten in the agent&apos;s voice before sending.</p>
          </button>
        </div>
      </section>

      {/* Agents */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Your agents</p>
          <button onClick={() => { setAgent(EMPTY_AGENT); setAgentFormOpen(true); }} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold"><Plus className="w-3.5 h-3.5 inline" /> New agent</button>
        </div>
        {agents.map(a => (
          <div key={a.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-dark">{a.name} {a.active && <span className="text-[10px] font-bold text-brand-600">● ACTIVE</span>}</p>
              <p className="text-[11px] text-slate-400 truncate">{a.description || "—"}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {!a.active && <button onClick={async () => { await fetch("/api/admin/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, active: true }) }); load(); }} className="text-[11px] font-bold text-brand-600 border border-brand-100 rounded-lg px-2 py-1">Activate</button>}
              <button onClick={() => { setAgent(a); setAgentFormOpen(true); }} className="text-[11px] font-bold text-slate-600 border border-line rounded-lg px-2 py-1">Edit</button>
              <button onClick={async () => { await fetch("/api/admin/ai/agents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) }); load(); }} className="p-1 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {agents.length === 0 && !agentFormOpen && <p className="text-center text-slate-400 text-sm py-4">No agents yet — hit <b>New agent</b>, describe the job in one line, and ✨ Generate writes the personality for you.</p>}
        {agentFormOpen && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">1 · Who is this agent?</p>
            <input className={`${inp} w-full`} placeholder="Name — e.g. Maya" value={agent.name} onChange={e => setAgent({ ...agent, name: e.target.value })} />
            <div className="flex gap-2">
              <textarea className={`${inp} flex-1 resize-none`} rows={2} placeholder="Their job in one line — e.g. Sales assistant who helps visitors pick the right product for their budget" value={agent.description} onChange={e => setAgent({ ...agent, description: e.target.value })} />
              <button onClick={generatePersona} disabled={busy === "gen" || !agent.description.trim()} className="self-end px-3 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold disabled:opacity-50 shrink-0">
                {busy === "gen" ? <Loader2 className="w-4 h-4 animate-spin" /> : "✨ Generate"}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">2 · When should this agent take over? <span className="font-normal text-slate-400">(used by auto-routing)</span></p>
            <input className={`${inp} w-full`} placeholder="Topic keywords — e.g. pricing, availability, booking, offers" value={agent.routingKeywords ?? ""} onChange={e => setAgent({ ...agent, routingKeywords: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">3 · Personality &amp; instructions <span className="font-normal text-slate-400">(✨ Generate fills this — edit freely)</span></p>
            <textarea className={`${inp} w-full resize-none font-mono text-xs`} rows={7} placeholder="Persona & role prompt…" value={agent.persona} onChange={e => setAgent({ ...agent, persona: e.target.value })} />
          </div>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — hard rules, extra product info, model override</summary>
            <div className="pt-2 space-y-2">
              <textarea className={`${inp} w-full resize-none`} rows={3} placeholder={"Hard rules — e.g.\nNever discuss pricing unless asked. Keep replies under 30 words."} value={agent.constraintsText} onChange={e => setAgent({ ...agent, constraintsText: e.target.value })} />
              <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="Product & service info this agent always knows (on top of the knowledge base)" value={agent.productInfo} onChange={e => setAgent({ ...agent, productInfo: e.target.value })} />
              <input className={`${inp} w-full`} placeholder="Model override (optional — leave blank for the default)" value={agent.model ?? ""} onChange={e => setAgent({ ...agent, model: e.target.value || null })} />
            </div>
          </details>
          <div className="flex items-center gap-3">
            <button onClick={saveAgent} disabled={busy === "agent" || !agent.name.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">{agent.id ? "Update agent" : "Create agent"}</button>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={agent.active} onChange={e => setAgent({ ...agent, active: e.target.checked })} /> make this the default agent</label>
            <button onClick={() => { setAgent(EMPTY_AGENT); setAgentFormOpen(false); }} className="text-xs text-slate-400 font-bold">cancel</button>
          </div>
        </div>
        )}
      </section>
      </>}

      {sub === "functions" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        Lead capture teaches the AI to <b>save details during a normal chat</b> — no form needed. Example: <b>capture_lead</b> stores name, what they're interested in, and city as contact attributes the moment the customer mentions them.
      </div>

      {/* Functions */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">AI Functions — structured data capture</p>
            <p className="text-[11px] text-slate-400 mt-0.5">The AI calls these mid-chat once it has the details: saves to contact attributes, optionally fires a webhook, optionally hands off.</p>
          </div>
          <button onClick={() => setFn(EMPTY_FN)} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold shrink-0"><Plus className="w-3.5 h-3.5 inline" /> Function</button>
        </div>
        {fns.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-brand-dark font-mono">{f.name} {!f.active && <span className="text-[10px] text-slate-400">(off)</span>} {f.escalate && <span className="text-[10px] font-bold text-red-500">→ handoff</span>}</p>
              <p className="text-[11px] text-slate-400 truncate">{f.parameters.map(pm => pm.name).join(", ")}{f.webhookUrl ? " · webhook" : ""}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setFn(f)} className="text-[11px] font-bold text-slate-600 border border-line rounded-lg px-2 py-1">Edit</button>
              <button onClick={async () => { await fetch("/api/admin/ai/functions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }); load(); }} className="p-1 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {fn && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="function_name (e.g. capture_lead)" value={fn.name} onChange={e => setFn({ ...fn, name: e.target.value })} />
              <input className={inp} placeholder="Webhook URL (optional)" value={fn.webhookUrl ?? ""} onChange={e => setFn({ ...fn, webhookUrl: e.target.value || null })} />
            </div>
            <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="When should the AI call this? (e.g. once the visitor has shared name, phone and their problem and confirmed the summary)" value={fn.description} onChange={e => setFn({ ...fn, description: e.target.value })} />
            <p className="text-[10px] font-bold text-slate-400 uppercase">Parameters</p>
            {fn.parameters.map((pm, i) => (
              <div key={i} className="grid grid-cols-[1fr_1.4fr_1fr_auto_auto] gap-2 items-center">
                <input className={inp} placeholder="param name" value={pm.name} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                <input className={inp} placeholder="description for the AI" value={pm.description} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} />
                <input className={inp} placeholder="save to attribute" value={pm.saveToAttribute} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, saveToAttribute: e.target.value } : x) })} />
                <label className="text-[10px] font-bold text-slate-500 flex items-center gap-1"><input type="checkbox" checked={pm.required} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} />req</label>
                <button onClick={() => setFn({ ...fn, parameters: fn.parameters.filter((_, j) => j !== i) })} className="text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setFn({ ...fn, parameters: [...fn.parameters, { name: "", description: "", required: false, saveToAttribute: "" }] })} className="text-[11px] font-bold text-brand-dark">+ parameter</button>
            <div className="flex items-center gap-3">
              <button onClick={saveFn} disabled={busy === "fn" || !fn.name.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">{fn.id ? "Update function" : "Create function"}</button>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={fn.escalate} onChange={e => setFn({ ...fn, escalate: e.target.checked })} /> hand off to human after call</label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={fn.active} onChange={e => setFn({ ...fn, active: e.target.checked })} /> active</label>
              <button onClick={() => setFn(null)} className="text-xs text-slate-400 font-bold">cancel</button>
            </div>
          </div>
        )}
      </section>

      </>}

      {sub === "prompts" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        Writing tools are <b>one-tap rewrites</b> your team uses on drafts in the Live Chat composer (the ✨ button) — change tone, translate, shorten. Click a sample below to add it.
      </div>

      {/* Prompts */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Your writing tools</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Available to everyone in the Live Chat composer (✨ button).</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[["Friendly tone", "Rewrite the text in a warm, approachable, friendly tone, as if speaking to a friend."], ["Formal tone", "Rewrite the text in a polite, professional, formal tone."], ["Fix spelling & grammar", "Fix all spelling and grammar mistakes in the text without changing its meaning."], ["Translate to Hindi", "Translate the text to conversational Hindi written in Devanagari."], ["Translate to English", "Translate the text to natural English."], ["Shorten", "Rewrite the text to be as short as possible while keeping all key information."]].map(([n, p]) => (
            <button key={n} onClick={() => { setPName(n); setPText(p); }} className="px-2.5 py-1 rounded-full border border-line text-[11px] font-bold text-slate-600 hover:border-brand-dark">{n}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={`${inp} w-44`} placeholder="Name" value={pName} onChange={e => setPName(e.target.value)} />
          <input className={`${inp} flex-1`} placeholder="Instruction (e.g. Rewrite the text in a friendly tone…)" value={pText} onChange={e => setPText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addPrompt(); }} />
          <button onClick={addPrompt} disabled={!pName.trim() || !pText.trim()} className="px-3 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="divide-y divide-slate-100">
          {prompts.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0"><span className="text-xs font-bold text-brand-dark">{p.name}</span><p className="text-xs text-slate-500 truncate">{p.prompt}</p></div>
              <button onClick={async () => { await fetch("/api/admin/ai/prompts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) }); load(); }} className="p-1.5 text-red-400 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {prompts.length === 0 && <p className="text-center text-slate-400 text-sm py-4">No prompts yet — click a sample above to prefill.</p>}
        </div>
      </section>
      </>}
    </div>
    <AiHubRail goTo={goTo} agents={agents} fns={fns} prompts={prompts} autoRoute={autoRoute} tone={tone} />
    </div>
  );
}

export default AiHubTab;
