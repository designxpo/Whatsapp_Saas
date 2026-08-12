"use client";

// YouTube (dedicated section) — a third comment-automation channel alongside
// Instagram & Facebook. YouTube has no DMs, so automation here is public-reply +
// moderation only. Mirrors InstagramTab's reply-only mode.
import { useState, useEffect, useCallback } from "react";
import { Check, Youtube, Loader2, MessageCircle, Plus, Trash2, Video, ShieldAlert, RefreshCw } from "lucide-react";
import { inp, type ChannelRow } from "../_shared";
import { fetchKbTags } from "./SettingsTab";

function YoutubeTab() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Youtube className="w-5 h-5 text-red-600" /> YouTube</h2>
        <p className="text-sm text-slate-500">Auto-reply to comments on your videos and moderate spam — grounded in your AI persona and knowledge base. YouTube has no DMs, so this is public replies + moderation only.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Before you connect</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>A <b>YouTube channel</b> you manage, on a Google account with access to reply to and moderate its comments.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><span>The <b>YouTube Data API v3</b> enabled on your Google Cloud project, with the <code className="font-mono text-[12px]">youtube.force-ssl</code> OAuth scope (needed to post replies and moderate).</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>Click <b>Connect with Google</b> below and approve access on the channel-owner&apos;s Google account. While the app is in Google&apos;s Testing mode, that account must be added as a test user on the OAuth consent screen first.</span></li>
        </ol>
        <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Heads-up: YouTube has no new-comment webhook, so new comments are polled every few minutes (not instant), and the daily API quota caps total replies. We rotate reply variants and pace per hour to keep the channel safe from spam strikes.</p>
      </section>

      <YoutubeManager />
    </div>
  );
}

const EMPTY_YT = { id: undefined as string | undefined, name: "", ytChannelId: "", token: "", agentId: "", kbTag: "", commentAi: true, active: true, isDefault: false };

const MAX_PUBLIC_REPLIES = 5;
type Moderate = "off" | "hold_spam" | "reject_spam";
type YtRule = {
  id?: string; channelId: string | null; name: string; enabled: boolean;
  videoId: string | null; videoTitle: string | null; videoThumbnail: string | null;
  keyword: string; publicReplies: string[]; moderate: Moderate; matchCount?: number;
};
type YtVideo = { id: string; title: string; thumbnail: string; publishedAt: string };
// What the last background poll did for a channel — surfaced so a silent
// failure (cron not running, YouTube refusing the reply) is visible here.
type YtStatus = {
  channelId: string; lastCheckedAt: string | null; commentsSeen: number | null;
  repliesPosted: number | null; lastReplyId: string | null; lastReplyAt: string | null; lastError: string | null;
};
const BLANK_RULE: YtRule = { channelId: null, name: "", enabled: true, videoId: null, videoTitle: null, videoThumbnail: null, keyword: "", publicReplies: [], moderate: "off" };

const MOD_LABEL: Record<Moderate, string> = { off: "No moderation", hold_spam: "Hold for review", reject_spam: "Reject (hide)" };

// Result flags the OAuth callback lands back with (?yt=connected / ?yt_error=…).
const YT_ERROR_MESSAGES: Record<string, string> = {
  not_in_plan: "YouTube automation isn't included in your current plan — upgrade to unlock it.",
  not_configured: "YouTube isn't configured on this deployment yet (Google OAuth pending) — add a channel manually below once it's set up, or ask your platform admin.",
  denied: "Google sign-in was cancelled.",
  state_mismatch: "Something went wrong verifying the request — please try connecting again.",
  exchange_failed: "Google didn't return a valid token — please try connecting again.",
  no_refresh_token: "Google didn't grant offline access. Visit myaccount.google.com/permissions, remove Talko AI's access, then try connecting again.",
  channel_lookup_failed: "Connected to Google, but couldn't find a YouTube channel on that account.",
  channel_limit: "Your plan's channel limit is reached — remove a channel or upgrade to connect another.",
  save_failed: "Something went wrong saving the channel — please try again.",
};

function YoutubeManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [form, setForm] = useState<typeof EMPTY_YT | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rules, setRules] = useState<YtRule[]>([]);
  const [videos, setVideos] = useState<YtVideo[]>([]);
  const [videosError, setVideosError] = useState<string | null>(null);
  const [status, setStatus] = useState<YtStatus[]>([]);
  const [checking, setChecking] = useState(false);
  const [ruleForm, setRuleForm] = useState<YtRule | null>(null);
  const [pickChannel, setPickChannel] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  // OAuth channel picker — shown when a connected Google login manages more
  // than one YouTube channel (e.g. a content manager, or several Brand
  // Accounts) and the callback couldn't guess which one to use.
  const [oauthPickerId, setOauthPickerId] = useState<string | null>(null);
  const [oauthOptions, setOauthOptions] = useState<{ id: string; title: string; thumbnail: string }[]>([]);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const loadRules = useCallback(() => { fetch("/api/admin/yt-comment-rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setChannels((d.channels ?? []).filter((c: ChannelRow) => c.kind === "youtube"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { fetchKbTags().then(setKbTags); }, []);
  useEffect(() => { loadRules(); }, [loadRules]);
  const loadStatus = useCallback(() => {
    fetch("/api/admin/yt-status").then(r => r.json()).then(d => setStatus(d.status ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  // One-time result of the "Connect with Google" redirect flow (?yt=connected /
  // ?yt_error=…). Consume it once, then scrub the query string so a page
  // refresh doesn't replay it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("yt");
    const channelId = params.get("channelId");
    const error = params.get("yt_error");
    if (connected === "connected") load();
    if (connected === "pick" && channelId) setOauthPickerId(channelId);
    if (error) setMsg(YT_ERROR_MESSAGES[error] || "Something went wrong connecting YouTube.");
    if (connected || error) window.history.replaceState(null, "", window.location.pathname);
  }, [load]);

  useEffect(() => {
    if (!oauthPickerId) { setOauthOptions([]); return; }
    setOauthLoading(true);
    fetch(`/api/admin/yt-channels?channelId=${encodeURIComponent(oauthPickerId)}`)
      .then(r => r.json())
      .then(d => { setOauthOptions(d.channels ?? []); if (d.error) setMsg(d.error); })
      .finally(() => setOauthLoading(false));
  }, [oauthPickerId]);

  async function pickOauthChannel(opt: { id: string; title: string }) {
    if (!oauthPickerId) return;
    setOauthBusy(opt.id); setMsg(null);
    try {
      const res = await fetch("/api/admin/yt-channels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: oauthPickerId, ytChannelId: opt.id, name: opt.title }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Save failed"); return; }
      setOauthPickerId(null); setOauthOptions([]); load();
    } finally { setOauthBusy(null); }
  }

  const editorChannel = ruleForm ? (ruleForm.channelId ?? "") : null;
  useEffect(() => {
    if (editorChannel === null) return;
    const qs = editorChannel ? `?channelId=${encodeURIComponent(editorChannel)}` : "";
    setVideos([]); setVideosError(null);
    fetch(`/api/admin/yt-videos${qs}`).then(r => r.json())
      .then(d => { setVideos(d.videos ?? []); setVideosError(d.error ?? null); })
      .catch(() => setVideosError("Couldn't reach the server — check your connection and try again."));
  }, [editorChannel]);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.ytChannelId.trim()) { setMsg("Label and YouTube channel id are required."); return; }
    if (!form.id && !form.token.trim()) { setMsg("An OAuth refresh token is required to connect."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/youtube", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, agentId: form.agentId || null, kbTag: form.kbTag || null }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  // Run the same poll the cron runs, for this tenant only — so testing a new
  // rule doesn't mean waiting for the next tick. Safe to spam: the dedupe log
  // and rate caps still apply, so it can't double-reply.
  async function checkNow() {
    setChecking(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/yt-status", { method: "POST" });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Check failed");
      else setMsg(d.acted > 0
        ? `Checked — replied to ${d.acted} comment${d.acted === 1 ? "" : "s"}.`
        : "Checked — nothing new to reply to. Only comments posted after a rule was saved are picked up.");
      loadStatus();
    } finally { setChecking(false); }
  }

  async function remove(id: string) {
    if (!confirm("Disconnect this YouTube channel? Its rules stay.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function saveRule() {
    if (!ruleForm) return;
    const publicReplies = ruleForm.publicReplies.map(s => s.trim()).filter(Boolean);
    if (!publicReplies.length && ruleForm.moderate === "off") { setMsg("Add at least one public reply, or choose a moderation action"); return; }
    setRuleBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/yt-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ruleForm, publicReplies }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setRuleForm(null); loadRules(); }
    } finally { setRuleBusy(false); }
  }
  async function toggleRule(r: YtRule) {
    await fetch("/api/admin/yt-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, enabled: !r.enabled }) }).catch(() => {});
    loadRules();
  }
  async function delRule(id?: string) {
    if (!id || !confirm("Delete this comment rule?")) return;
    await fetch("/api/admin/yt-comment-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    loadRules();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Youtube className="w-3.5 h-3.5 text-red-600" /> YouTube channels</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect a YouTube channel to auto-reply to comments and moderate spam. Public replies only — YouTube has no DMs.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!!channels.length && (
            <button onClick={checkNow} disabled={checking} title="Run the comment check right now instead of waiting for the next automatic run"
              className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
              {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {checking ? "Checking…" : "Check now"}
            </button>
          )}
          <a href="/api/admin/onboarding/youtube/start" className="px-3 py-1.5 rounded-control bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5">
            <Youtube className="w-3.5 h-3.5" /> Connect with Google
          </a>
          <button onClick={() => { setForm({ ...EMPTY_YT }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add manually</button>
        </div>
      </div>

      {/* OAuth channel picker — shown once, right after "Connect with Google",
          when that Google login manages more than one channel (a content
          manager, or a Brand Account alongside a personal channel). */}
      {oauthPickerId && (
        <div className="rounded-card border-2 border-red-500/30 bg-white p-4 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Which YouTube channel is this?</p>
          {oauthLoading && <p className="text-xs text-ink-400 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your channels…</p>}
          {!oauthLoading && !oauthOptions.length && (
            <p className="text-xs text-amber-600">No channels found on this Google login — make sure you signed in with the account that manages your YouTube channel.</p>
          )}
          <div className="space-y-1.5">
            {oauthOptions.map(opt => (
              <button key={opt.id} type="button" disabled={!!oauthBusy} onClick={() => pickOauthChannel(opt)}
                className="w-full flex items-center gap-2.5 border border-line rounded-control px-3 py-2 text-left hover:border-red-500 hover:bg-red-50 transition-colors disabled:opacity-60">
                {opt.thumbnail ? <img src={opt.thumbnail} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" /> : <Youtube className="w-5 h-5 text-red-600 shrink-0" />}
                <p className="text-sm font-semibold text-ink-900 truncate flex-1">{opt.title}</p>
                {oauthBusy === opt.id && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              </button>
            ))}
          </div>
          <button onClick={() => setOauthPickerId(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
        </div>
      )}

      {channels.map(c => {
        const st = status.find(s => s.channelId === c.id);
        return (
        <div key={c.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Youtube className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{c.name} {c.isDefault && <span className="text-[10px] font-bold text-brand-700">· DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
            <p className="text-[11px] text-ink-400 font-mono truncate">yt {c.ytChannelId} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
            {/* Last background poll — makes a silent failure visible instead of
                leaving "why didn't it reply?" unanswerable from the portal. */}
            {!st
              ? <p className="text-[11px] text-amber-600 mt-0.5">Not checked yet — the background poller runs every few minutes.</p>
              : <p className={`text-[11px] mt-0.5 ${st.lastError ? "text-red-600" : "text-ink-500"}`}>
                  Last checked {st.lastCheckedAt ? new Date(st.lastCheckedAt).toLocaleString() : "—"}
                  {typeof st.commentsSeen === "number" && <> · {st.commentsSeen} comment{st.commentsSeen === 1 ? "" : "s"} seen</>}
                  {typeof st.repliesPosted === "number" && <> · {st.repliesPosted} replied</>}
                  {st.lastError && <> · {st.lastError}</>}
                  {!st.lastError && st.lastReplyId && <span className="font-mono"> · last reply id {st.lastReplyId}</span>}
                </p>}
          </div>
          <button onClick={() => { setForm({ id: c.id, name: c.name, ytChannelId: c.ytChannelId ?? "", token: "", agentId: c.agentId ?? "", kbTag: c.kbTag ?? "", commentAi: c.commentAi ?? true, active: c.active, isDefault: c.isDefault }); setMsg(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
        );
      })}

      {form && (
        <div className="border-2 border-red-500/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. My Channel" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="YouTube channel id (UC…)" value={form.ytChannelId} onChange={e => setForm({ ...form, ytChannelId: e.target.value.trim() })} />
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this channel">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
            <select className={inp} value={form.kbTag} onChange={e => setForm({ ...form, kbTag: e.target.value })} title="AI on this channel answers from KB docs with this tag first, falling back to the full knowledge base.">
              <option value="">Knowledge: global (all docs)</option>
              {kbTags.map(t => <option key={t} value={t}>Knowledge: {t}</option>)}
              {form.kbTag && !kbTags.includes(form.kbTag) && <option value={form.kbTag}>Knowledge: {form.kbTag}</option>}
            </select>
          </div>
          <input className={`${inp} w-full font-mono`} placeholder={form.id ? "OAuth refresh token — leave blank to keep the current one" : "OAuth refresh token (youtube.force-ssl scope)"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> default</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer" title="When ON, the AI publicly replies to comments that don't match a fixed rule (using this channel's persona + knowledge). When OFF, un-ruled comments are left untouched."><input type="checkbox" className="accent-brand-700" checked={form.commentAi} onChange={e => setForm({ ...form, commentAi: e.target.checked })} /> AI answers comments</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save channel"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Needs the <code className="font-mono">youtube.force-ssl</code> scope and the YouTube Data API v3 enabled. Comments are polled every few minutes and paced to stay within Google’s daily quota.</p>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!channels.length && !form && <p className="text-xs text-ink-400">No YouTube channels connected yet.</p>}

      {/* Comment automation — public reply + moderation */}
      <div className="border-t border-line pt-3 mt-1 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Comment automation <span className="text-[10px] font-bold text-red-600 normal-case">· public reply + moderation</span></p>
          <button onClick={() => { setMsg(null); if (!channels.length) { setMsg("Connect a YouTube channel first."); return; } if (channels.length > 1) { setRuleForm(null); setPickChannel(true); } else { setPickChannel(false); setRuleForm({ ...BLANK_RULE, channelId: channels[0]?.id ?? null }); } }} className="shrink-0 px-3 py-1.5 rounded-control bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New rule</button>
        </div>
        <p className="text-[11px] text-ink-400">When someone comments, publicly reply under their comment and/or moderate it. Add a few reply variants and we rotate them so replies stay natural and don&apos;t trip YouTube&apos;s spam filters. Target one video or all videos, and gate by keyword.</p>
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-3 py-2">
          <b>Testing a rule?</b> Save the rule first, then post a <b>brand-new comment</b>. Each comment is answered only once, and comments posted before the rule existed are never revisited — so re-testing with the same comment will look like nothing happened. Hit <b>Check now</b> above to run immediately instead of waiting for the next automatic check.
        </p>

        {rules.map(r => {
          const video = videos.find(v => v.id === r.videoId);
          const thumb = r.videoThumbnail || video?.thumbnail;
          const nReplies = (r.publicReplies ?? []).filter(Boolean).length;
          return (
            <div key={r.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
              {thumb
                ? <img src={thumb} alt="" className="w-14 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-14 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Youtube className="w-4 h-4" /></div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 truncate">{r.name || (r.keyword ? `“${r.keyword}”` : "Any comment")}{channels.length > 1 && r.channelId && <span className="text-[10px] font-bold text-red-600"> · {channels.find(c => c.id === r.channelId)?.name ?? "YT"}</span>}{!r.enabled && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
                <p className="text-[11px] text-ink-400 truncate">{r.videoId ? `Video: ${(r.videoTitle || video?.title || r.videoId).slice(0, 34) || r.videoId}` : "All videos"} · {r.keyword ? `keyword “${r.keyword}”` : "any comment"} · {nReplies} repl{nReplies === 1 ? "y" : "ies"}{r.moderate !== "off" ? ` · ${MOD_LABEL[r.moderate]}` : ""} · {r.matchCount ?? 0} done</p>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-ink-500 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={r.enabled} onChange={() => toggleRule(r)} /> on</label>
              <button onClick={() => { setRuleForm({ ...r, name: r.name ?? "", keyword: r.keyword ?? "", publicReplies: (r.publicReplies ?? []).filter(Boolean), moderate: r.moderate ?? "off" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
              <button onClick={() => delRule(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {!rules.length && !ruleForm && !pickChannel && <p className="text-xs text-ink-400">No comment rules yet — create one to auto-reply publicly under comments.</p>}

        {/* Step 1: pick the channel so videos are never mixed across channels. */}
        {pickChannel && (
          <div className="border-2 border-red-500/30 rounded-control p-3 space-y-2">
            <p className="text-xs font-bold text-ink-700">Which YouTube channel is this rule for?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {channels.map(c => (
                <button key={c.id} type="button" onClick={() => { setRuleForm({ ...BLANK_RULE, channelId: c.id }); setPickChannel(false); }}
                  className="flex items-center gap-2 border border-line rounded-control px-3 py-2 text-left hover:border-red-500 hover:bg-red-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center shrink-0"><Youtube className="w-4 h-4" /></div>
                  <div className="min-w-0"><p className="text-sm font-semibold text-ink-900 truncate">{c.name}</p><p className="text-[10px] text-ink-400 font-mono truncate">{c.ytChannelId}</p></div>
                </button>
              ))}
            </div>
            <button onClick={() => setPickChannel(false)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
        )}

        {ruleForm && (
          <div className="border-2 border-red-500/30 rounded-control p-3 space-y-2">
            {channels.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-control bg-red-50 text-red-600 font-bold flex items-center gap-1"><Youtube className="w-3.5 h-3.5" /> {channels.find(c => c.id === ruleForm.channelId)?.name ?? "Channel"}</span>
                <button type="button" onClick={() => { setRuleForm(null); setPickChannel(true); }} className="text-ink-400 hover:text-ink-900 font-semibold">Change channel</button>
              </div>
            )}
            <input className={`${inp} w-full`} placeholder="Rule name (internal)" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} />
            <div>
              <p className="text-[11px] font-bold text-ink-500 mb-1.5">Target video</p>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                <button type="button" onClick={() => setRuleForm({ ...ruleForm, videoId: null, videoTitle: null, videoThumbnail: null })}
                  className={`aspect-video rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold border transition-colors ${!ruleForm.videoId ? "ring-2 ring-red-500 border-red-500 text-red-600 bg-red-50" : "border-line text-ink-500 hover:bg-canvas"}`}>
                  <Youtube className="w-4 h-4" /> All
                </button>
                {videos.map(v => {
                  const sel = ruleForm.videoId === v.id;
                  return (
                    <button type="button" key={v.id} title={v.title || v.id} onClick={() => setRuleForm({ ...ruleForm, videoId: v.id, videoTitle: v.title, videoThumbnail: v.thumbnail })}
                      className={`relative aspect-video rounded-lg overflow-hidden border transition-all ${sel ? "ring-2 ring-red-500 border-red-500" : "border-line hover:opacity-90"}`}>
                      {/* absolute inset-0 (not in-flow w/h-full): otherwise Safari
                          hits a cyclic aspect-ratio↔height dependency and falls back
                          to the image's intrinsic size, so portrait Shorts thumbs
                          overflow and overlap the row below. */}
                      {v.thumbnail
                        ? <img src={v.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        : <div className="absolute inset-0 bg-canvas flex items-center justify-center text-ink-300"><Video className="w-4 h-4" /></div>}
                      {sel && <span className="absolute inset-0 bg-red-500/15 flex items-center justify-center"><Check className="w-5 h-5 text-white drop-shadow" /></span>}
                    </button>
                  );
                })}
              </div>
              {!videos.length && (
                <p className={`text-[11px] mt-1.5 ${videosError ? "text-red-600" : "text-amber-600"}`}>
                  {videosError
                    ? <>{videosError} You can still create an &ldquo;All videos&rdquo; rule.</>
                    : <>No videos found on this channel yet — publish a video, or create an &ldquo;All videos&rdquo; rule that covers future uploads.</>}
                </p>
              )}
            </div>
            <div>
              <input className={`${inp} w-full`} placeholder="Trigger words — comma-separated (optional, blank = any comment)" value={ruleForm.keyword} onChange={e => setRuleForm({ ...ruleForm, keyword: e.target.value })} />
              <p className="text-[11px] text-ink-400 mt-1">Add several to match more comments, e.g. <span className="font-mono">price, link, how much, buy</span> — fires if the comment contains any one of them.</p>
            </div>
            {/* Rotating public replies */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-ink-500">Public replies — add a few variants and we rotate them at random on each comment (keeps replies natural, avoids spam flags).</p>
              {ruleForm.publicReplies.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${inp} flex-1`} placeholder={`Reply ${i + 1}, e.g. Thanks for watching! Here's the link 👇`}
                    value={v}
                    onChange={e => { const next = [...ruleForm.publicReplies]; next[i] = e.target.value; setRuleForm({ ...ruleForm, publicReplies: next }); }} />
                  <button type="button" onClick={() => setRuleForm({ ...ruleForm, publicReplies: ruleForm.publicReplies.filter((_, j) => j !== i) })}
                    className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0" title="Remove reply"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {ruleForm.publicReplies.length < MAX_PUBLIC_REPLIES && (
                <button type="button" onClick={() => setRuleForm({ ...ruleForm, publicReplies: [...ruleForm.publicReplies, ""] })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border border-dashed border-line text-xs font-bold text-ink-600 hover:bg-canvas">
                  <Plus className="w-3.5 h-3.5" /> Add reply variant {ruleForm.publicReplies.length ? `(${ruleForm.publicReplies.length}/${MAX_PUBLIC_REPLIES})` : "(optional)"}
                </button>
              )}
            </div>
            {/* Moderation */}
            <div className="rounded-control bg-canvas border border-line p-2.5 space-y-1.5">
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-ink-600"><ShieldAlert className="w-3.5 h-3.5" /> Moderation on match</label>
              <select className={`${inp} w-full`} value={ruleForm.moderate} onChange={e => setRuleForm({ ...ruleForm, moderate: e.target.value as Moderate })}>
                <option value="off">No moderation — just reply</option>
                <option value="hold_spam">Hold for review — hide until you approve</option>
                <option value="reject_spam">Reject — hide the comment</option>
              </select>
              <p className="text-[11px] text-ink-400">Use a keyword-gated rule with moderation to auto-hide spam or abusive comments. Leave the reply blank to moderate silently.</p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={ruleForm.enabled} onChange={e => setRuleForm({ ...ruleForm, enabled: e.target.checked })} /> enabled</label>
              <div className="flex-1" />
              <button onClick={saveRule} disabled={ruleBusy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{ruleBusy ? "Saving…" : "Save rule"}</button>
              <button onClick={() => setRuleForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
            </div>
            {msg && <p className="text-xs text-red-500">{msg}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

export default YoutubeTab;
