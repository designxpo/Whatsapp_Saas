"use client";

// Lead profile drawer — the full single-lead view (sales brief, CRM snapshot,
// attributes, tags, conversation + campaign history). Rendered by BOTH the Live
// Chat ChatView and the Contacts table, so it lives in its own shared module
// (its own webpack chunk) rather than inside either tab. Pure relocation.
import { useState, useEffect, useCallback } from "react";
import { Loader2, X, MessageSquare, Sparkles, RefreshCw, Database } from "lucide-react";
import { inp, type GoTo } from "../_shared";

type SalesBrief = { temperature: "hot" | "warm" | "cold"; summary: string; interestedIn: string; intent: string; objections: string; nextStep: string; talkingPoints: string[] };
type CrmLead = { id: string; stage: string | null; owner: string | null; score: number | null; source: string | null; fields: { label: string; value: string }[] };
type LeadProfile = {
  contact: { id: string; phone: string; name: string; email: string | null; tags: string[]; attributes: Record<string, string>; status: string; source: string | null; createdAt: string };
  conversation: { id: string; status: string; botEnabled: boolean; assignedTo: string | null; labels: string[]; lastInboundAt: string | null; lastOutboundAt: string | null } | null;
  messages: { role: string; body: string; source: string; createdAt: string }[];
  msgCounts: { inbound: number; outbound: number };
  campaigns: { name: string; status: string; sentAt: string }[];
  clicks: { url: string; clicks: number; at: string | null }[];
};

function ContactProfile({ phone, onClose, onChanged, goTo }: { phone: string; onClose: () => void; onChanged: () => void; goTo: GoTo }) {
  const [p, setP] = useState<LeadProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [attrKey, setAttrKey] = useState("");
  const [attrVal, setAttrVal] = useState("");
  const [edit, setEdit] = useState<{ name: string; email: string } | null>(null);
  const [brief, setBrief] = useState<SalesBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefErr, setBriefErr] = useState<string | null>(null);
  const [crm, setCrm] = useState<{ configured: boolean; lead: CrmLead | null } | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    setNotFound(false);
    fetch(`/api/admin/contacts/profile?phone=${encodeURIComponent(phone)}`).then(r => r.json())
      .then(d => { if (d.contact) setP(d); else { setP(null); setNotFound(true); } })
      .catch(() => setNotFound(true));
  }, [phone]);
  // CRM snapshot (LeadSquared) — best-effort, silent when LSQ isn't configured.
  useEffect(() => {
    setCrm(null); setBrief(null); setBriefErr(null);
    fetch(`/api/admin/contacts/crm?phone=${encodeURIComponent(phone)}`).then(r => r.json()).then(setCrm).catch(() => {});
  }, [phone]);

  async function genBrief() {
    setBriefBusy(true); setBriefErr(null);
    try {
      const d = await fetch("/api/admin/contacts/brief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) }).then(r => r.json());
      if (d.brief) setBrief(d.brief); else setBriefErr(d.error || "Could not generate the brief.");
    } catch { setBriefErr("Connection error."); }
    finally { setBriefBusy(false); }
  }
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch("/api/admin/contacts/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, ...body }) });
      load(); onChanged();
    } finally { setBusy(false); }
  }

  async function toggleOptout() {
    if (!p) return;
    const active = p.contact.status === "active";
    if (active && !confirm(`Opt ${p.contact.name || phone} out? They'll stop receiving all broadcasts.`)) return;
    setBusy(true);
    try {
      await fetch("/api/admin/optouts", {
        method: active ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(active ? { phone, reason: "added by team" } : { phone }),
      });
      load(); onChanged();
    } finally { setBusy(false); }
  }

  const c = p?.contact;
  const adAttrs = c ? Object.entries(c.attributes).filter(([k]) => k.startsWith("ad_")) : [];
  const leadAttrs = c ? Object.entries(c.attributes).filter(([k]) => !k.startsWith("ad_")) : [];
  const reads = p?.campaigns.filter(x => x.status === "read").length ?? 0;
  const lastActive = p?.conversation?.lastInboundAt;
  const sectionTitle = "text-[11px] font-bold text-slate-400 uppercase tracking-[0.06em]";
  const logStatus = (s: string) =>
    s === "read" ? "bg-brand-100 text-brand-700" : s === "delivered" ? "bg-brand-50 text-brand-700"
    : s === "sent" ? "bg-canvas text-ink-600" : s === "failed" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700";

  return (
    <>
      <div className="fixed inset-0 bg-ink-950/20 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 w-[460px] max-w-full bg-white border-l border-line shadow-2xl z-50 overflow-y-auto">
        {!c ? (notFound ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-slate-500">No profile found for this contact yet.</p>
            <button onClick={onClose} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas">Close</button>
          </div>
        ) : <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-300" /></div>) : (
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-lg font-bold shrink-0">
                {(c.name || c.phone).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                {edit ? (
                  <div className="space-y-1.5">
                    <input className={`${inp} w-full`} placeholder="Name" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} />
                    <input className={`${inp} w-full`} placeholder="email@example.com" value={edit.email} onChange={e => setEdit({ ...edit, email: e.target.value })} />
                    <div className="flex gap-2">
                      <button disabled={busy} onClick={() => { patch({ name: edit.name.trim(), email: edit.email.trim() || null }); setEdit(null); }} className="px-3 py-1 rounded-lg bg-brand-700 text-white text-xs font-bold">Save</button>
                      <button onClick={() => setEdit(null)} className="text-xs text-slate-400 font-bold">cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-base font-extrabold text-ink-900 truncate">{c.name || "Unnamed lead"}
                      <button onClick={() => setEdit({ name: c.name, email: c.email ?? "" })} className="ml-2 text-[11px] font-bold text-brand-700 hover:underline">edit</button>
                    </p>
                    <p className="text-xs font-mono text-ink-600">{c.phone}</p>
                    <p className="text-[11px] text-slate-400 truncate">{c.email || "no email"} · {c.source?.toUpperCase() ?? "—"} · lead since {new Date(c.createdAt).toLocaleDateString()}</p>
                  </>
                )}
              </div>
              <button onClick={onClose} className="p-1.5 text-ink-400 hover:text-ink-900 shrink-0"><X className="w-4 h-4" /></button>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={() => { onClose(); goTo("livechat", { openPhone: phone }); }} className="flex-1 px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center justify-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Open chat</button>
              <button disabled={busy} onClick={toggleOptout} className={`flex-1 px-3 py-2 rounded-control border text-xs font-bold ${c.status === "active" ? "border-red-200 text-red-600 hover:bg-red-50" : "border-brand-200 text-brand-700 hover:bg-brand-50"}`}>
                {c.status === "active" ? "Opt out" : "Re-subscribe"}
              </button>
            </div>

            {/* AI sales brief */}
            <div className="rounded-control border border-brand-100 bg-brand-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-brand-700 uppercase tracking-[0.06em] flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Sales brief</p>
                <button disabled={briefBusy} onClick={genBrief} className="text-[11px] font-bold text-brand-700 hover:underline flex items-center gap-1 disabled:opacity-50">
                  {briefBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} {brief ? "Regenerate" : "Generate"}
                </button>
              </div>
              {briefErr && <p className="text-[11px] text-red-600">{briefErr}</p>}
              {!brief && !briefBusy && !briefErr && <p className="text-xs text-slate-500">One tap to summarise this lead for your call — their interest, intent, objections, and the best next step.</p>}
              {briefBusy && !brief && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the conversation…</p>}
              {brief && (
                <div className="space-y-1.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${brief.temperature === "hot" ? "bg-red-100 text-red-700" : brief.temperature === "warm" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                    {brief.temperature === "hot" ? "🔥 HOT" : brief.temperature === "warm" ? "🌤 WARM" : "❄️ COLD"} LEAD
                  </span>
                  <p className="text-xs text-ink-900">{brief.summary}</p>
                  <div className="text-xs text-ink-700 space-y-0.5">
                    <p><span className="font-semibold text-slate-500">Interested in:</span> {brief.interestedIn}</p>
                    <p><span className="font-semibold text-slate-500">Intent:</span> {brief.intent}</p>
                    <p><span className="font-semibold text-slate-500">Objections:</span> {brief.objections}</p>
                    <p><span className="font-semibold text-brand-700">Next step:</span> {brief.nextStep}</p>
                  </div>
                  {brief.talkingPoints.length > 0 && (
                    <ul className="list-disc pl-4 text-xs text-ink-700 space-y-0.5">
                      {brief.talkingPoints.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  )}
                  <p className="text-[10px] text-slate-400 pt-0.5">AI-generated from this lead&apos;s chat — verify before acting.</p>
                </div>
              )}
            </div>

            {/* LeadSquared CRM snapshot */}
            {crm?.lead && (() => {
              const rows: [string, string][] = [
                ...(crm.lead.stage ? [["Stage", crm.lead.stage] as [string, string]] : []),
                ...(crm.lead.owner ? [["Owner", crm.lead.owner] as [string, string]] : []),
                ...(crm.lead.score != null ? [["Score", String(crm.lead.score)] as [string, string]] : []),
                ...(crm.lead.source ? [["Source", crm.lead.source] as [string, string]] : []),
                ...crm.lead.fields.map(f => [f.label, f.value] as [string, string]),
              ];
              return (
                <div className="space-y-2">
                  <p className={`${sectionTitle} flex items-center gap-1.5`}><Database className="w-3.5 h-3.5" /> LeadSquared CRM</p>
                  <div className="border border-line rounded-control divide-y divide-line">
                    {rows.map(([k, v]) => (
                      <div key={k} className="px-3 py-1.5 flex items-start justify-between gap-3">
                        <span className="text-[11px] font-semibold text-slate-400 pt-0.5">{k}</span>
                        <span className="text-xs text-ink-900 text-right flex-1">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Engagement summary */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Msgs from lead", value: p?.msgCounts.inbound ?? 0 },
                { label: "Replies to lead", value: p?.msgCounts.outbound ?? 0 },
                { label: "Campaigns read", value: `${reads}/${p?.campaigns.length ?? 0}` },
              ].map(s => (
                <div key={s.label} className="bg-canvas rounded-control p-2.5 text-center">
                  <p className="text-base font-extrabold text-ink-900">{s.value}</p>
                  <p className="text-[10px] text-slate-500 font-semibold">{s.label}</p>
                </div>
              ))}
            </div>
            {lastActive && <p className="text-[11px] text-slate-400 -mt-2">Last heard from: {new Date(lastActive).toLocaleString()}</p>}

            {/* Ad attribution */}
            {adAttrs.length > 0 && (
              <div className="bg-brand-50 border border-brand-100 rounded-control px-3 py-2.5">
                <p className="text-[11px] font-bold text-brand-700 uppercase mb-1">Came from a Meta ad</p>
                {adAttrs.map(([k, v]) => <p key={k} className="text-xs text-brand-900"><span className="font-mono text-brand-700">{k.replace("ad_", "")}</span>: {v}</p>)}
              </div>
            )}

            {/* Lead details (attributes) */}
            <div className="space-y-2">
              <p className={sectionTitle}>Lead details — collected by AI, flows & forms</p>
              {leadAttrs.length === 0 && <p className="text-xs text-slate-400">Nothing collected yet — details appear here as the AI, chatbot flows, and WhatsApp forms learn about this lead.</p>}
              {leadAttrs.length > 0 && (
                <div className="border border-line rounded-control divide-y divide-line">
                  {leadAttrs.map(([k, v]) => (
                    <div key={k} className="px-3 py-1.5 flex items-start justify-between gap-3">
                      <span className="text-[11px] font-semibold text-slate-400 pt-0.5">{k}</span>
                      <span className="text-xs text-ink-900 text-right flex-1">{v}</span>
                      <button disabled={busy} onClick={() => { const next = { ...c.attributes }; delete next[k]; patch({ attributes: next }); }} className="text-ink-300 hover:text-red-500 text-xs">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <input className={`${inp} w-28 !py-1.5 text-xs`} placeholder="field" value={attrKey} onChange={e => setAttrKey(e.target.value)} />
                <input className={`${inp} flex-1 !py-1.5 text-xs`} placeholder="value (e.g. Data Science)" value={attrVal} onChange={e => setAttrVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && attrKey.trim() && attrVal.trim()) { patch({ attributes: { ...c.attributes, [attrKey.trim()]: attrVal.trim() } }); setAttrKey(""); setAttrVal(""); } }} />
                <button disabled={busy || !attrKey.trim() || !attrVal.trim()} onClick={() => { patch({ attributes: { ...c.attributes, [attrKey.trim()]: attrVal.trim() } }); setAttrKey(""); setAttrVal(""); }} className="px-2.5 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50">+</button>
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <p className={sectionTitle}>Tags</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {c.tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
                    {t}<button disabled={busy} onClick={() => patch({ tags: c.tags.filter(x => x !== t) })} className="text-brand-700/50 hover:text-red-500">×</button>
                  </span>
                ))}
                <input className="border border-line rounded-full px-2.5 py-0.5 text-[11px] w-24 focus:outline-none" placeholder="+ tag" value={tagInput} onChange={e => setTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && tagInput.trim()) { patch({ tags: [...c.tags, tagInput.trim()] }); setTagInput(""); } }} />
              </div>
            </div>

            {/* Conversation snapshot */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className={sectionTitle}>Conversation</p>
                {p?.conversation && <button onClick={() => { onClose(); goTo("livechat", { openPhone: phone }); }} className="text-[11px] font-bold text-brand-700 hover:underline">Open in Live Chat →</button>}
              </div>
              {!p?.conversation ? <p className="text-xs text-slate-400">No conversation yet — they haven&apos;t messaged you, or you haven&apos;t broadcast to them.</p> : (
                <>
                  <p className="text-[11px] text-slate-500">
                    {p.conversation.status === "escalated" ? "🔴 Escalated to a human" : p.conversation.botEnabled ? "🤖 AI is replying" : "👤 Human handling (bot off)"}
                    {p.conversation.assignedTo ? ` · assigned to ${p.conversation.assignedTo}` : ""}
                  </p>
                  <div className="border border-line rounded-control divide-y divide-line max-h-44 overflow-y-auto">
                    {p.messages.map((m, i) => (
                      <div key={i} className="px-3 py-1.5">
                        <p className="text-[10px] font-bold text-slate-400">{m.role === "user" ? c.name || "Lead" : m.source === "agent" ? "Team" : "AI"} · {new Date(m.createdAt).toLocaleString()}</p>
                        <p className="text-xs text-ink-900 line-clamp-2">{m.body}</p>
                      </div>
                    ))}
                    {p.messages.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">No messages yet.</p>}
                  </div>
                </>
              )}
            </div>

            {/* Campaign history */}
            <div className="space-y-2">
              <p className={sectionTitle}>Campaigns received</p>
              {(p?.campaigns.length ?? 0) === 0 ? <p className="text-xs text-slate-400">No broadcasts sent to this lead yet.</p> : (
                <div className="border border-line rounded-control divide-y divide-line">
                  {p?.campaigns.map((x, i) => (
                    <div key={i} className="px-3 py-1.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink-900 truncate">{x.name}</p>
                        <p className="text-[10px] text-slate-400">{new Date(x.sentAt).toLocaleString()}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${logStatus(x.status)}`}>{x.status.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Link clicks */}
            {(p?.clicks.length ?? 0) > 0 && (
              <div className="space-y-2">
                <p className={sectionTitle}>Links they tapped</p>
                <div className="border border-line rounded-control divide-y divide-line">
                  {p?.clicks.map((l, i) => (
                    <div key={i} className="px-3 py-1.5">
                      <p className="text-xs text-brand-700 truncate">{l.url}</p>
                      <p className="text-[10px] text-slate-400">{l.clicks}× {l.at ? `· first on ${new Date(l.at).toLocaleString()}` : ""}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

export { ContactProfile };
