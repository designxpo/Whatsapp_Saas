"use client";

// AI Hub tab (agents, function-calling, prompts, key) + its sidebar rail —
// extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Check, Loader2, Plus, ShieldCheck, Sparkles, Trash2, Zap, Drama } from "lucide-react";
import { type Tab, inp, type AiAgentT, type AiParamT, type AiFunctionT, type AiPromptT, RailCard, StatRow } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { Drawer } from "@/components/overlay";
import { SalesCloserCard } from "./SalesCloserCard";
import { RoutePreviewCard } from "./RoutePreviewCard";

// Business isolation — each channel answers with its own persona and its own
// knowledge, and a channel that hasn't chosen falls back to a neutral assistant,
// never to another business's persona (src/lib/isolation.ts).
type IsoChannel = { id: string; name: string; kind: string; persona: string | null; knowledge: string | null; issues: { code: string; text: string }[] };
type IsoReport = { mode: "auto" | "on" | "off"; active: boolean; channels: IsoChannel[] };
const KIND_NAME: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", webchat: "Website chat", youtube: "YouTube", google_reviews: "Google Reviews" };

function IsolationCard({ goTo }: { goTo: (t: Tab) => void }) {
  const [rep, setRep] = useState<IsoReport | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { fetch("/api/admin/ai/isolation").then(r => r.ok ? r.json() : null).then(setRep).catch(() => {}); }, []);
  if (!rep) return null;
  const setMode = async (mode: IsoReport["mode"]) => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/ai/isolation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      if (r.ok) { setRep(await r.json()); toast("Business isolation saved"); } else toast({ text: "Couldn't save. Please try again.", tone: "error" });
    } catch { toast({ text: "Couldn't reach the server. Please try again.", tone: "error" }); }
    finally { setSaving(false); }
  };
  const gaps = rep.channels.filter(c => c.issues.length).length;
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Business isolation
            <span className={`ml-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full normal-case ${rep.active ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{rep.active ? "On" : "Off"}</span>
          </p>
          <PageInfo className="text-xs text-slate-500 mt-0.5" lead={<>For running more than one business here: each channel answers only with its own AI agent and its own documents.</>}>
            <p>When it is on, a channel with no agent picked uses a neutral assistant, never another business&apos;s agent. A channel with no knowledge tag has nothing to answer from, so it hands the customer to your team instead of reading every document. One business&apos;s agent never answers on another business&apos;s channel.</p>
            <p><b>Auto</b> turns it on as soon as your channels use two or more agents or knowledge tags. A workspace with one business is unchanged.</p>
          </PageInfo>
        </div>
        <select className={`${inp} w-auto text-xs`} value={rep.mode} disabled={saving} onChange={e => setMode(e.target.value as IsoReport["mode"])} aria-label="Business isolation">
          <option value="auto">Auto</option>
          <option value="on">Always on</option>
          <option value="off">Off</option>
        </select>
      </div>
      {rep.channels.length > 0 && (
        <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {rep.channels.map(c => (
            <div key={c.id} className="px-3 py-2 flex flex-wrap sm:flex-nowrap items-start justify-between gap-x-3 gap-y-0.5">
              {/* On a phone the agent + knowledge line sits under the channel name. */}
              <div className="min-w-0 flex-1 max-sm:basis-full">
                <p className="text-sm font-semibold text-ink-900 truncate">{c.name} <span className="text-[11px] font-normal text-slate-400">· {KIND_NAME[c.kind] ?? c.kind}</span></p>
                {rep.active && c.issues.map(i => <p key={i.code} className="text-[11px] text-amber-700">{i.text}</p>)}
              </div>
              <div className="flex flex-wrap gap-x-2 sm:block sm:text-right sm:shrink-0 text-[11px] leading-5">
                <p className={c.persona ? "text-ink-700 font-semibold" : "text-slate-400"}>{c.persona ?? (rep.active ? "Neutral assistant" : "Default agent")}</p>
                <p className={c.knowledge ? "text-slate-500" : "text-slate-400"}>{c.knowledge ? `Knowledge: ${c.knowledge}` : rep.active ? "No knowledge" : "All knowledge"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {rep.active && gaps > 0 && (
        <button onClick={() => goTo("settings")} className="text-[11px] font-bold text-brand-700 inline-flex items-center gap-1 hover:underline">
          Pick an agent and knowledge for {gaps} channel{gaps === 1 ? "" : "s"} in Settings <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </section>
  );
}

function AiHubRail({ goTo, agents, fns, prompts, autoRoute, tone }: { goTo: (t: Tab) => void; agents: AiAgentT[]; fns: AiFunctionT[]; prompts: AiPromptT[]; autoRoute: boolean | null; tone: boolean | null }) {
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Hub status">
        <StatRow label="AI agents" value={agents.length} />
        <StatRow label="Default agent" value={agents.find(a => a.active)?.name ?? "—"} />
        <StatRow label="Auto-routing" value={autoRoute === null ? "…" : autoRoute ? "ON" : "OFF"} tone={autoRoute === false ? "warn" : undefined} />
        <StatRow label="Agent's voice on saved answers" value={tone === null ? "…" : tone ? "ON" : "OFF"} />
        <StatRow label="Lead-capture functions" value={fns.length} />
        <StatRow label="Writing tools" value={prompts.length} />
      </RailCard>
      <RailCard title="How it fits together">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li>A customer asks something on WhatsApp.</li>
          <li><b>Auto-routing</b> picks the best agent for that topic.</li>
          <li>The agent answers using your <b>AI Knowledge Base</b>.</li>
          <li>Mid-chat, <b>lead capture</b> quietly saves details — name, what they’re interested in, city…</li>
        </ol>
        <button onClick={() => goTo("assistant")} className="text-[11px] font-bold text-brand-700 flex items-center gap-1">Open AI Knowledge Base <ArrowRight className="w-3 h-3" /></button>
      </RailCard>
      <RailCard title="Starter setup">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Two agents: <b>Sales</b> (pricing, offers, how to buy) and <b>Support</b> (existing customers).</li>
          <li>One <b>lead capture</b> that saves name, what they’re interested in, and city.</li>
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
  const ask = useConfirm();
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
      if (!r.ok) setMsg({ ok: false, text: d.error ?? "Couldn't save the key. Please check it and try again." });
      else { setStatus(d); setApiKey(""); setMsg(null); toast("AI key checked and saved — AI replies are on"); }
    } catch { setMsg({ ok: false, text: "Couldn't reach the server. Please try again." }); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!(await ask({
      title: "Remove this AI key?", tone: "danger", confirmLabel: "Remove key",
      message: "AI auto-replies stop for this whole workspace until you add another key. Customers messaging in the meantime get no automated answer.",
    }))) return;
    setBusy(true); setMsg(null);
    try { const d = await fetch("/api/admin/ai/key", { method: "DELETE" }).then(r => r.json()); setStatus(d); toast("AI key removed — AI replies are off"); }
    catch { toast({ text: "Couldn't remove the key. Please try again.", tone: "error" }); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-sm font-extrabold text-brand-dark flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Your AI account</h3>
        {status && (status.configured
          ? <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Connected · {status.provider} · {status.keyHint}</span>
          : <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Not configured — AI replies off</span>)}
      </div>
      <p className="text-[12px] text-slate-500">The AI replies to customers using your own Google, OpenAI or Anthropic account, so the AI&apos;s cost is billed there. Paste the key from that account below. Searching your documents runs on Talko and isn&apos;t charged to you.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <select value={provider} onChange={e => setProvider(e.target.value)} aria-label="AI company" className="rounded-control border border-line px-3 py-2 text-sm">
          <option value="gemini">Google Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic (Claude)</option>
        </select>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder={`Model (optional — default ${AI_MODEL_HINT[provider]})`} aria-label="Model (optional)" className="rounded-control border border-line px-3 py-2 text-sm sm:col-span-2" />
      </div>
      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "Enter a new key to replace the saved one" : "Paste your API key"} aria-label="API key" className="w-full rounded-control border border-line px-3 py-2 text-sm font-mono" />
      <p className="text-[11px] text-slate-500">{AI_KEY_HELP[provider]}</p>
      {/* Google's terms let it use what's sent through a free-tier Gemini key to
          improve its products, with human review. Customer chats shouldn't go
          there, so the owner is told before saving one. */}
      {provider === "gemini" && <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-2.5 py-1.5">Use a key from a Google Cloud project with billing turned on. On Gemini&apos;s free tier, Google may use what you send — your customers&apos; messages — to improve its products.</p>}
      {msg && <p className={`text-[12px] font-semibold ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={busy || !apiKey.trim()} title={!apiKey.trim() ? "Paste your API key first" : undefined} className="min-h-10 bg-brand-700 text-white rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50 inline-flex items-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Check &amp; save
        </button>
        {status?.configured && <button onClick={remove} disabled={busy} className="min-h-10 text-red-600 border border-red-200 rounded-control px-4 py-2 text-sm font-bold disabled:opacity-50">Remove</button>}
        {!apiKey.trim() && !busy && <span className="self-center text-[12px] text-slate-500">Paste your API key to save it.</span>}
      </div>
    </section>
  );
}

function AiHubTab({ goTo }: { goTo: (t: Tab) => void }) {
  const ask = useConfirm();
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
      if (d.persona) { setAgent(a => ({ ...a, persona: d.persona })); toast("Personality written — check it and edit freely"); }
      else toast({ text: d.error ?? "Couldn't write the personality. Please try again.", tone: "error" });
    } catch { toast({ text: "Couldn't reach the server. Please try again.", tone: "error" }); }
    finally { setBusy(""); }
  }
  async function saveAgent() {
    if (!agent.name.trim()) return;
    setBusy("agent");
    try {
      const r = await fetch("/api/admin/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(agent) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ text: d.error ?? "Couldn't save the agent. Please try again.", tone: "error" }); return; }
      toast(agent.id ? `${agent.name} updated` : `${agent.name} created`);
      setAgent(EMPTY_AGENT); setAgentFormOpen(false); load();
    } catch { toast({ text: "Couldn't reach the server. Please try again.", tone: "error" }); }
    finally { setBusy(""); }
  }
  async function saveFn() {
    if (!fn?.name.trim()) return;
    setBusy("fn");
    try {
      const r = await fetch("/api/admin/ai/functions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fn) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); toast({ text: d.error ?? "Couldn't save. Please try again.", tone: "error" }); return; }
      toast("Lead capture saved"); setFn(null); load();
    } catch { toast({ text: "Couldn't reach the server. Please try again.", tone: "error" }); }
    finally { setBusy(""); }
  }
  async function postPrompt(name: string, prompt: string): Promise<boolean> {
    const r = await fetch("/api/admin/ai/prompts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, prompt }) }).catch(() => null);
    if (!r?.ok) { toast({ text: "Couldn't save the writing tool. Please try again.", tone: "error" }); return false; }
    return true;
  }
  async function addPrompt() {
    if (!pName.trim() || !pText.trim()) return;
    if (!(await postPrompt(pName, pText))) return;
    toast(`“${pName.trim()}” added`);
    setPName(""); setPText(""); load();
  }
  // Removing a writing tool is undoable: it's re-added with the same name and instruction.
  async function removePrompt(p: AiPromptT) {
    const r = await fetch("/api/admin/ai/prompts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) }).catch(() => null);
    load();
    if (!r?.ok) { toast({ text: "Couldn't remove it. Please try again.", tone: "error" }); return; }
    toast({ text: `“${p.name}” removed`, action: { label: "Undo", onClick: () => { void postPrompt(p.name, p.prompt).then(ok => { if (ok) { toast(`“${p.name}” restored`); load(); } }); } } });
  }
  async function removeAgent(a: AiAgentT) {
    if (!(await ask({
      title: `Delete ${a.name || "this agent"}?`, tone: "danger", confirmLabel: "Delete agent",
      message: "Channels that use this agent switch to your default agent. This can't be undone.",
    }))) return;
    const r = await fetch("/api/admin/ai/agents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) }).catch(() => null);
    if (r?.ok) toast(`${a.name || "Agent"} deleted`); else toast({ text: "Couldn't delete the agent. Please try again.", tone: "error" });
    load();
  }
  async function makeDefault(a: AiAgentT) {
    const r = await fetch("/api/admin/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...a, active: true }) }).catch(() => null);
    if (r?.ok) toast(`${a.name} is now the default agent`); else toast({ text: "Couldn't change the default. Please try again.", tone: "error" });
    load();
  }
  async function removeFn(f: AiFunctionT) {
    if (!(await ask({
      title: "Delete this lead capture?", tone: "danger", confirmLabel: "Delete",
      message: "The AI stops saving these details from chats. Details already saved stay on your contacts.",
      facts: [{ label: "Name", value: f.name }],
    }))) return;
    const r = await fetch("/api/admin/ai/functions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id }) }).catch(() => null);
    if (r?.ok) toast("Lead capture deleted"); else toast({ text: "Couldn't delete it. Please try again.", tone: "error" });
    load();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Sparkles className="w-5 h-5" /> AI Hub</h2><PageInfo className="text-sm text-slate-500" lead={<>Three simple things live here: <b>AI agents</b>, <b>Lead capture</b> and <b>Writing tools</b>.</>}>Three simple things live here: <b>AI agents</b> — who the AI is when it replies, <b>Lead capture</b> — the details it saves mid-chat, and <b>Writing tools</b> — one-tap rewrites for your team in Live Chat.</PageInfo>
      </div>

      <AiKeyCard />
      <SalesCloserCard />

      <div className="flex gap-2 flex-wrap">
        {([["agents", "AI agents"], ["functions", "Lead capture"], ["prompts", "Writing tools"]] as ["agents" | "functions" | "prompts", string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSub(k)} aria-pressed={sub === k} className={`min-h-10 px-4 py-2 rounded-lg text-sm font-bold ${sub === k ? "bg-brand-700 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
        ))}
      </div>

      {sub === "agents" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        An <b>agent</b> is a personality + job for the AI — e.g. <i>Maya, the sales assistant</i>. Create one per role; with auto-routing on, the best-matching agent answers each customer automatically.
      </div>

      <section className="bg-white rounded-card border border-line p-5">
        <div className="grid grid-cols-2 gap-2">
          <button aria-pressed={!!autoRoute} onClick={async () => { const d = await fetch("/api/admin/ai/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: !autoRoute }) }).then(r => r.json()).catch(() => null); if (!d) { toast({ text: "Couldn't save. Please try again.", tone: "error" }); return; } setAutoRoute(d.auto === true); toast(d.auto ? "Auto-routing on" : "Auto-routing off"); }}
            className={`text-left rounded-control border p-3 transition-colors ${autoRoute ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
            <p className="text-xs font-bold text-ink-900 inline-flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Auto-routing <span className={autoRoute ? "text-brand-700" : "text-slate-400"}>{autoRoute === null ? "…" : autoRoute ? "ON" : "OFF"}</span></p><p className="text-xs text-slate-500 mt-0.5">Switch to the right agent automatically based on what the customer asks.</p>
          </button>
          <button aria-pressed={!!tone} onClick={async () => { const d = await fetch("/api/admin/ai/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tone: !tone }) }).then(r => r.json()).catch(() => null); if (!d) { toast({ text: "Couldn't save. Please try again.", tone: "error" }); return; } setTone(d.tone !== false); toast(d.tone !== false ? "Saved answers now use the agent's voice" : "Saved answers are sent as written"); }}
            className={`text-left rounded-control border p-3 transition-colors ${tone ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
            <p className="text-xs font-bold text-ink-900 inline-flex items-center gap-1"><Drama className="w-3.5 h-3.5" /> Agent&apos;s voice <span className={tone ? "text-brand-700" : "text-slate-400"}>{tone === null ? "…" : tone ? "ON" : "OFF"}</span></p><p className="text-xs text-slate-500 mt-0.5">Ready-made and saved answers are reworded in the agent&apos;s voice before sending.</p>
          </button>
        </div>
      </section>

      <RoutePreviewCard agents={agents.filter(a => a.id).map(a => ({ id: a.id as string, name: a.name }))} />

      <IsolationCard goTo={goTo} />

      {/* Agents */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Your agents</p>
          <button onClick={() => { setAgent(EMPTY_AGENT); setAgentFormOpen(true); }} className="min-h-9 px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold"><Plus className="w-3.5 h-3.5 inline" /> New agent</button>
        </div>
        {agents.map(a => (
          <div key={a.id} className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-brand-dark">{a.name} {a.active && <span className="text-[11px] font-bold text-brand-700" title="Answers on channels that haven't picked an agent, unless business isolation is on">● Default</span>}</p>
              <p className="text-[11px] text-slate-400 truncate">{a.description || "—"}</p>
            </div>
            {/* Buttons get their own line on a phone so the agent's name and job stay readable. */}
            <div className="flex gap-2 sm:shrink-0 max-sm:w-full max-sm:justify-end">
              {!a.active && <button onClick={() => void makeDefault(a)} className="min-h-8 text-[12px] font-bold text-brand-700 border border-brand-100 rounded-lg px-2 py-1">Make default</button>}
              <button onClick={() => { setAgent(a); setAgentFormOpen(true); }} className="min-h-8 text-[12px] font-bold text-slate-600 border border-line rounded-lg px-2 py-1">Edit</button>
              <button onClick={() => void removeAgent(a)} aria-label={`Delete ${a.name}`} className="grid place-items-center w-8 h-8 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {agents.length === 0 && !agentFormOpen && <p className="text-center text-slate-400 text-sm py-4">No agents yet — hit <b>New agent</b>, describe the job in one line, and Generate writes the personality for you.</p>}
        <Drawer open={agentFormOpen} onClose={() => setAgentFormOpen(false)} width="lg" title="AI agent">
        {agentFormOpen && (<div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">1 · Who is this agent?</p>
            <input className={`${inp} w-full`} placeholder="Name — e.g. Maya" value={agent.name} onChange={e => setAgent({ ...agent, name: e.target.value })} />
            <div className="flex gap-2">
              <textarea className={`${inp} flex-1 min-w-0 resize-none`} rows={2} placeholder="Their job in one line — e.g. Sales assistant who helps visitors pick the right product for their budget" value={agent.description} onChange={e => setAgent({ ...agent, description: e.target.value })} />
              <button onClick={generatePersona} disabled={busy === "gen" || !agent.description.trim()} title={!agent.description.trim() ? "Describe their job in one line first" : "Write the personality for me"} className="self-end min-h-10 px-3 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold disabled:opacity-50 shrink-0">
                {busy === "gen" ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Generate</>}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">2 · When should this agent take over? <span className="font-normal text-slate-400">(used by auto-routing)</span></p>
            <input className={`${inp} w-full`} placeholder="Topic keywords — e.g. pricing, availability, booking, offers" value={agent.routingKeywords ?? ""} onChange={e => setAgent({ ...agent, routingKeywords: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-ink-700">3 · Personality &amp; instructions <span className="font-normal text-slate-400">(AI Generate fills this — edit freely)</span></p>
            <textarea className={`${inp} w-full resize-none font-mono text-xs`} rows={7} placeholder="How they talk and what they do — or press Generate" value={agent.persona} onChange={e => setAgent({ ...agent, persona: e.target.value })} />
          </div>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — hard rules, extra product info, model override</summary>
            <div className="pt-2 space-y-2">
              <textarea className={`${inp} w-full resize-none`} rows={3} placeholder={"Hard rules — e.g.\nNever discuss pricing unless asked. Keep replies under 30 words."} value={agent.constraintsText} onChange={e => setAgent({ ...agent, constraintsText: e.target.value })} />
              <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="Product & service info this agent always knows (on top of the knowledge base)" value={agent.productInfo} onChange={e => setAgent({ ...agent, productInfo: e.target.value })} />
              <input className={`${inp} w-full`} placeholder="Model override (optional — leave blank for the default)" value={agent.model ?? ""} onChange={e => setAgent({ ...agent, model: e.target.value || null })} />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={saveAgent} disabled={busy === "agent" || !agent.name.trim()} title={!agent.name.trim() ? "Give the agent a name first" : undefined} className="min-h-10 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">{agent.id ? "Update agent" : "Create agent"}</button>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={agent.active} onChange={e => setAgent({ ...agent, active: e.target.checked })} /> make this the default agent</label>
            <button onClick={() => { setAgent(EMPTY_AGENT); setAgentFormOpen(false); }} className="min-h-10 px-2 text-xs text-slate-500 font-bold">Cancel</button>
          </div>
          {!agent.name.trim() && <p className="text-[12px] text-slate-500">Give the agent a name (step 1) to create it.</p>}
        </div>)}
        </Drawer>
      </section>
      </>}

      {sub === "functions" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        Lead capture teaches the AI to <b>save details during a normal chat</b> — no form needed. Example: a <b>lead capture</b> stores name, what they’re interested in, and city as contact attributes the moment the customer mentions them.
      </div>

      {/* Functions */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-400 uppercase">Details the AI saves</p>
            <p className="text-[12px] text-slate-500 mt-0.5">Once the customer has shared the details, the AI saves them on their contact — and can hand the chat to your team.</p>
          </div>
          <button onClick={() => setFn(EMPTY_FN)} className="min-h-9 px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold shrink-0"><Plus className="w-3.5 h-3.5 inline" /> Lead capture</button>
        </div>
        {fns.map(f => (
          <div key={f.id} className="flex items-center justify-between gap-2 border border-slate-100 rounded-lg px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-brand-dark">{f.name} {!f.active && <span className="text-[11px] text-slate-500">(off)</span>} {f.escalate && <span className="text-[11px] font-bold text-red-600">→ then hands to your team</span>}</p>
              <p className="text-[11px] text-slate-500 truncate">Saves: {f.parameters.map(pm => pm.name).join(", ")}{f.webhookUrl ? " · also sends to your system" : ""}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => setFn(f)} className="min-h-8 text-[12px] font-bold text-slate-600 border border-line rounded-lg px-2 py-1">Edit</button>
              <button onClick={() => void removeFn(f)} aria-label={`Delete ${f.name}`} className="grid place-items-center w-8 h-8 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
        {fns.length === 0 && <p className="text-center text-slate-500 text-sm py-4">Nothing set up yet. Add a lead capture so the AI saves a customer&apos;s name, interest and city on their contact as they chat — no form needed.</p>}
        <Drawer open={!!fn} onClose={() => setFn(null)} width="lg" title="Lead capture">
          {fn && (<div className="space-y-3">
            <input className={`${inp} w-full`} placeholder="Short name, no spaces (e.g. capture_lead)" aria-label="Name" value={fn.name} onChange={e => setFn({ ...fn, name: e.target.value })} />
            <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="When should the AI call this? (e.g. once the visitor has shared name, phone and their problem and confirmed the summary)" value={fn.description} onChange={e => setFn({ ...fn, description: e.target.value })} />
            <p className="text-[11px] font-bold text-slate-500 uppercase">Details to save</p>
            {fn.parameters.map((pm, i) => (
              <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1.4fr_1fr_auto_auto] gap-2 items-center">
                <input className={inp} placeholder="detail (e.g. city)" aria-label="Detail name" value={pm.name} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                <input className={inp} placeholder="what it means, for the AI" aria-label="What it means" value={pm.description} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} />
                <input className={inp} placeholder="save on contact as" aria-label="Save on the contact as" value={pm.saveToAttribute} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, saveToAttribute: e.target.value } : x) })} />
                <label className="min-h-8 text-[12px] font-bold text-slate-500 flex items-center gap-1"><input type="checkbox" checked={pm.required} onChange={e => setFn({ ...fn, parameters: fn.parameters.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} />Required</label>
                <button onClick={() => setFn({ ...fn, parameters: fn.parameters.filter((_, j) => j !== i) })} aria-label={`Remove ${pm.name || "this detail"}`} className="grid place-items-center w-8 h-8 rounded-lg text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setFn({ ...fn, parameters: [...fn.parameters, { name: "", description: "", required: false, saveToAttribute: "" }] })} className="min-h-8 text-[12px] font-bold text-brand-dark">+ Add a detail</button>
            <details className="rounded-control border border-line px-3 py-2">
              <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">For developers — also send the details to your own system</summary>
              <div className="pt-2 space-y-1">
                <input className={`${inp} w-full`} placeholder="Webhook URL (optional)" aria-label="Webhook URL" value={fn.webhookUrl ?? ""} onChange={e => setFn({ ...fn, webhookUrl: e.target.value || null })} />
                <p className="text-[11px] text-slate-500">The AI POSTs the captured details to this URL as JSON once it has them.</p>
              </div>
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={saveFn} disabled={busy === "fn" || !fn.name.trim()} title={!fn.name.trim() ? "Give it a name first" : undefined} className="min-h-10 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">{fn.id ? "Save" : "Create"}</button>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={fn.escalate} onChange={e => setFn({ ...fn, escalate: e.target.checked })} /> then hand the chat to your team</label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><input type="checkbox" checked={fn.active} onChange={e => setFn({ ...fn, active: e.target.checked })} /> active</label>
              <button onClick={() => setFn(null)} className="min-h-10 px-2 text-xs text-slate-500 font-bold">Cancel</button>
            </div>
            {!fn.name.trim() && <p className="text-[12px] text-slate-500">Give it a name to create it.</p>}
          </div>)}
        </Drawer>
      </section>

      </>}

      {sub === "prompts" && <>
      <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-900">
        Writing tools are <b>one-tap rewrites</b> your team uses on drafts in the Live Chat composer (the AI-assist button) — change tone, translate, shorten. Click a sample below to add it.
      </div>

      {/* Prompts */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Your writing tools</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Available to everyone in the Live Chat composer (AI-assist button).</p>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {[["Friendly tone", "Rewrite the text in a warm, approachable, friendly tone, as if speaking to a friend."], ["Formal tone", "Rewrite the text in a polite, professional, formal tone."], ["Fix spelling & grammar", "Fix all spelling and grammar mistakes in the text without changing its meaning."], ["Translate to Hindi", "Translate the text to conversational Hindi written in Devanagari."], ["Translate to English", "Translate the text to natural English."], ["Shorten", "Rewrite the text to be as short as possible while keeping all key information."]].map(([n, p]) => (
            <button key={n} onClick={() => { setPName(n); setPText(p); }} className="min-h-8 px-2.5 py-1 rounded-full border border-line text-[12px] font-bold text-slate-600 hover:border-brand-dark">{n}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className={`${inp} w-32 sm:w-44`} placeholder="Name" aria-label="Writing tool name" value={pName} onChange={e => setPName(e.target.value)} />
          <input className={`${inp} flex-1 min-w-0`} placeholder="Instruction (e.g. Rewrite the text in a friendly tone…)" aria-label="Instruction" value={pText} onChange={e => setPText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addPrompt(); }} />
          <button onClick={addPrompt} disabled={!pName.trim() || !pText.trim()} aria-label="Add writing tool" title={!pName.trim() || !pText.trim() ? "Type a name and an instruction first" : "Add writing tool"} className="min-h-10 min-w-10 px-3 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="divide-y divide-slate-100">
          {prompts.map(p => (
            <div key={p.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0 flex-1"><span className="text-xs font-bold text-brand-dark">{p.name}</span><p className="text-xs text-slate-500 truncate">{p.prompt}</p></div>
              <button onClick={() => void removePrompt(p)} aria-label={`Remove ${p.name}`} className="grid place-items-center w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {prompts.length === 0 && <p className="text-center text-slate-500 text-sm py-4">No writing tools yet. Tap a sample above (like “Translate to Hindi”) to fill it in, then press +.</p>}
        </div>
      </section>
      </>}
    </div>
    <AiHubRail goTo={goTo} agents={agents} fns={fns} prompts={prompts} autoRoute={autoRoute} tone={tone} />
    </div>
  );
}

export default AiHubTab;
