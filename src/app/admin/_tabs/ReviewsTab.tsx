"use client";

// Review reply system (Phase 1) — an inbox of business reviews with rating-aware
// AI-drafted replies. Reviews are added manually / pasted for now; a live Google
// Business Profile connection (auto-fetch + one-tap post) lands in Phase 2. The
// auto(4–5★)/draft(1–3★) policy is surfaced per review via the auto threshold.
import { useState, useEffect, useCallback } from "react";
import { Star, Sparkles, Copy, Check, Trash2, Loader2, RefreshCw, Plus, SlidersHorizontal, Send } from "lucide-react";
import { inp } from "../_shared";

type ReplyStatus = "none" | "draft" | "posted";
type Review = {
  id: string; source: string; locationName: string | null; author: string; rating: number; text: string;
  replyText: string | null; replyStatus: ReplyStatus; auto: boolean; postedAt: string | null; createdAt: string;
};
type Settings = { autoMinStars: number; signature: string; tone: string };

function Stars({ n, onPick }: { n: number; onPick?: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" disabled={!onPick} onClick={() => onPick?.(i)}
          className={onPick ? "cursor-pointer" : "cursor-default"} title={onPick ? `${i} star${i > 1 ? "s" : ""}` : undefined}>
          <Star className={`w-4 h-4 ${i <= n ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />
        </button>
      ))}
    </span>
  );
}

export default function ReviewsTab() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettings] = useState<Settings>({ autoMinStars: 4, signature: "", tone: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);   // review id currently working
  const [drafts, setDrafts] = useState<Record<string, string>>({});   // local edits per review
  const [copied, setCopied] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ author: "", rating: 5, text: "", locationName: "" });
  const [settingsForm, setSettingsForm] = useState<Settings>({ autoMinStars: 4, signature: "", tone: "" });
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/reviews").then(r => r.json()).then(d => {
      setReviews(d.reviews ?? []);
      if (d.settings) { setSettings(d.settings); setSettingsForm(d.settings); }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const draftOf = (r: Review) => drafts[r.id] ?? r.replyText ?? "";

  async function addReview() {
    if (!addForm.text.trim() && !addForm.author.trim()) { setMsg("Add the reviewer's name or the review text"); return; }
    setBusy("add"); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(addForm) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setAddForm({ author: "", rating: 5, text: "", locationName: "" }); setShowAdd(false); load(); }
    } finally { setBusy(null); }
  }

  async function reply(id: string, action: "generate" | "save" | "post" | "unpost", text?: string) {
    setBusy(id); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, text }) });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Something went wrong"); return; }
      const updated: Review = d.review;
      setReviews(rs => rs.map(r => (r.id === id ? updated : r)));
      setDrafts(dr => ({ ...dr, [id]: updated.replyText ?? "" }));
    } finally { setBusy(null); }
  }

  async function del(id: string) {
    if (!confirm("Delete this review?")) return;
    await fetch("/api/admin/reviews", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    load();
  }

  async function saveSettings() {
    setSavingSettings(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settingsForm) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setSettings(d.settings); setSettingsForm(d.settings); setShowSettings(false); }
    } finally { setSavingSettings(false); }
  }

  function copy(id: string, text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(id); setTimeout(() => setCopied(c => (c === id ? null : c)), 1500);
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-ink-900 flex items-center gap-2"><Star className="w-5 h-5 text-amber-400" /> Reviews</h1>
          <p className="text-xs text-ink-500 mt-0.5">AI drafts a reply to every review, tuned to the star rating. Approve &amp; post to Google.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => { setShowSettings(s => !s); setShowAdd(false); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> Settings</button>
          <button onClick={() => { setShowAdd(a => !a); setShowSettings(false); }} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add review</button>
        </div>
      </div>

      {/* Phase-1 explainer */}
      <div className="rounded-card border border-amber-200 bg-amber-50/60 px-4 py-3 text-[12px] text-amber-800">
        <b>Google auto-sync is coming.</b> For now, add reviews here (paste them in), let the AI draft a reply, then copy it to Google. Once your Google Business Profile API access is approved, reviews will import automatically and post with one tap — replies to <b>{settings.autoMinStars}★ and up</b> auto-post, lower ratings wait for your approval.
      </div>

      {/* Settings */}
      {showSettings && (
        <div className="rounded-card border border-line bg-white p-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Reply settings</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-ink-700 space-y-1 block">
              Auto-post replies at or above
              <select className={`${inp} w-full`} value={settingsForm.autoMinStars} onChange={e => setSettingsForm({ ...settingsForm, autoMinStars: Number(e.target.value) })}>
                <option value={5}>5★ only</option>
                <option value={4}>4★ and up (recommended)</option>
                <option value={3}>3★ and up</option>
                <option value={6}>Never auto-post (always approve)</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-ink-700 space-y-1 block">
              Signature (optional)
              <input className={`${inp} w-full`} placeholder="— Team Talko" maxLength={120} value={settingsForm.signature} onChange={e => setSettingsForm({ ...settingsForm, signature: e.target.value })} />
            </label>
          </div>
          <label className="text-xs font-semibold text-ink-700 space-y-1 block">
            Brand voice / tone for replies (optional)
            <textarea className={`${inp} w-full`} rows={2} placeholder="e.g. Warm, humble and devotional. Address people respectfully. Never argue." maxLength={600} value={settingsForm.tone} onChange={e => setSettingsForm({ ...settingsForm, tone: e.target.value })} />
          </label>
          <div className="flex items-center gap-2">
            <button onClick={saveSettings} disabled={savingSettings} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{savingSettings ? "Saving…" : "Save settings"}</button>
            <button onClick={() => setShowSettings(false)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
        </div>
      )}

      {/* Add review */}
      {showAdd && (
        <div className="rounded-card border-2 border-brand-500/30 bg-white p-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Add a review</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input className={`${inp} w-full`} placeholder="Reviewer name (optional)" value={addForm.author} onChange={e => setAddForm({ ...addForm, author: e.target.value })} />
            <input className={`${inp} w-full`} placeholder="Location / branch (optional)" value={addForm.locationName} onChange={e => setAddForm({ ...addForm, locationName: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-700">Rating <Stars n={addForm.rating} onPick={v => setAddForm({ ...addForm, rating: v })} /></div>
          <textarea className={`${inp} w-full`} rows={3} placeholder="Paste the review text here…" value={addForm.text} onChange={e => setAddForm({ ...addForm, text: e.target.value })} />
          <div className="flex items-center gap-2">
            <button onClick={addReview} disabled={busy === "add"} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy === "add" ? "Adding…" : "Add review"}</button>
            <button onClick={() => setShowAdd(false)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
        </div>
      )}

      {msg && <p className="text-xs text-red-500">{msg}</p>}

      {/* Review list */}
      {!reviews.length && !showAdd && <p className="text-sm text-ink-400 py-8 text-center">No reviews yet. Tap <b>Add review</b> to paste one and let the AI draft a reply.</p>}

      <div className="space-y-3">
        {reviews.map(r => {
          const working = busy === r.id;
          const meetsAuto = r.rating >= settings.autoMinStars;
          const draft = draftOf(r);
          return (
            <div key={r.id} className="rounded-card border border-line bg-white p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Stars n={r.rating} />
                    <span className="text-sm font-semibold text-ink-900">{r.author || "Anonymous"}</span>
                    {r.locationName && <span className="text-[11px] text-ink-400">· {r.locationName}</span>}
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meetsAuto ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{meetsAuto ? "auto-post" : "needs approval"}</span>
                    {r.replyStatus === "posted" && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600"><Check className="w-3 h-3" /> posted</span>}
                  </div>
                  {r.text && <p className="text-sm text-ink-700 mt-1.5 whitespace-pre-wrap">{r.text}</p>}
                </div>
                <button onClick={() => del(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0" title="Delete review"><Trash2 className="w-4 h-4" /></button>
              </div>

              {/* Reply area */}
              {r.replyStatus === "none" ? (
                <button onClick={() => reply(r.id, "generate")} disabled={working} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-brand-50 border border-brand-100 text-brand-700 text-xs font-bold hover:bg-brand-100 disabled:opacity-60">
                  {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generate AI reply
                </button>
              ) : (
                <div className="rounded-control border border-line bg-canvas/50 p-2.5 space-y-2">
                  <textarea className={`${inp} w-full bg-white`} rows={3} value={draft} disabled={r.replyStatus === "posted"}
                    onChange={e => setDrafts(dr => ({ ...dr, [r.id]: e.target.value }))} />
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {r.replyStatus !== "posted" && <>
                      <button onClick={() => reply(r.id, "generate")} disabled={working} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white disabled:opacity-60">
                        {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Regenerate
                      </button>
                      <button onClick={() => reply(r.id, "save", draft)} disabled={working} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white disabled:opacity-60">Save draft</button>
                    </>}
                    <button onClick={() => copy(r.id, draft)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white">
                      {copied === r.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copied === r.id ? "Copied" : "Copy"}
                    </button>
                    <div className="flex-1" />
                    {r.replyStatus === "posted"
                      ? <button onClick={() => reply(r.id, "unpost")} disabled={working} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-500 hover:bg-white disabled:opacity-60">Mark as draft</button>
                      : <button onClick={() => reply(r.id, "post", draft)} disabled={working} className="inline-flex items-center gap-1 px-3 py-1 rounded-control bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-60"><Send className="w-3.5 h-3.5" /> Mark posted</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
