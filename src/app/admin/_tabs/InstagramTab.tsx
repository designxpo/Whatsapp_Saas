"use client";

// Instagram (dedicated section) — extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Check, Instagram, Loader2, Lock, MessageCircle, Plus, Send, Trash2, Video } from "lucide-react";
import { inp, type ChannelRow, DEFAULT_TENANT_ID } from "../_shared";
import { fetchKbTags } from "./SettingsTab";

// Dedicated Instagram section (its own nav tab).
function InstagramTab() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Instagram className="w-5 h-5 text-pink-600" /> Instagram</h2>
        <p className="text-sm text-slate-500">Auto-reply to Instagram DMs with your AI, and turn post comments into DMs — all within Meta&apos;s rules (24-hour window, no cold DMs, one reply per comment).</p>
      </div>

      {/* What you need to connect */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Before you connect</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>An Instagram <b>Professional</b> account (Business or Creator), <b>linked to a Facebook Page</b>. In the IG app: Settings → Account type → switch to Professional, then link your Page.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><span>In <b>Instagram → Settings → Messages → Connected Tools</b>, turn ON <i>“Allow access to messages”</i> so the API can read/reply to DMs.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>Grab two things to paste below: the <b>Instagram account id</b> (the professional account / IGSID) and an <b>access token</b> with messaging access. The Page id is optional — Talko sets up the connection and routing automatically.</span></li>
        </ol>
        <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Heads-up on Meta&apos;s rules (enforced automatically): you can only DM someone within <b>24 hours</b> of their last message, never cold-DM, and a comment reply is a single message. Staying inside these keeps the account safe from blocks.</p>
      </section>

      <InstagramManager />
    </div>
  );
}

const EMPTY_IG = { id: undefined as string | undefined, name: "", igUserId: "", pageId: "", token: "", agentId: "", kbTag: "", commentAi: true, active: true, isDefault: false };

type RuleButton = { label: string; url: string };
const MAX_BUTTONS = 3;
const MAX_PUBLIC_REPLIES = 5;
type CommentRule = {
  id?: string; channelId: string | null; name: string; enabled: boolean;
  postId: string | null; postCaption: string | null; postPermalink: string | null; postThumbnail: string | null;
  keyword: string; dmMessage: string; buttons: RuleButton[]; publicReplies: string[];
  replyOnly: boolean; requireFollow: boolean; followPrompt: string; matchCount?: number;
};
type IgPost = { id: string; caption: string; permalink: string; thumbnail: string; mediaType: string; timestamp: string };
// Live delivery state read back from Meta (see api/admin/channels/instagram/health).
// "Connected" and "receiving comments" are different things, and the gap between
// them is exactly where comment rules go to die unnoticed.
type IgHealth = {
  id: string; name: string; igUserId: string | null; active: boolean;
  messages: boolean; comments: boolean; fields: string[]; idMatches: boolean; liveId?: string;
  status: "ok" | "unverified" | "dms-only" | "wrong-id" | "error"; detail: string;
};
const BLANK_RULE: CommentRule = { channelId: null, name: "", enabled: true, postId: null, postCaption: null, postPermalink: null, postThumbnail: null, keyword: "", dmMessage: "", buttons: [], publicReplies: [], replyOnly: false, requireFollow: false, followPrompt: "" };

// One glance at whether Meta is actually delivering. "Connected" was doing this
// job before and couldn't: it stayed green whether comments were flowing or not.
function DeliveryChip({ h }: { h: IgHealth }) {
  const look = h.status === "ok" ? { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "DMs + comments" }
    // Not green and not red: DMs demonstrably work, comments are merely unproven.
    // Calling that "Not receiving" would be as wrong as calling it healthy.
    : h.status === "unverified" ? { cls: "bg-sky-50 text-sky-700 border-sky-200", label: "Comments unverified" }
    : h.status === "dms-only" ? { cls: "bg-amber-50 text-amber-700 border-amber-200", label: "DMs only" }
    : { cls: "bg-red-50 text-red-700 border-red-200", label: "Not receiving" };
  return <span title={h.detail} className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-bold ${look.cls}`}>{look.label}</span>;
}

// Rules from the API may arrive with the new `buttons` array or only the legacy
// single button — normalize to an array so the editor is uniform.
function ruleButtonsOf(r: { buttons?: RuleButton[]; buttonLabel?: string | null; buttonUrl?: string | null }): RuleButton[] {
  if (Array.isArray(r.buttons) && r.buttons.length) return r.buttons.map(b => ({ label: b.label ?? "", url: b.url ?? "" }));
  if (r.buttonUrl) return [{ label: r.buttonLabel ?? "", url: r.buttonUrl }];
  return [];
}
// Same for the rotating public replies — new array, else the legacy single reply.
function rulePublicRepliesOf(r: { publicReplies?: string[]; publicReply?: string | null }): string[] {
  if (Array.isArray(r.publicReplies) && r.publicReplies.length) return r.publicReplies.filter(Boolean);
  if (r.publicReply) return [r.publicReply];
  return [];
}

function InstagramManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [form, setForm] = useState<typeof EMPTY_IG | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Comment-to-DM rules (multiple rules, per-post, follow-gate)
  const [rules, setRules] = useState<CommentRule[]>([]);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [ruleForm, setRuleForm] = useState<CommentRule | null>(null);
  const [pickAccount, setPickAccount] = useState(false);
  // Which mode the "New…" flow is creating (carried through the account picker).
  const [pendingReplyOnly, setPendingReplyOnly] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  // Delivery state per account, read back from Meta rather than assumed.
  const [health, setHealth] = useState<Record<string, IgHealth>>({});
  const [rechecking, setRechecking] = useState<string | null>(null);
  // Comment automation needs instagram_business_manage_comments at Advanced
  // Access, which is still pending Meta App Review — Meta only honors that
  // permission today for accounts with a role on the app (the owner's own),
  // so showing the feature to a real tenant would be a control that silently
  // never does anything. Gated to the owner's own session (not impersonating
  // a tenant) until the review clears.
  const [canUseComments, setCanUseComments] = useState(false);
  const loadRules = useCallback(() => { fetch("/api/admin/ig-comment-rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => {}); }, []);
  const loadHealth = useCallback(() => {
    fetch("/api/admin/channels/instagram/health")
      .then(r => r.json())
      .then(d => setHealth(Object.fromEntries(((d.accounts ?? []) as IgHealth[]).map(a => [a.id, a]))))
      .catch(() => {});   // a failed check must never look like a failed account
  }, []);

  const load = useCallback(async () => {
    // The channels endpoint answers 200 with an empty list and a `notice` when
    // the read itself fails, and listChannels swallows query errors the same
    // way. Both render as "No Instagram accounts connected yet", which is the
    // one thing a connected-but-unreadable account must NOT look like — so a
    // failed read is reported instead of being mistaken for an empty one.
    const d = await fetch("/api/admin/channels")
      .then(r => r.json())
      .catch(() => ({ channels: [], notice: "Couldn't reach the server." }));
    if (d.notice) setMsg(`Couldn't load your connected accounts: ${d.notice}`);
    setChannels((d.channels ?? []).filter((c: ChannelRow) => c.kind === "instagram"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/admin/me").then(r => r.json())
      .then(d => { const u = d?.user; setCanUseComments(!!u?.isPlatformOwner && (!u?.tenantId || u.tenantId === DEFAULT_TENANT_ID)); })
      .catch(() => setCanUseComments(false));
  }, []);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { fetchKbTags().then(setKbTags); }, []);
  useEffect(() => { loadRules(); }, [loadRules]);
  // Re-read whenever the account list changes — connecting, editing or removing
  // an account all change what Meta will deliver.
  useEffect(() => { if (channels.length) loadHealth(); }, [channels, loadHealth]);
  // Load the post grid for the account the rule editor targets. `null` when the
  // editor is closed; only changes on open or account switch (not keystrokes).
  const editorChannel = ruleForm ? (ruleForm.channelId ?? "") : null;
  useEffect(() => {
    if (editorChannel === null) return;
    const qs = editorChannel ? `?channelId=${encodeURIComponent(editorChannel)}` : "";
    setPosts([]);
    fetch(`/api/admin/ig-media${qs}`).then(r => r.json()).then(d => setPosts(d.media ?? [])).catch(() => {});
  }, [editorChannel]);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.igUserId.trim()) { setMsg("Label and Instagram account id are required."); return; }
    if (!form.id && !form.token.trim()) { setMsg("Access token is required to connect."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/instagram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, agentId: form.agentId || null, kbTag: form.kbTag || null, pageId: form.pageId || null }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else if (d.webhook && !d.webhook.ok) { setMsg(`Saved, but Meta wouldn't finish connecting this account: ${d.webhook.detail}. DMs won't arrive until it's fixed — the access token may be missing messaging permission.`); load(); }
      else if (d.webhook?.degraded) { setMsg(d.webhook.detail); setForm(null); load(); }
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Disconnect this Instagram account? Its conversations stay.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  // Ask Meta to subscribe this account again, then read back what it will
  // actually deliver. The connect-time attempt is one try at one moment — if
  // Meta refused comments then (a permission still in review, a transient
  // refusal), this is the only way to recover without disconnecting.
  async function recheck(id: string) {
    setRechecking(id); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/instagram/health", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Couldn't check this account."); return; }
      const a = d.account as IgHealth;
      setHealth(h => ({ ...h, [a.id]: a }));
      if (a.status !== "ok") setMsg(a.detail);
    } catch { setMsg("Couldn't reach the server to check this account."); }
    finally { setRechecking(null); }
  }

  // Instagram uses Business Login for Instagram — a redirect flow, not FB.login().
  // Meta's Instagram permissions (instagram_business_*) cannot even be selected
  // in a Facebook Login for Business configuration, so the old popup granted
  // tenants nothing while still showing Meta's success screen. The popup now
  // opens our own /start route, which redirects to instagram.com and comes back
  // through /callback; the callback page posts the outcome here and closes.
  function connectWithMeta() {
    setMsg(null);
    const w = window.open("/api/admin/onboarding/instagram/start", "talko-ig-login", "width=620,height=760,menubar=no,toolbar=no");
    if (!w) { setMsg("Your browser blocked the Instagram window. Allow pop-ups for this site and try again."); return; }
    setBusy(true);

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;                     // only our own callback page
      const d = e.data as { source?: string; ok?: boolean; error?: string; detail?: string } | null;
      if (!d || d.source !== "talko-ig-login") return;
      cleanup();
      if (d.ok) { setMsg(d.detail ?? null); setForm(null); load(); }
      else setMsg(d.error || "Couldn't connect Instagram.");
    };
    // The popup can also be closed by hand, which sends no message — without
    // this the button would spin forever.
    const poll = window.setInterval(() => { if (w.closed) { cleanup(); load(); } }, 700);
    function cleanup() {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
      setBusy(false);
    }
    window.addEventListener("message", onMessage);
  }

  async function saveRule() {
    if (!ruleForm) return;
    const publicReplies = ruleForm.publicReplies.map(s => s.trim()).filter(Boolean);
    // Reply-only rules: no DM/buttons, but need at least one public reply.
    if (ruleForm.replyOnly) {
      if (!publicReplies.length) { setMsg("Add at least one public reply"); return; }
      setRuleBusy(true); setMsg(null);
      try {
        const res = await fetch("/api/admin/ig-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ruleForm, buttons: [], publicReplies }) });
        const d = await res.json();
        if (!res.ok) setMsg(d.error || "Save failed");
        else { setRuleForm(null); loadRules(); }
      } finally { setRuleBusy(false); }
      return;
    }
    if (!ruleForm.dmMessage.trim()) { setMsg("DM message is required"); return; }
    // Drop blank rows; a button that has a label but no link is a mistake.
    const buttons = ruleForm.buttons.filter(b => b.url.trim() || b.label.trim());
    if (buttons.some(b => !b.url.trim())) { setMsg("Add a link for every button (or remove it)"); return; }
    if (buttons.some(b => !/^https?:\/\//i.test(b.url.trim()))) { setMsg("Every button link must start with http:// or https://"); return; }
    setRuleBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/ig-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ruleForm, buttons, publicReplies }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setRuleForm(null); loadRules(); }
    } finally { setRuleBusy(false); }
  }
  async function toggleRule(r: CommentRule) {
    await fetch("/api/admin/ig-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, enabled: !r.enabled }) }).catch(() => {});
    loadRules();
  }
  async function delRule(id?: string) {
    if (!id || !confirm("Delete this comment rule?")) return;
    await fetch("/api/admin/ig-comment-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    loadRules();
  }

  // Accounts receiving DMs but not comments — every comment rule on them is dead.
  const commentsBlocked = channels.map(c => health[c.id]).filter((h): h is IgHealth => !!h && h.status === "dms-only");
  // Unproven is not the same as broken, so it gets its own, softer line — but it
  // still has to appear next to the rules, because that is where a tenant is
  // sitting when they wonder why nothing fired.
  const commentsUnproven = channels.map(c => health[c.id]).filter((h): h is IgHealth => !!h && h.status === "unverified");

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Instagram className="w-3.5 h-3.5 text-pink-600" /> Instagram</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect an Instagram professional account to auto-reply to DMs and turn post comments into DMs — all within Meta&apos;s rules (24-hour window, no cold DMs).</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={connectWithMeta} disabled={busy} className="px-3 py-1.5 rounded-control bg-gradient-to-r from-[#C13584] to-[#F56040] hover:opacity-90 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5" />} Connect Instagram
          </button>
          <button onClick={() => { setForm({ ...EMPTY_IG }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add manually</button>
        </div>
      </div>

      {/* Both forms render `msg` inside themselves, which meant a failure from
          "Connect with Facebook" — which opens NO form — was written into a
          branch that isn't mounted. The tenant finished the Meta popup, got
          Meta's own success screen, and this tab just kept saying "No Instagram
          accounts connected yet" with no reason given. Show it here whenever no
          form owns it. */}
      {msg && !form && !ruleForm && (
        <div className="bg-red-50 border border-red-200 rounded-control px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 leading-snug">{msg}</p>
        </div>
      )}

      {channels.map(c => {
        const h = health[c.id];
        return (
        <div key={c.id} className="border border-line rounded-control px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><Instagram className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900 truncate">{c.name} {c.isDefault && <span className="text-[10px] font-bold text-brand-700">· DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
              <p className="text-[11px] text-ink-400 font-mono truncate">ig {c.igUserId}{c.pageId ? ` · page ${c.pageId}` : ""} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
            </div>
            {h && <DeliveryChip h={h} />}
            <button onClick={() => recheck(c.id)} disabled={rechecking === c.id} title="Ask Meta again what this account can receive, and re-subscribe it"
              className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 disabled:opacity-60">
              {rechecking === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Recheck"}
            </button>
            <button onClick={() => { setForm({ id: c.id, name: c.name, igUserId: c.igUserId ?? "", pageId: c.pageId ?? "", token: "", agentId: c.agentId ?? "", kbTag: c.kbTag ?? "", commentAi: c.commentAi ?? true, active: c.active, isDefault: c.isDefault }); setMsg(null); }}
              className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
            <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
          {h && h.status !== "ok" && (
            <p className={`text-[11px] leading-snug rounded-control px-2.5 py-1.5 ${h.status === "unverified" ? "bg-sky-50 text-sky-800" : h.status === "dms-only" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>{h.detail}</p>
          )}
        </div>
      );})}

      {form && (
        <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. @yourbrand" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Instagram account id (IG professional id)" value={form.igUserId} onChange={e => setForm({ ...form, igUserId: e.target.value.trim() })} />
            <input className={inp} placeholder="Facebook Page id (optional)" value={form.pageId} onChange={e => setForm({ ...form, pageId: e.target.value.trim() })} />
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this account">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
            <select className={inp} value={form.kbTag} onChange={e => setForm({ ...form, kbTag: e.target.value })} title="AI on this account answers from KB docs with this tag first, falling back to the full knowledge base. Tag docs in the AI Knowledge Base tab.">
              <option value="">Knowledge: global (all docs)</option>
              {kbTags.map(t => <option key={t} value={t}>Knowledge: {t}</option>)}
              {form.kbTag && !kbTags.includes(form.kbTag) && <option value={form.kbTag}>Knowledge: {form.kbTag}</option>}
            </select>
          </div>
          <input className={`${inp} w-full font-mono`} placeholder={form.id ? "Access token — leave blank to keep the current one" : "Access token (instagram_manage_messages)"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> default for sends</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer" title="When ON, the AI publicly replies to comments that don't match a fixed rule (using this account's persona + knowledge). When OFF, un-ruled comments are left untouched. DMs and fixed rules are unaffected either way."><input type="checkbox" className="accent-brand-700" checked={form.commentAi} onChange={e => setForm({ ...form, commentAi: e.target.checked })} /> AI answers comments</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save account"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Needs an IG <b>professional</b> account linked to a Facebook Page, and an access token with messaging access. Talko handles the connection and routing.</p>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!channels.length && !form && (
        <div className="text-xs text-ink-400 space-y-1">
          <p>No Instagram accounts connected yet.</p>
          {/* Said BEFORE the popup opens: the window offers several things to
              share and gives no hint which ones we actually need. */}
          <p className="text-[11px]">
            <b>Connect Instagram</b> signs you in on instagram.com and asks for message access — no Facebook Page needed.
          </p>
        </div>
      )}

      {/* Comment-to-DM + comment-reply automation both need Advanced Access on
          instagram_business_manage_comments, which is pending Meta App Review —
          Meta only honors the permission today for accounts with a role on the
          app, not real tenant accounts. Shown as "coming soon" everywhere except
          the owner's own (non-impersonated) session until that review clears. */}
      {!canUseComments ? (
        <div className="border-t border-line pt-3 mt-1">
          <div className="rounded-card border border-dashed border-line bg-canvas px-4 py-6 text-center">
            <MessageCircle className="w-5 h-5 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-500">Comment automation — coming soon</p>
            <p className="text-xs text-ink-400 mt-1 max-w-sm mx-auto">Turning post comments into DMs or automatic public replies is finishing a Meta review and isn&apos;t available yet. DMs and AI auto-replies work normally in the meantime.</p>
          </div>
        </div>
      ) : (
      <>
      {/* Comment-to-DM automation (multiple rules, per-post, follow-gate) */}
      <div className="border-t border-line pt-3 mt-1 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Comment-to-DM automation</p>
          <button onClick={() => { setMsg(null); setPendingReplyOnly(false); if (channels.length > 1) { setRuleForm(null); setPickAccount(true); } else { setPickAccount(false); setRuleForm({ ...BLANK_RULE, replyOnly: false, channelId: channels[0]?.id ?? null }); } }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New rule</button>
        </div>
        <p className="text-[11px] text-ink-400">When someone comments, send them ONE private DM (Meta allows a single reply per comment). Target a specific post or all posts, gate by keyword, attach a link button, and optionally require a follow first.</p>

        {/* A rule on an account Meta isn't sending comments for is a rule that
            can never run. That used to be invisible: the account said
            "connected", the rule said "on", and nothing ever happened. */}
        {commentsUnproven.length > 0 && commentsBlocked.length === 0 && (
          <div className="bg-sky-50 border border-sky-200 rounded-control px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-800 leading-snug">
              <b>Comment delivery is unconfirmed on {commentsUnproven.map(a => a.name).join(", ")}.</b> DMs are arriving, and Instagram lists comments as subscribed — but it accepts that subscription even when comment access was never granted, and no comment has reached {commentsUnproven.length > 1 ? "these accounts" : "this account"} yet. Post a test comment from another account, or reconnect once to confirm.
            </p>
          </div>
        )}
        {commentsBlocked.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-control px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 leading-snug">
              <p><b>Instagram isn&apos;t sending comments for {commentsBlocked.map(a => a.name).join(", ")}.</b> DMs arrive fine, so the account looks healthy — but no rule below can run on {commentsBlocked.length > 1 ? "these accounts" : "this account"}.</p>
              <p className="mt-1">Press <b>Recheck</b> next to {commentsBlocked.length > 1 ? "each account" : "the account"} above. If it stays amber, reconnect it and leave every permission ticked on Instagram&apos;s consent screen.</p>
            </div>
          </div>
        )}

        {rules.filter(r => !r.replyOnly).map(r => {
          const post = posts.find(p => p.id === r.postId);
          const thumb = r.postThumbnail || post?.thumbnail;
          return (
            <div key={r.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
              {thumb
                ? <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-10 h-10 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 truncate">{r.name || (r.keyword ? `“${r.keyword}”` : "Any comment")}{channels.length > 1 && r.channelId && <span className="text-[10px] font-bold text-pink-600"> · {channels.find(c => c.id === r.channelId)?.name ?? "IG"}</span>}{!r.enabled && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
                <p className="text-[11px] text-ink-400 truncate">{r.postId ? `Post: ${(r.postCaption || post?.caption || r.postId).slice(0, 38) || r.postId}` : "All posts"} · {r.keyword ? `keyword “${r.keyword}”` : "any comment"}{ruleButtonsOf(r).length ? ` · ${ruleButtonsOf(r).length} button${ruleButtonsOf(r).length > 1 ? "s" : ""}` : ""}{r.requireFollow ? " · follow-gated" : ""} · {r.matchCount ?? 0} sent</p>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-ink-500 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={r.enabled} onChange={() => toggleRule(r)} /> on</label>
              <button onClick={() => { setRuleForm({ ...r, name: r.name ?? "", keyword: r.keyword ?? "", buttons: ruleButtonsOf(r), publicReplies: rulePublicRepliesOf(r), requireFollow: r.requireFollow ?? false, followPrompt: r.followPrompt ?? "" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
              <button onClick={() => delRule(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {!rules.some(r => !r.replyOnly) && !ruleForm && !pickAccount && <p className="text-xs text-ink-400">No comment-to-DM rules yet — create one to turn post comments into DMs.</p>}

        {/* Comment-reply-only automation — posts a public reply, never a DM. */}
        <div className="border-t border-line pt-3 mt-1 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Comment reply automation <span className="text-[10px] font-bold text-violet-600 normal-case">· public reply, no DM</span></p>
            <button onClick={() => { setMsg(null); setPendingReplyOnly(true); if (channels.length > 1) { setRuleForm(null); setPickAccount(true); } else { setPickAccount(false); setRuleForm({ ...BLANK_RULE, replyOnly: true, channelId: channels[0]?.id ?? null }); } }} className="shrink-0 px-3 py-1.5 rounded-control bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New reply rule</button>
          </div>
          <p className="text-[11px] text-ink-400">When someone comments, publicly reply under their comment — no DM is sent. Add a few reply variants and we rotate them so replies stay natural and don&apos;t trip Instagram&apos;s spam filters. Target a post or all posts, and gate by keyword.</p>

          {rules.filter(r => r.replyOnly).map(r => {
            const post = posts.find(p => p.id === r.postId);
            const thumb = r.postThumbnail || post?.thumbnail;
            const nReplies = rulePublicRepliesOf(r).length;
            return (
              <div key={r.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
                {thumb
                  ? <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                  : <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{r.name || (r.keyword ? `“${r.keyword}”` : "Any comment")}{channels.length > 1 && r.channelId && <span className="text-[10px] font-bold text-violet-600"> · {channels.find(c => c.id === r.channelId)?.name ?? "IG"}</span>}{!r.enabled && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
                  <p className="text-[11px] text-ink-400 truncate">{r.postId ? `Post: ${(r.postCaption || post?.caption || r.postId).slice(0, 38) || r.postId}` : "All posts"} · {r.keyword ? `keyword “${r.keyword}”` : "any comment"} · {nReplies} repl{nReplies === 1 ? "y" : "ies"} · {r.matchCount ?? 0} sent</p>
                </div>
                <label className="flex items-center gap-1 text-[11px] text-ink-500 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={r.enabled} onChange={() => toggleRule(r)} /> on</label>
                <button onClick={() => { setRuleForm({ ...r, name: r.name ?? "", keyword: r.keyword ?? "", buttons: ruleButtonsOf(r), publicReplies: rulePublicRepliesOf(r), requireFollow: r.requireFollow ?? false, followPrompt: r.followPrompt ?? "" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
                <button onClick={() => delRule(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            );
          })}
          {!rules.some(r => r.replyOnly) && !ruleForm && !pickAccount && <p className="text-xs text-ink-400">No comment-reply rules yet — create one to auto-reply publicly under comments (no DM).</p>}
        </div>

        {/* Step 1: pick the Instagram account so posts are never mixed across accounts. */}
        {pickAccount && (
          <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
            <p className="text-xs font-bold text-ink-700">Which Instagram account is this rule for?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {channels.map(c => (
                <button key={c.id} type="button" onClick={() => { setRuleForm({ ...BLANK_RULE, replyOnly: pendingReplyOnly, channelId: c.id }); setPickAccount(false); }}
                  className="flex items-center gap-2 border border-line rounded-control px-3 py-2 text-left hover:border-pink-500 hover:bg-pink-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><Instagram className="w-4 h-4" /></div>
                  <div className="min-w-0"><p className="text-sm font-semibold text-ink-900 truncate">{c.name}</p><p className="text-[10px] text-ink-400 font-mono truncate">{c.igUserId}</p></div>
                </button>
              ))}
            </div>
            <button onClick={() => setPickAccount(false)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
        )}

        {ruleForm && (
          <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
            {channels.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-control bg-pink-50 text-pink-600 font-bold flex items-center gap-1"><Instagram className="w-3.5 h-3.5" /> {channels.find(c => c.id === ruleForm.channelId)?.name ?? "Account"}</span>
                <button type="button" onClick={() => { setRuleForm(null); setPickAccount(true); }} className="text-ink-400 hover:text-ink-900 font-semibold">Change account</button>
              </div>
            )}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${ruleForm.replyOnly ? "bg-violet-100 text-violet-700" : "bg-brand-100 text-brand-700"}`}>
              {ruleForm.replyOnly ? <><MessageCircle className="w-3 h-3" /> Comment reply only — no DM</> : <><Send className="w-3 h-3" /> Comment → DM</>}
            </span>
            <input className={`${inp} w-full`} placeholder="Rule name (internal)" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} />
            <div>
              <p className="text-[11px] font-bold text-ink-500 mb-1.5">Target post {channels.length > 1 && ruleForm.channelId && <span className="text-ink-400 font-normal">· {channels.find(c => c.id === ruleForm.channelId)?.name}</span>}</p>
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                <button type="button" onClick={() => setRuleForm({ ...ruleForm, postId: null, postCaption: null, postPermalink: null, postThumbnail: null })}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold border transition-colors ${!ruleForm.postId ? "ring-2 ring-pink-500 border-pink-500 text-pink-600 bg-pink-50" : "border-line text-ink-500 hover:bg-canvas"}`}>
                  <Instagram className="w-4 h-4" /> All
                </button>
                {posts.map(p => {
                  const sel = ruleForm.postId === p.id;
                  return (
                    <button type="button" key={p.id} title={p.caption || "(no caption)"} onClick={() => setRuleForm({ ...ruleForm, postId: p.id, postCaption: p.caption, postPermalink: p.permalink, postThumbnail: p.thumbnail })}
                      className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${sel ? "ring-2 ring-pink-500 border-pink-500" : "border-line hover:opacity-90"}`}>
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-canvas flex items-center justify-center text-ink-300"><Instagram className="w-4 h-4" /></div>}
                      {p.mediaType === "VIDEO" && <Video className="absolute top-1 right-1 w-3 h-3 text-white drop-shadow" />}
                      {sel && <span className="absolute inset-0 bg-pink-500/15 flex items-center justify-center"><Check className="w-5 h-5 text-white drop-shadow" /></span>}
                    </button>
                  );
                })}
              </div>
              {!posts.length && <p className="text-[11px] text-amber-600 mt-1.5">No posts loaded — token needs comment/media permissions. You can still create an &ldquo;All&rdquo; rule.</p>}
            </div>
            <div>
              <input className={`${inp} w-full`} placeholder="Trigger words — comma-separated (optional, blank = any comment)" value={ruleForm.keyword} onChange={e => setRuleForm({ ...ruleForm, keyword: e.target.value })} />
              <p className="text-[11px] text-ink-400 mt-1">Add several to match more comments, e.g. <span className="font-mono">guide, link, price, send me</span> — fires if the comment contains any one of them.</p>
            </div>
            {!ruleForm.replyOnly && (
            <textarea className={`${inp} w-full`} rows={2} placeholder="DM message, e.g. Thanks for commenting! Here's your guide 📄" value={ruleForm.dmMessage} onChange={e => setRuleForm({ ...ruleForm, dmMessage: e.target.value })} />
            )}
            {/* Link buttons — up to 3, shown as tappable buttons under the DM */}
            {!ruleForm.replyOnly && (
            <div className="space-y-2">
              {ruleForm.buttons.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${inp} w-1/3`} placeholder={`Button ${i + 1} label`} maxLength={20}
                    value={b.label}
                    onChange={e => { const next = [...ruleForm.buttons]; next[i] = { ...next[i], label: e.target.value }; setRuleForm({ ...ruleForm, buttons: next }); }} />
                  <input className={`${inp} flex-1`} placeholder="https://…"
                    value={b.url}
                    onChange={e => { const next = [...ruleForm.buttons]; next[i] = { ...next[i], url: e.target.value.trim() }; setRuleForm({ ...ruleForm, buttons: next }); }} />
                  <button type="button" onClick={() => setRuleForm({ ...ruleForm, buttons: ruleForm.buttons.filter((_, j) => j !== i) })}
                    className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0" title="Remove button"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              {ruleForm.buttons.length < MAX_BUTTONS && (
                <button type="button" onClick={() => setRuleForm({ ...ruleForm, buttons: [...ruleForm.buttons, { label: "", url: "" }] })}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border border-dashed border-line text-xs font-bold text-ink-600 hover:bg-canvas">
                  <Plus className="w-3.5 h-3.5" /> Add button {ruleForm.buttons.length ? `(${ruleForm.buttons.length}/${MAX_BUTTONS})` : "(optional)"}
                </button>
              )}
            </div>
            )}
            {/* Rotating public replies — the system picks one at random per comment
                so replies never look identical (an IG spam/ban signal). */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-ink-500">{ruleForm.replyOnly ? "Public replies — add a few variants and we rotate them at random on each comment (keeps replies natural, avoids spam flags)." : "Public reply under the comment (optional) — add a few variants and we rotate them so replies don't look automated."}</p>
              {ruleForm.publicReplies.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className={`${inp} flex-1`} placeholder={`Reply ${i + 1}, e.g. Sent you a DM! 📩`} maxLength={280}
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

            {/* Follow-to-unlock gate (DM rules only — a reply-only rule sends no link) */}
            {!ruleForm.replyOnly && (
            <div className="rounded-control bg-canvas border border-line p-2.5 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink-700 cursor-pointer">
                <input type="checkbox" className="accent-brand-700" checked={ruleForm.requireFollow} onChange={e => setRuleForm({ ...ruleForm, requireFollow: e.target.checked })} />
                <Lock className="w-3.5 h-3.5" /> Require a follow before sending the link
              </label>
              {ruleForm.requireFollow && <>
                <textarea className={`${inp} w-full`} rows={2} placeholder="Follow prompt, e.g. Almost there! Follow us, then tap “I've followed” to unlock your guide 🎁" value={ruleForm.followPrompt} onChange={e => setRuleForm({ ...ruleForm, followPrompt: e.target.value })} />
                <p className="text-[11px] text-ink-400">We DM a “Visit profile” + “I’ve followed ✅” button. On tap we re-check the follow, then send the link. Verified follow-checking needs extra Meta approval; until then we trust the tap.</p>
              </>}
            </div>
            )}

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
      </>
      )}
    </section>
  );
}

export default InstagramTab;
