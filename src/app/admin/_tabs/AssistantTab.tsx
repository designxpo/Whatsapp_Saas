"use client";

// AI Knowledge Base (Assistant) tab — KnowledgeRail + AssistantTab + KB add form
// + test box, extracted from admin/page.tsx and lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { ArrowRight, Bot, Database, FileText, FlaskConical, Globe, Loader2, MessageSquare, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { type Tab, type GoTo, inp, railLoading, RailCard, StatRow, RailBar, statusBadge, ConvAvatar, useAnalytics } from "../_shared";

// AI Knowledge Base: answer-engine split, latency/savings, personas, inbox.
type RouterStatsData = {
  total: number;
  counts: Record<string, number>;
  faqHitRate: number; cacheHitRate: number; memoryResolvedRate: number; ragUsageRate: number;
  avgLatencyMs: Record<string, number>;
  estTokensSaved: number;
  faqEntries?: number;
};

function KnowledgeRail({ goTo }: { goTo: GoTo }) {
  const a = useAnalytics();
  const [rs, setRs] = useState<RouterStatsData | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string; active: boolean }[] | null>(null);
  useEffect(() => { fetch("/api/admin/router/stats?days=7").then(r => r.json()).then(d => setRs(d.error ? null : d)).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents(d.agents ?? [])).catch(() => setAgents([])); }, []);
  const answered = rs ? (rs.counts.MEMORY_HIT ?? 0) + (rs.counts.FAQ_MATCH ?? 0) + (rs.counts.CACHE_HIT ?? 0) + (rs.counts.RAG_USED ?? 0) : 0;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Answer engine — 7 days">
        {!rs || answered === 0
          ? <p className="text-xs text-slate-400">No customer questions answered yet. Once chats flow in, you&apos;ll see how many were answered instantly (FAQ/cache) vs. by the full AI.</p>
          : <div className="space-y-2">
              <RailBar label="Instant — FAQ" count={rs.counts.FAQ_MATCH ?? 0} pct={rs.faqHitRate} color="bg-brand-700" />
              <RailBar label="Instant — cache" count={rs.counts.CACHE_HIT ?? 0} pct={rs.cacheHitRate} color="bg-brand-500" />
              <RailBar label="Remembered answer" count={rs.counts.MEMORY_HIT ?? 0} pct={rs.memoryResolvedRate} color="bg-brand-300" />
              <RailBar label="Full AI (RAG)" count={rs.counts.RAG_USED ?? 0} pct={rs.ragUsageRate} color="bg-ink-900" />
              <p className="text-[11px] text-slate-400 pt-1">{answered.toLocaleString()} answered · ~{rs.estTokensSaved.toLocaleString()} AI tokens saved{rs.avgLatencyMs.RAG_USED ? ` · AI avg ${rs.avgLatencyMs.RAG_USED}ms` : ""}</p>
            </div>}
      </RailCard>
      <RailCard title="AI personas" action="AI Hub" onAction={() => goTo("aihub")}>
        {!agents ? railLoading : agents.length === 0
          ? <p className="text-xs text-slate-400">No personas yet — create agents in AI Hub (e.g. Sales, Support) and the router switches between them per question.</p>
          : agents.map(ag => (
            <div key={ag.id} className="flex items-center gap-2 py-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${ag.active ? "bg-brand-500" : "bg-slate-300"}`} />
              <span className="text-xs font-semibold text-ink-900 truncate">{ag.name}</span>
              {ag.active && <span className="text-[10px] font-bold text-brand-700 ml-auto">DEFAULT</span>}
            </div>
          ))}
      </RailCard>
      <RailCard title="Conversations" action="Live Chat" onAction={() => goTo("livechat")}>
        {!a ? railLoading : <>
          <StatRow label="Awaiting your reply" value={a.conversations.needsReply} tone={a.conversations.needsReply > 0 ? "warn" : undefined} onClick={() => goTo("livechat", { filter: "needs_reply" })} />
          <StatRow label="Escalated" value={a.conversations.escalated} tone={a.conversations.escalated > 0 ? "bad" : undefined} onClick={() => goTo("livechat", { filter: "escalated" })} />
          <StatRow label="Total" value={a.conversations.total} />
        </>}
      </RailCard>
      <RailCard title="Make answers better">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Add product/brochure <b>URLs</b> to the knowledge base — the AI turns them into tappable buttons.</li>
          <li>Short FAQ-style docs answer fastest; the router serves them without calling the AI.</li>
          <li>Tune personas, functions, and auto-routing in <b>AI Hub</b>.</li>
          <li>Watch real replies land in <b>Live Chat</b> — toggle the bot off per chat to take over.</li>
        </ul>
      </RailCard>
    </aside>
  );
}
// ── AI Assistant ───────────────────────────────────────────────────────────────
type KbDoc = { id: string; title: string; sourceType: "pdf" | "docx" | "text" | "url"; status: "processing" | "ready" | "failed"; chunkCount: number; error?: string | null; createdAt: string; lastSyncedAt?: string | null; tag?: string | null };
// ImageUpload, the Conversation type and ConvAvatar now live in ./_shared.

const PIPELINE: { icon: React.ReactNode; title: string; desc: string }[] = [
  { icon: <MessageSquare className="w-5 h-5" />, title: "Inbound", desc: "Customer sends a WhatsApp message" },
  { icon: <Database className="w-5 h-5" />, title: "Retrieve", desc: "Search business docs (pgvector) for relevant context" },
  { icon: <Sparkles className="w-5 h-5" />, title: "Draft", desc: "Gemini drafts a reply grounded in that context" },
  { icon: <ShieldCheck className="w-5 h-5" />, title: "Guardrails", desc: "Opt-out, grounding & escalation checks" },
  { icon: <Send className="w-5 h-5" />, title: "Reply", desc: "Delivered on WhatsApp (within 24h window)" },
];

// statusBadge now lives in ./_shared (used by ChatView here + the Assistant tab).

function AssistantTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [backendReady, setBackendReady] = useState(true);

  const load = useCallback(() => {
    fetch("/api/admin/kb").then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setDocs(d.documents ?? []); setEnabled(d.botEnabled ?? null); setBackendReady(true); })
      .catch(() => setBackendReady(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Bot className="w-5 h-5" /> AI Knowledge Base</h2>
          <p className="text-sm text-slate-500">Teach and test the AI here — knowledge base + dry-run testing. Customer conversations live in <b>Live Chat</b>.</p>
        </div>
        <span className={statusBadge(enabled ? "active" : enabled === false ? "paused" : "processing")}>
          {enabled === null ? "status unknown" : enabled ? "● live" : "○ paused"}
        </span>
      </div>

      {!backendReady && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <b>Backend not wired yet.</b> This view shows the planned flow. The knowledge base and conversations populate once the assistant backend (migrations + Gemini + webhook) is built — see <code className="bg-amber-100 px-1 rounded">AUTOMATION-PLAN.md</code>.
        </div>
      )}

      {/* Pipeline */}
      <section className="bg-white rounded-card border border-line p-5">
        <p className="text-xs font-bold text-slate-400 uppercase mb-4">How a reply is produced</p>
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {PIPELINE.map((s, i) => (
            <div key={s.title} className="flex items-stretch gap-1 shrink-0">
              <div className="w-36 shrink-0 rounded-lg border border-line bg-slate-50 p-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-brand-dark font-bold text-sm">{s.icon}{s.title}</div>
                <p className="text-[11px] leading-snug text-slate-500">{s.desc}</p>
              </div>
              {i < PIPELINE.length - 1 && <div className="flex items-center text-slate-300"><ArrowRight className="w-4 h-4" /></div>}
            </div>
          ))}
        </div>
      </section>

      {/* Test the assistant (no WhatsApp send) */}
      <TestAssistantBox />

      {/* Knowledge base */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Knowledge base</p>
          <span className="text-xs text-slate-400">{docs.length} document{docs.length === 1 ? "" : "s"}</span>
        </div>
        <KbAddForm onAdded={load} disabled={!backendReady} />
        <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
          {docs.map(d => (
            <div key={d.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                {d.sourceType === "url" ? <Globe className="w-4 h-4 text-slate-400 shrink-0" /> : <FileText className="w-4 h-4 text-slate-400 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-dark truncate">{d.title}</p>
                  <p className="text-[11px] text-slate-400">{d.sourceType.toUpperCase()}{d.tag ? ` · #${d.tag}` : ""} · {d.chunkCount} chunks{d.sourceType === "url" ? ` · auto-updates${d.lastSyncedAt ? ` · synced ${new Date(d.lastSyncedAt).toLocaleDateString()}` : ""}` : ""}{d.error ? ` · ${d.error}` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <input className="w-24 border border-line rounded px-1.5 py-0.5 text-[11px] text-ink-700 placeholder:text-ink-300" placeholder="+ topic tag" title="Tag this doc so a flow can use it as primary knowledge (Enter to save)" defaultValue={d.tag ?? ""}
                  onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onBlur={e => { const v = e.target.value.trim(); if (v !== (d.tag ?? "")) fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retag: d.id, tag: v || null }) }).then(load).catch(() => {}); }} />
                <span className={statusBadge(d.status)}>{d.status}</span>
                {d.sourceType === "url" && <button title="Sync now — re-crawl this page" onClick={() => fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resync: d.id }) }).then(load).catch(() => {})} className="p-1.5 text-slate-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg"><RefreshCw className="w-4 h-4" /></button>}
                <button title="Reprocess — re-chunk &amp; re-embed with the latest smart chunker (no re-upload)" onClick={() => fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reprocess: d.id }) }).then(load).catch(() => {})} className="p-1.5 text-slate-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg"><Sparkles className="w-4 h-4" /></button>
                <button onClick={() => fetch("/api/admin/kb", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id }) }).then(load).catch(() => {})} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {docs.length === 0 && <p className="text-center text-slate-400 text-sm py-6">No documents yet — add PDFs, text, or a URL above to ground the assistant.</p>}
        </div>
      </section>

    </div>
    <KnowledgeRail goTo={goTo} />
    </div>
  );
}
function KbAddForm({ onAdded, disabled }: { onAdded: () => void; disabled: boolean }) {
  const [mode, setMode] = useState<"file" | "text" | "url">("file");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(file?: File) {
    setBusy(true); setMsg(null);
    try {
      let res: Response;
      if (mode === "file" && file) {
        const fd = new FormData(); fd.append("file", file); fd.append("title", title || file.name); if (tag.trim()) fd.append("tag", tag.trim());
        res = await fetch("/api/admin/kb", { method: "POST", body: fd });
      } else {
        const body = mode === "url" ? { sourceType: "url", title: title || url, sourceRef: url, tag: tag.trim() || null } : { sourceType: "text", title: title || "Pasted text", content: text, tag: tag.trim() || null };
        res = await fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }));
        setMsg(d.error ? `Failed: ${d.error}` : "Failed to add.");
        return;
      }
      setTitle(""); setText(""); setUrl(""); setTag(""); onAdded();
    } catch { setMsg("Connection error."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {(["file", "text", "url"] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${mode === m ? "border-brand-dark bg-brand-700 text-white" : "border-line text-slate-600"}`}>
            {m === "file" ? "File" : m === "text" ? "Text" : "URL"}
          </button>
        ))}
      </div>
      <input className={`${inp} w-full`} placeholder="Title (optional)" value={title} onChange={e => setTitle(e.target.value)} />
      <input className={`${inp} w-full`} placeholder="Topic tag (optional, e.g. masterclass-jan) — lets a flow use these docs as its primary knowledge" value={tag} onChange={e => setTag(e.target.value)} />
      {mode === "text" && <textarea className={`${inp} w-full`} rows={3} placeholder="Paste business content (FAQ, policies, product info)…" value={text} onChange={e => setText(e.target.value)} />}
      {mode === "url" && <input className={`${inp} w-full`} placeholder="https://yourbusiness.com/faq" value={url} onChange={e => setUrl(e.target.value)} />}
      <div className="flex items-center gap-3">
        {mode === "file"
          ? <label className={`flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold cursor-pointer ${busy || disabled ? "opacity-60 pointer-events-none" : ""}`}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />} Upload & ingest
              <input type="file" accept=".pdf,.doc,.docx,.txt,.md,.markdown,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) submit(f); e.currentTarget.value = ""; }} />
            </label>
          : <button onClick={() => submit()} disabled={busy || disabled} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add & ingest</button>}
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </div>
  );
}

// ── Test the assistant (dry run, no WhatsApp send) ───────────────────────────
type TestResult = { reply: string | null; escalate: boolean; reason: string | null; usedChunks: number; retrieved: { similarity: number; preview: string }[]; error?: string };

function TestAssistantBox() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  async function run() {
    if (!q.trim()) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/admin/assistant/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q.trim() }) });
      setResult(await res.json());
    } catch { setResult({ reply: null, escalate: true, reason: "connection error", usedChunks: 0, retrieved: [], error: "Connection error" }); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> Test the assistant (no message is sent)</p>
      <div className="flex gap-2">
        <input className={`${inp} flex-1`} placeholder="Ask like a customer would… e.g. What are your pricing plans?" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") run(); }} />
        <button onClick={run} disabled={busy || !q.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Test
        </button>
      </div>
      {result && (
        <div className="space-y-2">
          {result.error
            ? <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{result.error}</div>
            : result.escalate
              ? <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800"><b>Would escalate to a human.</b>{result.reason ? ` Reason: ${result.reason}` : ""}</div>
              : <div className="bg-brand-green/10 border border-brand-green/40 rounded-lg px-4 py-3 text-sm whitespace-pre-wrap">{result.reply}</div>}
          {result.retrieved?.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer font-semibold">Retrieved context ({result.usedChunks} used)</summary>
              <div className="mt-1.5 space-y-1">
                {result.retrieved.map((r, i) => (
                  <p key={i} className="bg-slate-50 rounded px-2 py-1.5"><b>{r.similarity}</b> — {r.preview}…</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}


export default AssistantTab;
