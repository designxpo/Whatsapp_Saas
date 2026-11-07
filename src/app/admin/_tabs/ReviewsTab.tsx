"use client";

// Reviews — connect Google Business Profile locations, see each location's sync
// health, and work the review inbox (ReviewInbox.tsx): AI-drafted replies that
// post on their own only when the rules allow, everything else waiting with the
// reason. Reviews can also be pasted in by hand; those are never published by
// Talko — the reply is copied and marked posted.
import { useBrand } from "@/components/BrandContext";
import { useState, useEffect, useCallback } from "react";
import { Star, Loader2, RefreshCw, Plus, SlidersHorizontal, MapPin, Link2, Unlink, AlertTriangle, ChevronDown, ShieldCheck } from "lucide-react";
import { inp } from "../_shared";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/toast";
import { Drawer, Modal } from "@/components/overlay";
import { ReviewBooster } from "./ReviewBooster";
import { ReviewInbox, type InboxMeta, type LocationInfo } from "./ReviewInbox";
import { ReviewSettingsPanel, type ReviewSettingsValue } from "./ReviewSettingsPanel";
import { takeReviewFocus, onReviewFocus } from "@/lib/review-focus";
import { ReviewReports } from "./ReviewReports";
import { ReviewSetup } from "./ReviewSetup";

type GrLocation = { accountId: string; id: string; name: string; address: string };

// Result flags the Google OAuth callback lands back with (?gr=connected|pick
// &channelId=… / ?gr_error=…).
const GR_ERROR_MESSAGES: Record<string, string> = {
  not_in_plan: "Google review replies are available on Creator Pro, Growth and Scale — upgrade to unlock them.",
  not_configured: "Google sign-in isn't available right now. Please try again later or contact support.",
  denied: "Google sign-in was cancelled.",
  state_mismatch: "This connect link expired or was opened in a different browser or tab than the one that started it — a privacy extension may have blocked a cookie. Click Connect again and complete it in the same tab without navigating away.",
  code_expired: "That sign-in link was already used or took too long to complete — click Connect and finish it in one go.",
  exchange_failed: "Google refused the connection from our side — this isn't something you can fix from here. Contact support and mention \"Reviews exchange_failed\".",
  no_refresh_token: "Google didn't grant ongoing access. Visit myaccount.google.com/permissions, remove Talko AI's access, then try connecting again.",
  save_failed: "Google connected, but saving the connection failed on our side (a temporary hiccup, not a problem with your Google account). Click Connect again.",
};

const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function PickStars({ n, onPick }: { n: number; onPick: (v: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(i => (
        <button key={i} type="button" role="radio" aria-checked={i === n} onClick={() => onPick(i)} title={`${i} star${i > 1 ? "s" : ""}`} aria-label={`${i} star${i > 1 ? "s" : ""}`} className="grid h-8 w-8 place-items-center rounded-control hover:bg-canvas">
          <Star className={`w-4 h-4 ${i <= n ? "text-amber-400 fill-amber-400" : "text-slate-300"}`} />
        </button>
      ))}
    </span>
  );
}

export default function ReviewsTab({ isAdmin = true }: { isAdmin?: boolean }) {
  const brand = useBrand();
  const who = brand.partnerId ? brand.name : "Talko";   // the name in-app copy uses
  const ask = useConfirm();
  const [meta, setMeta] = useState<InboxMeta | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey(k => k + 1);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [mode, setMode] = useState<"inbox" | "insights">("inbox");
  const [msg, setMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ author: "", rating: 5, text: "", locationName: "" });
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [pickerChannelId, setPickerChannelId] = useState<string | null>(null);
  const [pickerLocations, setPickerLocations] = useState<GrLocation[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState<string | null>(null);   // location id currently being saved

  const locations: LocationInfo[] = Array.isArray(meta?.locations) ? meta.locations : [];
  const settings = meta?.settings as unknown as ReviewSettingsValue | undefined;

  // One-time results: the "Connect with Google" redirect, or an alert/email
  // link to one review (?review=<id>). Consumed once, then scrubbed so a
  // refresh doesn't replay them.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const gr = params.get("gr");
    const channelId = params.get("channelId");
    const error = params.get("gr_error");
    const review = params.get("review") ?? takeReviewFocus();
    if (gr === "pick" && channelId) setPickerChannelId(channelId);
    if (error) setMsg(GR_ERROR_MESSAGES[error] || "Something went wrong connecting Google Reviews.");
    if (review) setFocusId(review);
    if (gr || error || review) {
      params.delete("gr"); params.delete("channelId"); params.delete("gr_error"); params.delete("review");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
  }, []);

  // The bell asking for a review while this tab is already open.
  useEffect(() => onReviewFocus(id => { setFocusId(id); setMode("inbox"); window.scrollTo({ top: 0, behavior: "smooth" }); }), []);

  useEffect(() => {
    if (!pickerChannelId) { setPickerLocations([]); return; }
    setPickerLoading(true); setPickerError(null);
    fetch(`/api/admin/reviews/google-locations?channelId=${encodeURIComponent(pickerChannelId)}`)
      .then(r => r.json())
      .then(d => { setPickerLocations(d.locations ?? []); setPickerError(d.error ?? null); })
      .catch(() => setPickerError("Couldn't reach the server — check your connection and try again."))
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
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Couldn't save that location. Please try again."); return; }
      setPickerChannelId(null); setPickerLocations([]);
      toast(`${loc.name} is connected — its reviews arrive within a few minutes`);
      reload();
    } finally { setPickerBusy(null); }
  }

  async function disconnect(l: LocationInfo) {
    if (!(await ask({
      title: `Disconnect ${l.name}?`, tone: "danger", confirmLabel: "Disconnect",
      message: "Talko stops reading this location's reviews and can no longer post replies there. Reviews already imported stay here. Other locations aren't affected. You can reconnect any time.",
    }))) return;
    const r = await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: l.id }) }).catch(() => null);
    if (!r?.ok) { setMsg("Couldn't disconnect — try again."); return; }
    toast(`${l.name} disconnected`);
    reload();
  }

  async function addReview() {
    if (!addForm.text.trim() && !addForm.author.trim()) { setMsg("Add the reviewer's name or the review text"); return; }
    setAdding(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(addForm) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || "Couldn't add the review. Please try again.");
      else { setAddForm({ author: "", rating: 5, text: "", locationName: "" }); setShowAdd(false); toast("Review added — a drafted reply is waiting in the inbox"); reload(); }
    } finally { setAdding(false); }
  }

  async function syncGoogle() {
    setSyncing(true); setSyncNote(null); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews/sync", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Couldn't reach Google — try again."); return; }
      const parts = [d.imported ? `${d.imported} new review${d.imported === 1 ? "" : "s"}` : null, d.updated ? `${d.updated} change${d.updated === 1 ? "" : "s"} from Google` : null].filter(Boolean);
      if (d.errors?.length) setSyncNote(`${parts.length ? `Synced: ${parts.join(", ")}.` : ""} ${d.errors.map((e: { profile: string; error: string }) => `${e.profile}: ${e.error}`).join(" ")}`.trim());
      else toast(parts.length ? `Synced: ${parts.join(", ")}` : "Up to date with Google");
      reload();
    } finally { setSyncing(false); }
  }

  async function saveSettings(v: ReviewSettingsValue) {
    setSavingSettings(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/reviews/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "Couldn't save your settings. Please try again."); return; }
      toast("Review settings saved");
      setShowSettings(false); reload();
    } finally { setSavingSettings(false); }
  }

  const failing = locations.filter(l => l.sync && !l.sync.ok);
  const lastSync = locations.map(l => l.sync?.lastSuccessAt).filter(Boolean).sort().pop() ?? null;

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-ink-900"><Star className="h-5 w-5 text-amber-400" /> Google Reviews</h1>
          <p className="text-xs text-ink-500 mt-0.5 max-w-xl">Every review of your business on Google, in one place. The AI writes a reply to each one; you choose which replies go out on their own and which wait for your OK.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {locations.length > 0 && (
            <button onClick={syncGoogle} disabled={syncing} title="Fetch new and changed reviews from Google now" className="min-h-9 px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sync from Google
            </button>
          )}
          {isAdmin && <button onClick={() => { setShowSettings(true); setShowAdd(false); }} disabled={!settings} title={!settings ? "Loading your review settings…" : undefined} className="min-h-9 px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"><SlidersHorizontal className="w-3.5 h-3.5" /> Settings</button>}
          {isAdmin && <button onClick={() => { setShowAdd(true); setShowSettings(false); }} className="min-h-9 px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5" title="Paste a review from anywhere. Talko drafts a reply you copy and post yourself."><Plus className="w-3.5 h-3.5" /> Paste a review</button>}
        </div>
      </div>

      {isAdmin && meta && (
        <ReviewSetup locations={locations.length} settingsSaved={!!meta.settingsSaved} lastSync={lastSync} onOpenSettings={() => { setShowSettings(true); setShowAdd(false); }} />
      )}

      {/* Keep connection management out of the daily inbox unless it needs attention. */}
      <details className="group rounded-card border border-line bg-white" open={failing.length > 0 || locations.length === 0}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${failing.length ? "bg-red-500" : locations.length ? "bg-emerald-500" : "bg-slate-300"}`} />
            <span className="min-w-0"><span className="block truncate text-xs font-semibold text-ink-800">{failing.length ? `${failing.length} location${failing.length === 1 ? " needs" : "s need"} attention` : locations.length === 1 ? locations[0].name : locations.length ? `${locations.length} locations connected` : "Connect your business"}</span>
              <span className="mt-0.5 block text-[11px] text-ink-500">{lastSync ? `Synced ${ago(lastSync)}` : locations.length ? "Waiting for first sync" : "Import reviews from Google Business Profile"}</span>
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-2 text-xs font-semibold text-ink-500">Manage <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
        </summary>
        <section className="space-y-3 border-t border-line p-4" aria-label="Google Business Profile locations">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Google locations</p>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-500">
            {lastSync && <span>Last successful sync {ago(lastSync)} · checks every ~5 min</span>}
            {isAdmin && (
              <a href="/api/admin/onboarding/google-reviews/start" className="min-h-9 px-3 py-1.5 rounded-control bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold inline-flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" /> {locations.length ? "Connect another location" : "Connect with Google"}
              </a>
            )}
          </div>
        </div>
        {locations.length ? (
          <ul className="grid sm:grid-cols-2 gap-2">
            {locations.map(l => {
              const s = l.sync;
              const bad = s && !s.ok;
              return (
                <li key={l.id} className={`rounded-control border px-3 py-2 text-[12px] ${bad ? "border-red-200 bg-red-50" : "border-line bg-canvas/40"}`}>
                  <div className="flex items-center gap-2">
                    <MapPin className={`w-3.5 h-3.5 shrink-0 ${bad ? "text-red-600" : "text-emerald-600"}`} aria-hidden />
                    <span className="font-bold text-ink-900 truncate flex-1">{l.name}</span>
                    {s?.mapsUri && <a href={s.mapsUri} target="_blank" rel="noopener noreferrer" className="text-blue-700 font-semibold hover:underline">Google Maps</a>}
                    {isAdmin && <button onClick={() => disconnect(l)} className="-my-1 grid h-8 w-8 place-items-center rounded-control text-ink-400 hover:bg-red-50 hover:text-red-600" title={`Disconnect ${l.name}`} aria-label={`Disconnect ${l.name}`}><Unlink className="w-3.5 h-3.5" /></button>}
                  </div>
                  <p className={`mt-1 ${bad ? "text-red-800" : "text-ink-500"}`}>
                    {!s ? "Waiting for the first sync — usually within 5 minutes."
                      : bad ? <><b>New reviews aren&apos;t arriving.</b> {s.error} {(s.kind === "reauth" || s.kind === "permission") && isAdmin && <a href="/api/admin/onboarding/google-reviews/start" className="font-bold underline">Reconnect with Google</a>}</>
                      : <>Synced {ago(s.lastSuccessAt)}{s.totalReviewCount != null ? ` · Google shows ${s.averageRating != null ? `${s.averageRating.toFixed(1)}★ from ` : ""}${s.totalReviewCount} review${s.totalReviewCount === 1 ? "" : "s"}` : ""}{s.importingHistory ? " · still bringing in older reviews" : ""}</>}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[12px] text-ink-600">
            Connect the Google account that <b>owns or manages</b> your Business Profile. Talko asks Google for permission to read your reviews and post replies as your business — nothing else. Each location is connected separately; disconnecting one never affects the others.
          </p>
        )}
        </section>
      </details>

      {failing.length > 0 && (
        <p className="sr-only" role="alert">{failing.length} location{failing.length === 1 ? "" : "s"} can&apos;t sync. See Google locations.</p>
      )}

      {/* Location picker — shown right after the OAuth redirect back. */}
      {pickerChannelId && (
        <div className="rounded-card border-2 border-blue-500/30 bg-white p-4 space-y-3">
          <p className="text-xs font-bold text-slate-500 uppercase">Which business location is this?</p>
          {pickerLoading && <p className="text-xs text-ink-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your locations…</p>}
          {!pickerLoading && !pickerLocations.length && (
            <p className="text-xs text-red-600">{pickerError ?? "This Google account doesn't manage any Business Profile locations. Sign in with the account that owns or manages your profile."}</p>
          )}
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {pickerLocations.map(loc => (
              <button key={loc.id} type="button" disabled={!!pickerBusy} onClick={() => pickLocation(loc)}
                className="w-full flex items-center gap-2.5 border border-line rounded-control px-3 py-2 text-left hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-60">
                <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{loc.name}</p>
                  {loc.address && <p className="text-[11px] text-ink-500 truncate">{loc.address}</p>}
                </div>
                {pickerBusy === loc.id && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-ink-500">Picking a location you&apos;ve connected before replaces its old connection.</p>
          <button onClick={() => setPickerChannelId(null)} className="min-h-9 px-2 py-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900">Cancel</button>
        </div>
      )}

      {settings && typeof settings.autoMinStars === "number" && (
        <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
          {settings.autoMinStars > 5 ? "All replies need your approval." : `Auto-replies for ${settings.autoMinStars}★ and above. Flagged reviews always need approval.`}
        </p>
      )}

      {msg && <p className="text-xs text-red-700 flex items-center gap-1.5" role="alert"><AlertTriangle className="w-3.5 h-3.5" aria-hidden /> {msg}</p>}
      {syncNote && <p className="text-xs font-semibold text-emerald-700" role="status">{syncNote}</p>}

      <div className="flex gap-1 rounded-xl bg-canvas p-1 w-fit" role="tablist" aria-label="Reviews sections">
        {(["inbox", "insights"] as const).map(m => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-9 rounded-lg px-4 py-1.5 text-xs font-semibold ${mode === m ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}>{m === "inbox" ? "Inbox" : "Insights"}</button>
        ))}
      </div>
      <div hidden={mode !== "inbox"}>
        <ReviewInbox reloadKey={reloadKey} focusId={focusId} isAdmin={isAdmin} onMeta={setMeta} onClearFocus={() => setFocusId(null)} />
      </div>
      {mode === "insights" && <ReviewReports locations={locations.map(l => ({ id: l.id, name: l.name }))} />}

      {/* Secondary owner tool stays below the review inbox, collapsed by default. */}
      <ReviewBooster />

      <Drawer open={showSettings} onClose={() => setShowSettings(false)} width="lg" title="Review settings" subtitle="Control replies, approval rules and notifications."
        footer={<div className="flex w-full items-center gap-2">
          <button type="button" onClick={() => setShowSettings(false)} className="min-h-10 rounded-control border border-line bg-white px-4 py-2 text-xs font-semibold text-ink-600 hover:bg-canvas">Cancel</button>
          <button type="submit" form="review-settings-form" disabled={savingSettings || !settings} className="inline-flex min-h-10 items-center gap-2 rounded-control bg-brand-700 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60">{savingSettings && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{savingSettings ? "Saving…" : "Save settings"}</button>
        </div>}>
        {showSettings && settings && (
          <ReviewSettingsPanel value={settings} signaturePlaceholder={`— Team ${who}`} emailAvailable={!!meta?.emailAlertsAvailable}
            saving={savingSettings} showActions={false} onSave={saveSettings} onCancel={() => setShowSettings(false)} locations={locations.map(l => ({ id: l.id, name: l.name }))} />
        )}
        {msg && <p className="text-xs font-semibold text-amber-700 mt-3">{msg}</p>}
      </Drawer>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} size="md" title="Paste a review">
        {showAdd && (<div className="space-y-3">
          <p className="text-[12px] text-ink-600">For a review from anywhere — Google, Justdial, Zomato, a message. Talko drafts a reply you <b>copy and post yourself</b>; it can&apos;t publish for a pasted review. Google reviews from connected locations arrive on their own.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input className={`${inp} w-full`} aria-label="Reviewer name" placeholder="Reviewer name (optional)" value={addForm.author} onChange={e => setAddForm({ ...addForm, author: e.target.value })} />
            <input className={`${inp} w-full`} aria-label="Location or branch" placeholder="Location / branch (optional)" value={addForm.locationName} onChange={e => setAddForm({ ...addForm, locationName: e.target.value })} />
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-700">Rating <PickStars n={addForm.rating} onPick={v => setAddForm({ ...addForm, rating: v })} /></div>
          <textarea className={`${inp} w-full`} aria-label="Review text" rows={3} placeholder="Paste the review text here…" value={addForm.text} onChange={e => setAddForm({ ...addForm, text: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={addReview} disabled={adding || (!addForm.text.trim() && !addForm.author.trim())} title={!addForm.text.trim() && !addForm.author.trim() ? "Paste the review text first" : undefined} className="min-h-10 px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{adding ? "Adding…" : "Add review"}</button>
            <button onClick={() => setShowAdd(false)} className="min-h-10 px-2 py-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900">Cancel</button>
            {!addForm.text.trim() && !addForm.author.trim() && !adding && <span className="text-[12px] text-ink-500">Paste the review text first.</span>}
          </div>
        </div>)}
        {msg && <p className="text-xs font-semibold text-amber-700 mt-3">{msg}</p>}
      </Modal>
    </div>
  );
}
