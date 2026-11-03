"use client";

// The review inbox: every review (Google-imported and pasted by hand) with its
// reply, in views an owner works through — Needs approval, Unanswered,
// Complaints, Replied, Failed — with filters, search, paging and the reasons a
// reply is waiting. Google reviews post to Google; pasted reviews never claim
// to: their reply is copied and marked posted by hand.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, RefreshCw, Search, Send, Sparkles, Star, Trash2 } from "lucide-react";
import { inp } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";

export type ReplyStatus = "none" | "draft" | "posted";
export interface InboxReview {
  id: string; source: "google" | "manual"; channelId: string | null; locationName: string | null;
  author: string; rating: number; text: string; reviewCreatedAt: string | null; createdAt: string;
  replyText: string | null; replyStatus: ReplyStatus; replySource: "talko" | "google" | "manual" | null; postedAt: string | null;
  approvalReasons: string[]; isComplaint: boolean; postError: string | null; draftError: string | null;
}
export interface LocationInfo {
  id: string; name: string;
  sync: null | { ok: boolean; error: string | null; kind: string | null; at: string; lastSuccessAt: string | null; failures: number; importingHistory: boolean; averageRating: number | null; totalReviewCount: number | null; mapsUri: string | null; reviewUri: string | null };
}
export interface InboxMeta { settings: { autoMinStars: number } & Record<string, unknown>; locations: LocationInfo[]; emailAlertsAvailable: boolean }

type View = "all" | "approval" | "unanswered" | "complaints" | "replied" | "failed";
const VIEWS: { key: View; label: string; empty: string }[] = [
  { key: "all", label: "All", empty: "No reviews match these filters." },
  { key: "approval", label: "Needs approval", empty: "Nothing is waiting for your approval." },
  { key: "unanswered", label: "Unanswered", empty: "Every review has a public reply." },
  { key: "complaints", label: "Complaints", empty: "No complaints match these filters." },
  { key: "replied", label: "Replied", empty: "No replied reviews match these filters." },
  { key: "failed", label: "Failed", empty: "No replies have failed to post." },
];

const shortDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

function Stars({ n }: { n: number }) {
  if (!n) return <span className="text-[11px] font-semibold text-ink-500">No star rating</span>;
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(i => <Star key={i} aria-hidden className={`w-3.5 h-3.5 ${i <= n ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />)}
    </span>
  );
}

interface Filters { location: string; rating: string; status: string; from: string; to: string; q: string; sort: "newest" | "oldest_unanswered" }
const NO_FILTERS: Filters = { location: "", rating: "", status: "", from: "", to: "", q: "", sort: "newest" };

export function ReviewInbox({ reloadKey, focusId, isAdmin, onMeta, onClearFocus }: {
  reloadKey: number; focusId: string | null; isAdmin: boolean;
  onMeta: (m: InboxMeta) => void; onClearFocus: () => void;
}) {
  const ask = useConfirm();
  const [view, setView] = useState<View>("all");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ reviews: InboxReview[]; total: number; pageSize: number; counts: Record<View, number>; setupPending: boolean; focus: InboxReview | null; locations: LocationInfo[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  // Search waits for a pause in typing.
  useEffect(() => { const t = setTimeout(() => setFilters(f => (f.q === search ? f : { ...f, q: search })), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [view, filters]);

  const qs = useMemo(() => {
    const p = new URLSearchParams({ view, page: String(page), pageSize: "20", sort: filters.sort });
    for (const k of ["location", "rating", "status", "from", "to", "q"] as const) if (filters[k]) p.set(k, filters[k]);
    if (focusId) p.set("id", focusId);
    return p.toString();
  }, [view, page, filters, focusId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/reviews?${qs}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "Reviews couldn't be loaded."); return; }
      setData(d);
      onMetaRef.current({ settings: d.settings, locations: d.locations ?? [], emailAlertsAvailable: !!d.emailAlertsAvailable });
    } catch {
      setError("Couldn't reach Talko — check your connection and try again.");
    } finally { setLoading(false); }
  }, [qs]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const locName = (r: InboxReview) => (r.channelId && data?.locations.find(l => l.id === r.channelId)?.name) || r.locationName || (r.source === "manual" ? "Pasted by hand" : "Google");
  const mapsUri = (r: InboxReview) => (r.channelId && data?.locations.find(l => l.id === r.channelId)?.sync?.mapsUri) || null;
  const draftOf = (r: InboxReview) => drafts[r.id] ?? r.replyText ?? "";

  async function act(r: InboxReview, action: "generate" | "save" | "post" | "unpost", text?: string) {
    setBusy(r.id); setNotice(null);
    try {
      const res = await fetch("/api/admin/reviews/reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, action, text }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ id: r.id, ok: false, text: d.error || "That didn't work." }); await load(); return; }
      setDrafts(dr => { const n = { ...dr }; delete n[r.id]; return n; });
      setEditing(ed => ({ ...ed, [r.id]: false }));
      setNotice({ id: r.id, ok: true, text: action === "post" ? (r.source === "google" ? "Posted on Google." : "Marked as posted.") : action === "unpost" ? (r.source === "google" ? "Removed from Google. The text is kept as a draft." : "Moved back to draft.") : action === "generate" ? "New AI draft ready — check it before posting." : "Draft saved." });
      await load();
    } finally { setBusy(null); }
  }

  async function postToGoogle(r: InboxReview, text: string) {
    if (!(await ask({
      title: `Post this reply on Google for ${locName(r)}?`,
      message: `It appears publicly under ${r.author || "the customer"}'s review on ${locName(r)}'s Google profile.`,
      confirmLabel: r.replyStatus === "posted" ? "Update on Google" : "Post to Google",
    }))) return;
    await act(r, "post", text);
  }

  async function removeFromGoogle(r: InboxReview) {
    if (!(await ask({
      title: "Remove this reply from Google?", tone: "danger", confirmLabel: "Remove from Google",
      message: `It disappears from ${locName(r)}'s Google profile. The text is kept here as a draft, so you can edit it and post again.`,
    }))) return;
    await act(r, "unpost");
  }

  async function del(r: InboxReview) {
    if (!(await ask({
      title: "Delete this review from Talko?", tone: "danger", confirmLabel: "Delete review",
      message: r.source === "google" ? "It's removed from Talko only — the review and any reply stay on Google." : "The pasted review and its draft are removed from Talko.",
    }))) return;
    await fetch("/api/admin/reviews", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) }).catch(() => {});
    if (r.id === focusId) onClearFocus();
    load();
  }

  function copy(r: InboxReview, text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(r.id); setTimeout(() => setCopied(c => (c === r.id ? null : c)), 1500);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Object.entries(filters).some(([k, v]) => k !== "sort" && v) || filters.sort !== "newest";
  const focus = data?.focus && !data.reviews.some(r => r.id === data.focus!.id) ? data.focus : null;

  const card = (r: InboxReview, highlighted = false) => {
    const working = busy === r.id;
    const google = r.source === "google";
    const draft = draftOf(r);
    const isEditing = !!editing[r.id];
    const posted = r.replyStatus === "posted";
    const maps = google ? mapsUri(r) : null;
    return (
      <article key={r.id} id={`review-${r.id}`} aria-label={`Review by ${r.author || "a customer"}`}
        className={`rounded-card border bg-white p-4 space-y-3 ${highlighted ? "border-brand-700 ring-2 ring-brand-100" : "border-line"}`}>
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Stars n={r.rating} />
              <span className="text-sm font-semibold text-ink-900">{r.author || "Anonymous"}</span>
              <span className="text-[11px] text-ink-500 tabular-nums">· {shortDate(r.reviewCreatedAt ?? r.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] font-bold">
              {google
                ? <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">Google · {locName(r)}</span>
                : <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600" title="Pasted into Talko by hand. Talko can't publish anything for it on Google.">Pasted by hand — not linked to Google</span>}
              {r.isComplaint && <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">Complaint</span>}
              {posted
                ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700"><Check className="w-3 h-3" aria-hidden /> {google ? (r.replySource === "google" ? "Replied on Google directly" : "Replied on Google") : "Marked posted"}</span>
                : r.replyStatus === "draft"
                  ? <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">Waiting for approval</span>
                  : <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">No reply yet</span>}
              {r.postError && !posted && <span className="px-1.5 py-0.5 rounded-full bg-red-600 text-white">Post failed</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {maps && <a href={maps} target="_blank" rel="noopener noreferrer" className="p-1.5 text-ink-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg" title={`Open ${locName(r)} on Google Maps`} aria-label={`Open ${locName(r)} on Google Maps`}><ExternalLink className="w-4 h-4" /></a>}
            {isAdmin && <button onClick={() => del(r)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Delete from Talko" aria-label="Delete review from Talko"><Trash2 className="w-4 h-4" /></button>}
          </div>
        </header>

        {r.text ? <p className="text-sm text-ink-700 whitespace-pre-wrap">{r.text}</p> : <p className="text-sm text-ink-400 italic">Rating only — no written review.</p>}

        {!posted && r.approvalReasons.length > 0 && (
          <div className="rounded-control bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">
            <p className="font-bold">Why this waits for you</p>
            <ul className="list-disc ml-4 mt-0.5 space-y-0.5">{r.approvalReasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {!posted && r.postError && (
          <p className="rounded-control bg-red-50 border border-red-200 px-3 py-2 text-[12px] text-red-800" role="alert">
            <b>Google refused the last post:</b> {r.postError} Check the reply, then post again.
          </p>
        )}
        {r.replyStatus === "none" && r.draftError && <p className="text-[12px] text-amber-800">{r.draftError}</p>}

        {r.replyStatus === "none" && !r.replyText ? (
          isAdmin && (
            <button onClick={() => act(r, "generate")} disabled={working} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-brand-50 border border-brand-100 text-brand-700 text-xs font-bold hover:bg-brand-100 disabled:opacity-60">
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generate AI reply
            </button>
          )
        ) : (
          <div className="rounded-control border border-line bg-canvas/50 p-2.5 space-y-2">
            <p className="text-[11px] font-bold text-ink-500">
              {posted ? (google ? "Your public reply on Google" : "Your reply (marked posted)") : "Draft reply — not public"}
              {posted && r.postedAt ? ` · ${shortDate(r.postedAt)}` : ""}
              {isEditing && google ? " — saving replaces it on Google" : ""}
            </p>
            <textarea aria-label={`Reply to ${r.author || "this review"}`} className={`${inp} w-full bg-white`} rows={3} value={draft}
              disabled={!isAdmin || (posted && !isEditing)} onChange={e => setDrafts(dr => ({ ...dr, [r.id]: e.target.value }))} />
            {isAdmin && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {!posted && <>
                  <button onClick={() => act(r, "generate")} disabled={working} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white disabled:opacity-60">
                    {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Regenerate
                  </button>
                  <button onClick={() => act(r, "save", draft)} disabled={working} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white disabled:opacity-60">Save draft</button>
                </>}
                {!google && (
                  <button onClick={() => copy(r, draft)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-white">
                    {copied === r.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copied === r.id ? "Copied" : "Copy reply"}
                  </button>
                )}
                <div className="flex-1" />
                {posted ? (isEditing ? <>
                  <button onClick={() => { setEditing(ed => ({ ...ed, [r.id]: false })); setDrafts(dr => { const n = { ...dr }; delete n[r.id]; return n; }); }} disabled={working} className="px-2.5 py-1 rounded-control text-xs font-bold text-ink-500 hover:bg-white disabled:opacity-60">Cancel</button>
                  <button onClick={() => (google ? postToGoogle(r, draft) : act(r, "post", draft))} disabled={working || !draft.trim() || draft.trim() === (r.replyText ?? "").trim()} className="inline-flex items-center gap-1 px-3 py-1 rounded-control bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-60">{working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {google ? "Update on Google" : "Save reply"}</button>
                </> : <>
                  {google
                    ? <button onClick={() => removeFromGoogle(r)} disabled={working} className="px-2.5 py-1 rounded-control text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-60">Remove from Google</button>
                    : <button onClick={() => act(r, "unpost")} disabled={working} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-500 hover:bg-white disabled:opacity-60">Mark as draft</button>}
                  <button onClick={() => setEditing(ed => ({ ...ed, [r.id]: true }))} disabled={working} className="px-3 py-1 rounded-control border border-line bg-white text-xs font-bold text-ink-700 hover:bg-canvas disabled:opacity-60">Edit reply</button>
                </>) : google
                  ? <button onClick={() => postToGoogle(r, draft)} disabled={working || !draft.trim()} className="inline-flex items-center gap-1 px-3 py-1 rounded-control bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold disabled:opacity-60">{working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {r.postError ? "Try posting again" : "Post to Google"}</button>
                  : <button onClick={() => act(r, "post", draft)} disabled={working || !draft.trim()} title="Records that you posted this reply on Google yourself" className="inline-flex items-center gap-1 px-3 py-1 rounded-control bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold disabled:opacity-60"><Check className="w-3.5 h-3.5" /> Mark posted</button>}
              </div>
            )}
            {!google && !posted && isAdmin && <p className="text-[11px] text-ink-500">Copy this reply, paste it under the review on Google yourself, then choose Mark posted.</p>}
          </div>
        )}
        {notice?.id === r.id && <p className={`text-[12px] font-semibold ${notice.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{notice.text}</p>}
      </article>
    );
  };

  return (
    <section className="space-y-3" aria-label="Review inbox">
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Review views">
        {VIEWS.map(v => (
          <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1 rounded-full text-xs font-bold border tabular-nums ${view === v.key ? "bg-ink-900 text-white border-ink-900" : "bg-white text-ink-600 border-line hover:bg-canvas"} ${v.key === "failed" && (data?.counts.failed ?? 0) > 0 && view !== v.key ? "text-red-700 border-red-200" : ""}`}>
            {v.label} {data ? data.counts[v.key] : ""}
          </button>
        ))}
      </div>

      <div className="rounded-card border border-line bg-white p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end">
        <label className="col-span-2 sm:col-span-4 lg:col-span-2 text-[11px] font-bold text-ink-500 space-y-1">
          <span>Search</span>
          <span className="relative block">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <input className={`${inp} w-full pl-8`} placeholder="Review text or reviewer name" value={search} onChange={e => setSearch(e.target.value)} />
          </span>
        </label>
        <label className="text-[11px] font-bold text-ink-500 space-y-1">
          <span>Location</span>
          <select className={`${inp} w-full`} value={filters.location} onChange={e => setFilters({ ...filters, location: e.target.value })}>
            <option value="">All locations</option>
            {(data?.locations ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="manual">Pasted by hand</option>
          </select>
        </label>
        <label className="text-[11px] font-bold text-ink-500 space-y-1">
          <span>Rating</span>
          <select className={`${inp} w-full`} value={filters.rating} onChange={e => setFilters({ ...filters, rating: e.target.value })}>
            <option value="">Any rating</option>
            {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}★</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-ink-500 space-y-1">
          <span>Reply</span>
          <select className={`${inp} w-full`} value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Any reply status</option>
            <option value="none">No reply yet</option>
            <option value="draft">Draft waiting</option>
            <option value="posted">Replied</option>
          </select>
        </label>
        <label className="text-[11px] font-bold text-ink-500 space-y-1">
          <span>From</span>
          <input type="date" className={`${inp} w-full`} value={filters.from} max={filters.to || undefined} onChange={e => setFilters({ ...filters, from: e.target.value })} />
        </label>
        <label className="text-[11px] font-bold text-ink-500 space-y-1">
          <span>To</span>
          <input type="date" className={`${inp} w-full`} value={filters.to} min={filters.from || undefined} onChange={e => setFilters({ ...filters, to: e.target.value })} />
        </label>
        <label className="col-span-2 sm:col-span-2 lg:col-span-2 text-[11px] font-bold text-ink-500 space-y-1">
          <span>Order</span>
          <select className={`${inp} w-full`} value={filters.sort} onChange={e => setFilters({ ...filters, sort: e.target.value as Filters["sort"] })}>
            <option value="newest">Newest first</option>
            <option value="oldest_unanswered">Oldest unanswered first</option>
          </select>
        </label>
        <div className="col-span-2 sm:col-span-2 lg:col-span-5 flex items-center justify-end gap-2">
          {filtered && <button onClick={() => { setFilters(NO_FILTERS); setSearch(""); }} className="px-2.5 py-1.5 text-xs font-bold text-ink-500 hover:text-ink-900">Clear filters</button>}
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas disabled:opacity-60" aria-label="Refresh the list">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {data?.setupPending && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">Some views are still being set up for your workspace and may look empty for a little while.</p>}
      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800 flex items-center gap-3" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden /> <span className="flex-1">{error}</span>
          <button onClick={load} className="font-bold underline">Try again</button>
        </div>
      )}

      {focus && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-brand-700"><span>Opened from an alert</span><button onClick={onClearFocus} className="text-ink-500 hover:text-ink-900">Dismiss</button></div>
          {card(focus, true)}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading reviews">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-card border border-line bg-white animate-pulse" />)}
        </div>
      ) : data && !data.reviews.length && !error ? (
        <p className="text-sm text-ink-500 py-10 text-center">{filtered ? "No reviews match these filters." : VIEWS.find(v => v.key === view)!.empty}</p>
      ) : (
        <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>{data?.reviews.map(r => card(r, r.id === focusId))}</div>
      )}

      {data && data.total > data.pageSize && (
        <nav className="flex items-center justify-between text-xs" aria-label="Pages">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading} className="px-3 py-1.5 rounded-control border border-line font-bold text-ink-700 hover:bg-canvas disabled:opacity-50">Previous</button>
          <span className="text-ink-500 tabular-nums">Page {page} of {totalPages} · {data.total} reviews</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} className="px-3 py-1.5 rounded-control border border-line font-bold text-ink-700 hover:bg-canvas disabled:opacity-50">Next</button>
        </nav>
      )}
    </section>
  );
}
