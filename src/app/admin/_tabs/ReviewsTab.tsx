"use client";

// Review reply system (Phase 1) — an inbox of business reviews with rating-aware
// AI-drafted replies. Reviews are added manually / pasted for now; a live Google
// Business Profile connection (auto-fetch + one-tap post) lands in Phase 2. The
// auto(4–5★)/draft(1–3★) policy is surfaced per review via the auto threshold.
import { useState, useEffect, useCallback } from "react";
import { Star, Sparkles, Copy, Check, Trash2, Loader2, RefreshCw, Plus, SlidersHorizontal, Send, MapPin, Link2, Unlink } from "lucide-react";
import { inp } from "../_shared";

type ReplyStatus = "none" | "draft" | "posted";
type Review = {
  id: string; source: string; locationName: string | null; author: string; rating: number; text: string;
  replyText: string | null; replyStatus: ReplyStatus; auto: boolean; postedAt: string | null; createdAt: string;
};
type Settings = { autoMinStars: number; signature: string; tone: string };
type GrChannel = { id: string; name: string; active: boolean };
type GrLocation = { accountId: string; id: string; name: string; address: string };

// Result flags the Google OAuth callback lands back with (?gr=connected|pick
// &channelId=… / ?gr_error=…).
const GR_ERROR_MESSAGES: Record<string, string> = {
  not_in_plan: "Google review replies are available on Growth and above — upgrade to unlock them.",
  not_configured: "Google isn't configured on this deployment yet (OAuth pending) — ask your platform admin.",
  denied: "Google sign-in was cancelled.",
  state_mismatch: "Something went wrong verifying the request — please try connecting again.",
  exchange_failed: "Google didn't return a valid token — please try connecting again.",
  no_refresh_token: "Google didn't grant offline access. Visit myaccount.google.com/permissions, remove Talko AI's access, then try connecting again.",
  save_failed: "Something went wrong saving the connection — please try again.",
};

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
  // Google Business Profile connection (Phase 2) + its location picker.
  const [grChannel, setGrChannel] = useState<GrChannel | null>(null);
  const [pickerChannelId, setPickerChannelId] = useState<string | null>(null);
  const [pickerLocations, setPickerLocations] = useState<GrLocation[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerBusy, setPickerBusy] = useState<string | null>(null);   // location id currently being saved

  const load = useCallback(() => {
    fetch("/api/admin/reviews").then(r => r.json()).then(d => {
      setReviews(d.reviews ?? []);
      if (d.settings) { setSettings(d.settings); setSettingsForm(d.settings); }
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadGrChannel = useCallback(() => {
    fetch("/api/admin/channels").then(r => r.json()).then(d => {
      const gr = (d.channels ?? []).find((c: { kind?: string; active: boolean }) => c.kind === "google_reviews" && c.active);
      setGrChannel(gr ? { id: gr.id, name: gr.name, active: gr.active } : null);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadGrChannel(); }, [loadGrChannel]);

  // One-time result of the "Connect with Google" redirect flow. Consume it
  // once, then scrub the query string so a refresh doesn't replay it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const gr = params.get("gr");
    const channelId = params.get("channelId");
    const error = params.get("gr_error");
    if (gr === "pick" && channelId) setPickerChannelId(channelId);
    if (gr === "connected") loadGrChannel();
    if (error) setMsg(GR_ERROR_MESSAGES[error] || "Something went wrong connecting Google Reviews.");
    if (gr || error) window.history.replaceState(null, "", window.location.pathname);
  }, [loadGrChannel]);

  useEffect(() => {
    if (!pickerChannelId) { setPickerLocations([]); return; }
    setPickerLoading(true);
    fetch(`/api/admin/reviews/google-locations?channelId=${encodeURIComponent(pickerChannelId)}`)
      .then(r => r.json())
      .then(d => { setPickerLocations(d.locations ?? []); if (d.error) setMsg(d.error); })
      .finally(() => setPickerLoading(false));
  }, [pickerChannelId]);

  async function pickLocation(loc: GrLocation) {
    if (!pickerChannelId) return;
    setPickerBusy(loc.id); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews/google-locations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: pickerChannelId, accountId: loc.accountId, locationId: loc.id, locationName: loc.name }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Save failed"); return; }
      setPickerChannelId(null); setPickerLocations([]); loadGrChannel();
    } finally { setPickerBusy(null); }
  }

  async function disconnectGoogle() {
    if (!grChannel || !confirm("Disconnect this Google Business Profile? Imported reviews stay.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: grChannel.id }) }).catch(() => {});
    setGrChannel(null);
  }

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
          {grChannel ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
              <MapPin className="w-3.5 h-3.5" /> {grChannel.name}
              <button onClick={disconnectGoogle} className="text-emerald-700/60 hover:text-red-600 ml-1" title="Disconnect"><Unlink className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <a href="/api/admin/onboarding/google-reviews/start" className="px-3 py-1.5 rounded-control bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> Connect with Google
            </a>
          )}
          <button onClick={() => { setShowSettings(s => !s); setShowAdd(false); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><SlidersHorizontal className="w-3.5 h-3.5" /> Settings</button>
          <button onClick={() => { setShowAdd(a => !a); setShowSettings(false); }} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add review</button>
        </div>
      </div>

      {/* Location picker — shown right after the OAuth redirect back, until a
          Business Profile location is chosen for this connection. */}
      {pickerChannelId && (
        <div className="rounded-card border-2 border-blue-500/30 bg-white p-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Which Business Profile location is this?</p>
          {pickerLoading && <p className="text-xs text-ink-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your locations…</p>}
          {!pickerLoading && !pickerLocations.length && (
            <p className="text-xs text-amber-600">No locations found on this Google login — make sure you signed in with the account that manages your Business Profile, or that Business Profile API access has been approved for this project.</p>
          )}
          <div className="space-y-1.5">
            {pickerLocations.map(loc => (
              <button key={loc.id} type="button" disabled={!!pickerBusy} onClick={() => pickLocation(loc)}
                className="w-full flex items-center gap-2.5 border border-line rounded-control px-3 py-2 text-left hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-60">
                <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{loc.name}</p>
                  {loc.address && <p className="text-[11px] text-ink-400 truncate">{loc.address}</p>}
                </div>
                {pickerBusy === loc.id && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              </button>
            ))}
          </div>
          <button onClick={() => setPickerChannelId(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
        </div>
      )}

      {/* Phase explainer */}
      <div className="rounded-card border border-amber-200 bg-amber-50/60 px-4 py-3 text-[12px] text-amber-800">
        {grChannel
          ? <><b>Google Business Profile connected.</b> New reviews import automatically and reply per your settings below — <b>{settings.autoMinStars}★ and up</b> auto-post, lower ratings wait as a draft for your approval. Reviews still won&apos;t flow in until Google approves this project&apos;s Business Profile API access request.</>
          : <><b>Connect your Google Business Profile</b> to import reviews automatically and post replies with one tap. Until then, add reviews here (paste them in), let the AI draft a reply, then copy it to Google — replies to <b>{settings.autoMinStars}★ and up</b> would auto-post, lower ratings wait for your approval.</>}
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
