"use client";

// AI Knowledge Base (Assistant) tab — KnowledgeRail + AssistantTab + KB add form
// + test box, extracted from admin/page.tsx and lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback, useRef } from "react";
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, Download, Edit3, FolderOpen, Save, X, ArrowRight, Bot, Database, FileText, FlaskConical, Globe, Loader2, MessageSquare, Plus, RefreshCw, Send, ShieldCheck, Sparkles, Trash2, UploadCloud } from "lucide-react";
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
  { icon: <Send className="w-5 h-5" />, title: "Reply", desc: "Delivered back on the same channel the customer wrote from" },
];

// statusBadge now lives in ./_shared (used by ChatView here + the Assistant tab).

function AssistantTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [backendReady, setBackendReady] = useState(true);
  // The OKF library. Absent until 0105/0106 are applied, so a failure here is
  // "not set up yet" and must not blank the documents list above it.
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [areas, setAreas] = useState<AreaCount[]>([]);
  const [spine, setSpine] = useState<{ slug: string; title: string }[]>([]);
  const [mismatches, setMismatches] = useState<Mismatch[]>([]);
  const [libraryOn, setLibraryOn] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/kb").then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setDocs(d.documents ?? []); setEnabled(d.botEnabled ?? null); setBackendReady(true); })
      .catch(() => setBackendReady(false));
    fetch("/api/admin/kb/concepts").then(r => r.ok ? r.json() : null)
      .then(d => { if (!d || d.error) return; setReview(d.review ?? []); setAreas(d.areas ?? []); setSpine(d.spine ?? []); setLibraryOn(!!d.live); })
      .catch(() => {});
    // Separately, and after: the scan reads every chunk of every document, and
    // the tab should not wait on it to show the documents.
    fetch("/api/admin/kb/concepts?mismatches=1").then(r => r.ok ? r.json() : null)
      .then(d => { if (d && !d.error) setMismatches(d.mismatches ?? []); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  // Sync / reprocess run in the background on the server and mark the document
  // "processing" straight away. Say so on the row the moment it is clicked, then
  // poll just the document list (not the heavy mismatch scan) until it settles.
  const [busyDoc, setBusyDoc] = useState<Record<string, "sync" | "reprocess">>({});
  const [docNote, setDocNote] = useState<{ ok: boolean; text: string } | null>(null);
  const refreshDocs = useCallback(() =>
    fetch("/api/admin/kb").then(r => (r.ok ? r.json() : null)).then(d => { if (d) setDocs(d.documents ?? []); }).catch(() => {}), []);
  const runDocAction = useCallback(async (doc: KbDoc, kind: "sync" | "reprocess") => {
    setBusyDoc(b => ({ ...b, [doc.id]: kind })); setDocNote(null);
    try {
      const r = await fetch("/api/admin/kb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(kind === "sync" ? { resync: doc.id } : { reprocess: doc.id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || "Request failed");
      setDocNote({ ok: true, text: kind === "sync" ? `Re-crawling “${doc.title}”… this can take up to a minute.` : `Re-processing “${doc.title}”…` });
      await refreshDocs();
    } catch (e) {
      setDocNote({ ok: false, text: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setBusyDoc(b => { const n = { ...b }; delete n[doc.id]; return n; });
    }
  }, [refreshDocs]);
  const anyProcessing = docs.some(d => d.status === "processing");
  const wasProcessing = useRef(false);
  useEffect(() => {
    if (!anyProcessing) {
      if (wasProcessing.current) { wasProcessing.current = false; setDocNote(n => (n?.ok ? { ok: true, text: "Done — the knowledge base is up to date." } : n)); load(); }
      return;
    }
    wasProcessing.current = true;
    const t = setInterval(refreshDocs, 3000);
    return () => clearInterval(t);
  }, [anyProcessing, refreshDocs, load]);

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

      {/* The OKF library. Only shown once something has been filed into it —
          before that it is noise on a screen about documents. */}
      {(review.length > 0 || areas.length > 0) && (
        <>
          <KbReviewQueue items={review} onResolved={load} />
          <KbConceptBrowser areas={areas} spine={spine} />
          <KbLibraryActions docs={docs.length} onChanged={load} />
          {!libraryOn && areas.length > 0 && (
            <p className="text-[11px] text-slate-400 -mt-3">
              The library is being built but is not answering yet — replies still come from the documents below.
            </p>
          )}
        </>
      )}

      {review.length === 0 && areas.length === 0 && docs.length > 0 && (
        <KbLibraryActions docs={docs.length} onChanged={load} />
      )}

      {/* Disagreements between uploads exist whether or not the library has
          been built, so this is not gated on it. */}
      {docs.length > 0 && <KbMismatches items={mismatches} />}

      {/* How to organise what you upload — the OKF library's shape */}
      <KbStructureGuide />

      {/* Knowledge base */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Knowledge base</p>
          <span className="text-xs text-slate-400">{docs.length} document{docs.length === 1 ? "" : "s"}</span>
        </div>
        <KbAddForm onAdded={load} disabled={!backendReady} />
        {docNote && <p role="status" className={`text-xs rounded-lg px-3 py-2 ${docNote.ok ? "bg-brand-50 text-brand-700" : "bg-red-50 text-red-600"}`}>{docNote.text}</p>}
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
                {d.sourceType === "url" && (
                  <button title={busyDoc[d.id] === "sync" || d.status === "processing" ? "Syncing…" : "Sync now — re-crawl this page"} aria-label="Sync now" disabled={!!busyDoc[d.id] || d.status === "processing"}
                    onClick={() => runDocAction(d, "sync")} className={`p-1.5 rounded-lg disabled:cursor-wait ${busyDoc[d.id] === "sync" || d.status === "processing" ? "text-brand-700 bg-brand-50" : "text-slate-400 hover:text-brand-700 hover:bg-brand-50"}`}>
                    <RefreshCw className={`w-4 h-4 ${busyDoc[d.id] === "sync" || d.status === "processing" ? "animate-spin" : ""}`} />
                  </button>
                )}
                <button title="Reprocess — re-chunk &amp; re-embed with the latest smart chunker (no re-upload)" aria-label="Reprocess" disabled={!!busyDoc[d.id] || d.status === "processing"}
                  onClick={() => runDocAction(d, "reprocess")} className={`p-1.5 rounded-lg disabled:cursor-wait ${busyDoc[d.id] === "reprocess" ? "text-brand-700 bg-brand-50" : "text-slate-400 hover:text-brand-700 hover:bg-brand-50"}`}>
                  {busyDoc[d.id] === "reprocess" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </button>
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
      <input className={`${inp} w-full`} placeholder="Topic tag (optional, e.g. spring-launch) — lets a flow use these docs as its primary knowledge" value={tag} onChange={e => setTag(e.target.value)} />
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

function KbLibraryActions({ docs, onChanged }: { docs: number; onChanged: () => void }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ready: boolean; reason: string } | null>(null);

  // Re-file every concept by what it is about. The server works in time-boxed
  // slices; keep going until it says there is nothing left.
  const reorganise = async () => {
    setBusy("reorganise"); setNote("Re-organising…"); setCheck(null);
    let cursor: string | null = null, areas: string[] = [], moved = 0, kept = 0;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const r: { error?: string; moved?: number; kept?: number; nextCursor?: string | null; areas?: string[] } = await fetch("/api/admin/kb/concepts", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reorganise: true, cursor, areas }),
        }).then(x => x.json()).catch(() => ({ error: "request failed" }));
        if (r.error) { setNote(`${r.error} — ${moved} moved so far. Run it again to continue.`); return; }
        moved += r.moved ?? 0; kept += r.kept ?? 0; areas = r.areas ?? areas;
        setNote(`Re-organising… ${moved + kept} read, ${moved} moved`);
        if (!r.nextCursor) { setNote(`Done — ${moved} concept${moved === 1 ? "" : "s"} moved into ${areas.length} subject area${areas.length === 1 ? "" : "s"}, ${kept} already in the right place.`); return; }
        cursor = r.nextCursor;
      }
    } finally { setBusy(""); onChanged(); }
  };

  const post = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label); setNote(null); setCheck(null);
    try {
      const r = await fetch("/api/admin/kb/concepts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }).then(x => x.json()).catch(() => ({ error: "request failed" }));
      if (r.error) { setNote(r.error); return; }
      if (r.verdict) setCheck(r.verdict);
      if (r.converting) setNote(`Converting ${r.converting} document${r.converting === 1 ? "" : "s"} in the background. Reload in a minute.`);
      onChanged();
    } finally { setBusy(""); }
  };

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <p className="text-xs font-bold text-slate-400 uppercase">Library tools</p>

      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!!busy || !docs} onClick={() => post({ convert: "all" }, "convert")}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {busy === "convert" ? "Converting…" : `Convert ${docs} document${docs === 1 ? "" : "s"}`}
        </button>
        <button disabled={!!busy} onClick={reorganise}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Re-file every concept under subject areas inferred from its content">
          {busy === "reorganise" ? "Re-organising…" : "Re-organise by content"}
        </button>
        <button disabled={!!busy} onClick={() => post({ evaluate: true }, "evaluate")}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {busy === "evaluate" ? "Comparing…" : "Compare against live answers"}
        </button>
        <a href="/api/admin/kb/concepts/export"
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line text-slate-700 hover:bg-slate-50">
          Download bundle
        </a>
      </div>

      <p className="text-[11px] text-slate-400">
        Converting reads documents already uploaded and files them into the library. It is safe to run twice — a
        document restating itself merges rather than duplicating. <b>Re-organise by content</b> re-files everything
        already in the library under subject areas read from what each concept says — use it if the shelves above
        don&apos;t match your business.
      </p>

      {note && <p className="text-[12px] text-slate-600">{note}</p>}

      {check && (
        <div className={`rounded-lg border px-3 py-2 ${check.ready ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
          <p className={`text-[12px] font-semibold ${check.ready ? "text-emerald-800" : "text-amber-800"}`}>
            {check.ready ? "No coverage lost" : "Not ready to switch"}
          </p>
          <p className="text-[11px] text-slate-600 mt-0.5">{check.reason}</p>
          <p className="text-[10px] text-slate-400 mt-1">
            This compares what each index returns. It cannot say the library is more accurate — there is no answer key —
            so read the flagged cases before switching.
          </p>
        </div>
      )}
    </section>
  );
}

type Mismatch = {
  subject: string; field: string; preferred: string;
  claims: { value: string; source: string; path: string }[];
  stale: { value: string; source: string; path: string }[];
};

function KbMismatches({ items }: { items: Mismatch[] }) {
  const label = (f: string) =>
    f.startsWith("price:") ? f.slice(6).replace(/-/g, " ") : f.replace(/_/g, " ");

  if (!items.length) {
    return (
      <section className="bg-white rounded-card border border-line p-5">
        <p className="text-xs font-bold text-slate-400 uppercase">Source mismatches</p>
        <p className="text-sm text-slate-500 mt-1">
          No disagreements found. Every figure stated by more than one document matches.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-400 uppercase">Source mismatches</p>
        <span className="text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
          {items.length} to fix
        </span>
      </div>
      <p className="text-sm text-slate-500">
        Two documents give different numbers for the same thing. The assistant already uses the
        higher-priority one — these are the documents that still need correcting at source.
      </p>

      <div className="space-y-3">
        {items.map((m, i) => (
          <div key={`${m.subject}-${m.field}-${i}`} className="rounded-lg border border-line overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-line flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-brand-dark">{m.subject}</span>
              <code className="text-[11px] text-slate-500">{label(m.field)}</code>
            </div>
            <div className="divide-y divide-slate-100">
              {m.claims.map((c, j) => {
                const wins = c.value === m.preferred;
                return (
                  <div key={j} className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`font-mono text-sm font-semibold ${wins ? "text-emerald-700" : "text-red-700"}`}
                          style={{ fontVariantNumeric: "tabular-nums" }}>
                      {m.field.startsWith("price:") ? `₹${Number(c.value).toLocaleString("en-IN")}` : c.value}
                    </span>
                    <span className="text-[12px] text-slate-600 min-w-0 truncate">{c.source || "unknown source"}</span>
                    <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide ${wins ? "text-emerald-700" : "text-red-700"}`}>
                      {wins ? "in use" : "fix this"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type ReviewItem = {
  incoming: { id: string; path: string; area: string; title: string | null; body: string; tags: string[]; reviewNote: string | null; sources: string[] };
  live: { id: string; path: string; title: string | null; body: string; sources: string[] } | null;
};

type AreaCount = { area: string; active: number; pending: number };

function KbReviewQueue({ items, onResolved }: { items: ReviewItem[]; onResolved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, which: "approve" | "reject") => {
    setBusy(id);
    try {
      await fetch("/api/admin/kb/concepts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [which]: id }),
      });
      onResolved();
    } finally { setBusy(null); }
  };

  if (!items.length) {
    return (
      <section className="bg-white rounded-card border border-line p-5">
        <p className="text-xs font-bold text-slate-400 uppercase">Review queue</p>
        <p className="text-sm text-slate-500 mt-1">Nothing waiting. Uploads that agree with what is published go live on their own.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-400 uppercase">Review queue</p>
        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
          {items.length} waiting
        </span>
      </div>
      <p className="text-sm text-slate-500">
        These were held back. Until one is approved the published answer keeps being used.
      </p>

      <div className="space-y-3">
        {items.map(it => (
          <div key={it.incoming.id} className="rounded-lg border border-line overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-line flex items-center justify-between gap-2">
              <code className="text-[11px] text-slate-500 truncate">{it.incoming.path}</code>
              <span className="text-[11px] text-slate-400 shrink-0">from {it.incoming.sources.join(", ") || "unknown"}</span>
            </div>

            {it.incoming.reviewNote && (
              <p className="px-3 pt-2 text-[11px] text-amber-800">{it.incoming.reviewNote}</p>
            )}

            <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              <div className="p-3">
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-1">
                  {it.live ? "Published now" : "Nothing published yet"}
                </p>
                <p className="text-[12px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                  {it.live ? it.live.body.slice(0, 600) : "—"}
                </p>
              </div>
              <div className="p-3 bg-amber-50/40">
                <p className="text-[10px] font-bold uppercase text-amber-700 mb-1">Incoming</p>
                <p className="text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {it.incoming.body.slice(0, 600)}
                </p>
              </div>
            </div>

            <div className="px-3 py-2 border-t border-line flex items-center justify-end gap-2">
              <button disabled={busy === it.incoming.id}
                onClick={() => act(it.incoming.id, "reject")}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                Keep published
              </button>
              <button disabled={busy === it.incoming.id}
                onClick={() => act(it.incoming.id, "approve")}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-700 text-white hover:bg-brand-900 disabled:opacity-50">
                {busy === it.incoming.id ? "Saving…" : "Use incoming"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function KbConceptBrowser({ areas, spine }: { areas: AreaCount[]; spine: { slug: string; title: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<{ id: string; path: string; title: string | null; body: string; tags: string[] }[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async (area: string) => {
    const r = await fetch(`/api/admin/kb/concepts?area=${encodeURIComponent(area)}`).then(x => x.json()).catch(() => null);
    setConcepts(r?.concepts ?? []);
  }, []);

  const pick = (slug: string) => {
    const next = open === slug ? null : slug;
    setOpen(next); setEditing(null); setErr("");
    setConcepts([]);
    if (next) void load(next);
  };

  const save = async (id: string) => {
    setErr("");
    const r = await fetch("/api/admin/kb/concepts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ save: id, body: draft }),
    }).then(x => x.json()).catch(() => ({ error: "save failed" }));
    if (r.error) { setErr(r.error); return; }
    setEditing(null);
    if (open) void load(open);
  };

  const title = (slug: string) => spine.find(s => s.slug === slug)?.title ?? slug;

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <p className="text-xs font-bold text-slate-400 uppercase">Library</p>
      {!areas.length && <p className="text-sm text-slate-500">Empty. Nothing has been filed into the library yet.</p>}

      <div className="space-y-1.5">
        {areas.map(a => (
          <div key={a.area} className="rounded-lg border border-line">
            <button onClick={() => pick(a.area)} className="w-full flex items-center justify-between px-3 py-2 text-left">
              <span className="text-sm font-semibold text-brand-dark">{title(a.area)}</span>
              <span className="flex items-center gap-2 text-[11px] text-slate-400">
                {a.pending > 0 && <span className="text-amber-700 font-semibold">{a.pending} waiting</span>}
                <span>{a.active} live</span>
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open === a.area ? "rotate-90" : ""}`} />
              </span>
            </button>

            {open === a.area && (
              <div className="border-t border-line divide-y divide-slate-100">
                {!concepts.length && <p className="px-3 py-2 text-[12px] text-slate-400">Loading…</p>}
                {concepts.map(c => (
                  <div key={c.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-brand-dark truncate">{c.title ?? c.path}</p>
                        <code className="text-[10px] text-slate-400">{c.path}</code>
                      </div>
                      <button onClick={() => { setEditing(editing === c.id ? null : c.id); setDraft(c.body); setErr(""); }}
                        className="text-[11px] font-semibold text-brand-700 hover:underline shrink-0">
                        {editing === c.id ? "Cancel" : "Edit"}
                      </button>
                    </div>

                    {editing === c.id ? (
                      <div className="mt-2 space-y-2">
                        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={8}
                          className="w-full border border-line rounded-lg p-2 text-[12px] font-mono leading-relaxed" />
                        {err && <p className="text-[11px] text-red-600">{err}</p>}
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-slate-400">Saving re-embeds this concept only.</p>
                          <button onClick={() => save(c.id)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-700 text-white hover:bg-brand-900">Save</button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{c.body.slice(0, 180)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function KbStructureGuide() {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left group">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400 uppercase">How the library is organised</p>
          <p className="text-sm text-slate-500 mt-0.5">
            Subject areas are worked out from your own content, so the assistant answers from one place per subject instead of from every document that mentions it.
          </p>
        </div>
        <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-4 pt-1">
          <div className="rounded-lg border border-line p-3 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase">Where things get filed</p>
            <p className="text-[12px] leading-relaxed text-slate-600">
              When you upload, each piece of content is read and filed under the subject it is about — in <i>your</i> business&apos;s
              words, not a template. It joins an existing area when it fits and starts a new one only when nothing does, so you end up
              with a handful of broad areas rather than a folder per file. Areas can be renamed by moving a concept to a differently
              named one. If no AI key is connected, a simple keyword pass files what it can and leaves the rest unfiled for you to place.
            </p>
          </div>

          <div className="rounded-lg border border-line p-3 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase">Uploading for the best answers</p>
            <ul className="text-[12px] leading-relaxed text-slate-600 space-y-1.5">
              <li><b className="text-brand-dark">Use headings.</b> Every heading becomes one answerable concept. A document with no headings is split mechanically and flagged for review.</li>
              <li><b className="text-brand-dark">Prefer Markdown or text over PDF.</b> PDF extraction loses heading structure, so a long PDF may not split into concepts at all.</li>
              <li><b className="text-brand-dark">One subject per heading.</b> Keep a figure and its conditions together — a price separated from what it covers gets quoted without them.</li>
              <li><b className="text-brand-dark">Do not re-upload the same knowledge in another format.</b> A second copy does not add anything; it gives the assistant a second answer to choose between.</li>
              <li><b className="text-brand-dark">Leave out content customers never ask about.</b> Blog and SEO articles are not what a sales assistant should answer from, and they can easily outnumber the real knowledge.</li>
              <li><b className="text-brand-dark">Tag by audience, not by source.</b> The tag decides which numbers may use a document. &ldquo;brochure&rdquo; describes where it came from, which the system already records on its own.</li>
            </ul>
          </div>

          <div className="rounded-lg border border-line p-3 space-y-2">
            <p className="text-xs font-bold text-slate-400 uppercase">When two documents disagree</p>
            <ol className="text-[12px] leading-relaxed text-slate-600 space-y-1 list-decimal pl-4">
              <li><b className="text-brand-dark">Website</b> — public and kept current, so it is treated as the most accurate.</li>
              <li><b className="text-brand-dark">Brochure</b> — a snapshot, which goes stale between printings.</li>
              <li><b className="text-brand-dark">Everything else</b> — mail templates, exports, older knowledge bases.</li>
            </ol>
            <p className="text-[11px] text-slate-500">
              A higher-ranked source replaces a lower-ranked one automatically and the old version is kept, so the
              change can be traced. A lower-ranked one never overrides: it is filed away unpublished. Only two
              sources of <em>equal</em> rank reach the review queue, because no ranking can settle those.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-snug text-amber-800">
              An upload that <b>contradicts</b> a published answer is held for review rather than going live, and the current
              answer keeps being used until someone decides between them. Uploading can never silently change what the
              assistant tells a lead.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
