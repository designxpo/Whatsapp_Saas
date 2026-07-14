"use client";

// Instagram (dedicated section) — extracted from admin/page.tsx, lazy-loaded. Logic unchanged.
import { useState, useEffect, useCallback } from "react";
import { Check, Instagram, Loader2, MessageCircle, Plus, Trash2, Video } from "lucide-react";
import { inp, type ChannelRow } from "../_shared";
import { fetchKbTags } from "./SettingsTab";
import { launchInstagramSignup, instagramSignupReady, instagramSignupMissing, metaPreview } from "@/lib/embedded-signup-client";

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
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>On your Meta app, add the <code className="font-mono text-[12px]">instagram_manage_messages</code> permission (and <code className="font-mono text-[12px]">instagram_manage_comments</code> for comment-to-DM), and subscribe the Instagram webhook to <code className="font-mono text-[12px]">/api/webhooks/instagram</code> (fields: <i>messages</i>, <i>comments</i>) using your existing verify token.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">4</span><span>Grab two things to paste below: the <b>Instagram account id</b> (the IG professional account / IGSID) and an <b>access token</b> with <code className="font-mono text-[12px]">instagram_manage_messages</code>. The Page id is optional.</span></li>
        </ol>
        <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Heads-up on Meta&apos;s rules (enforced automatically): you can only DM someone within <b>24 hours</b> of their last message, never cold-DM, and a comment reply is a single message. Staying inside these keeps the account safe from blocks.</p>
      </section>

      <InstagramManager />
    </div>
  );
}

const EMPTY_IG = { id: undefined as string | undefined, name: "", igUserId: "", pageId: "", token: "", agentId: "", kbTag: "", active: true, isDefault: false };

type CommentRule = {
  id?: string; channelId: string | null; name: string; enabled: boolean;
  postId: string | null; postCaption: string | null; postPermalink: string | null; postThumbnail: string | null;
  keyword: string; dmMessage: string; buttonLabel: string; buttonUrl: string; publicReply: string;
  requireFollow: boolean; followPrompt: string; matchCount?: number;
};
type IgPost = { id: string; caption: string; permalink: string; thumbnail: string; mediaType: string; timestamp: string };
const BLANK_RULE: CommentRule = { channelId: null, name: "", enabled: true, postId: null, postCaption: null, postPermalink: null, postThumbnail: null, keyword: "", dmMessage: "", buttonLabel: "", buttonUrl: "", publicReply: "", requireFollow: false, followPrompt: "" };

function InstagramManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [form, setForm] = useState<typeof EMPTY_IG | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Comment-to-DM rules (ManyChat-style: multiple rules, per-post, follow-gate)
  const [rules, setRules] = useState<CommentRule[]>([]);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [ruleForm, setRuleForm] = useState<CommentRule | null>(null);
  const [pickAccount, setPickAccount] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  const loadRules = useCallback(() => { fetch("/api/admin/ig-comment-rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setChannels((d.channels ?? []).filter((c: ChannelRow) => c.kind === "instagram"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { fetchKbTags().then(setKbTags); }, []);
  useEffect(() => { loadRules(); }, [loadRules]);
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
      else if (d.webhook && !d.webhook.ok) { setMsg(`Saved, but Meta refused the webhook subscription: ${d.webhook.detail}. DMs won't arrive until this is fixed — check the token's permissions.`); load(); }
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Disconnect this Instagram account? Its conversations stay.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function connectWithMeta() {
    if (!instagramSignupReady()) { setMsg(`Not enabled yet — this deployment is missing ${instagramSignupMissing().join(" + ")} (an EMPTY value counts as missing; NEXT_PUBLIC_* vars are baked in at build time, so redeploy after setting them). Owner: run Setup → Meta connection doctor for the full diagnosis. For now, use “Add manually”.`); return; }
    setBusy(true); setMsg(null);
    try {
      const { code } = await launchInstagramSignup();
      const res = await fetch("/api/admin/onboarding/instagram", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Connection failed");
      else { setForm(null); load(); }
    } catch (e) { setMsg(e instanceof Error ? e.message : "Connection cancelled"); }
    finally { setBusy(false); }
  }

  async function saveRule() {
    if (!ruleForm) return;
    if (!ruleForm.dmMessage.trim()) { setMsg("DM message is required"); return; }
    setRuleBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/ig-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ruleForm) });
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

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Instagram className="w-3.5 h-3.5 text-pink-600" /> Instagram</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect an Instagram professional account to auto-reply to DMs and turn post comments into DMs — all within Meta&apos;s rules (24-hour window, no cold DMs).</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(instagramSignupReady() || metaPreview()) && (
            <div className="flex items-center gap-1.5">
              <button onClick={connectWithMeta} disabled={busy} className="px-3 py-1.5 rounded-control bg-[#0783fd] hover:bg-[#0668d6] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5" />} Connect with Facebook
              </button>
              {!instagramSignupReady() && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Preview</span>}
            </div>
          )}
          <button onClick={() => { setForm({ ...EMPTY_IG }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add manually</button>
        </div>
      </div>

      {channels.map(c => (
        <div key={c.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><Instagram className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{c.name} {c.isDefault && <span className="text-[10px] font-bold text-brand-700">· DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
            <p className="text-[11px] text-ink-400 font-mono truncate">ig {c.igUserId}{c.pageId ? ` · page ${c.pageId}` : ""} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
          </div>
          <button onClick={() => { setForm({ id: c.id, name: c.name, igUserId: c.igUserId ?? "", pageId: c.pageId ?? "", token: "", agentId: c.agentId ?? "", kbTag: c.kbTag ?? "", active: c.active, isDefault: c.isDefault }); setMsg(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {form && (
        <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. @analytixlabs" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
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
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save account"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Needs an IG <b>professional</b> account linked to a Facebook Page, the <code className="font-mono">instagram_manage_messages</code> permission on your Meta app, and the IG webhook pointed at <code className="font-mono">/api/webhooks/instagram</code>.</p>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!channels.length && !form && <p className="text-xs text-ink-400">No Instagram accounts connected yet.</p>}

      {/* Comment-to-DM automation (ManyChat-style: multiple rules, per-post, follow-gate) */}
      <div className="border-t border-line pt-3 mt-1 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Comment-to-DM automation</p>
          <button onClick={() => { setMsg(null); if (channels.length > 1) { setRuleForm(null); setPickAccount(true); } else { setPickAccount(false); setRuleForm({ ...BLANK_RULE, channelId: channels[0]?.id ?? null }); } }} className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New rule</button>
        </div>
        <p className="text-[11px] text-ink-400">When someone comments, send them ONE private DM (Meta allows a single reply per comment). Target a specific post or all posts, gate by keyword, attach a link button, and optionally require a follow first — like ManyChat.</p>

        {rules.map(r => {
          const post = posts.find(p => p.id === r.postId);
          const thumb = r.postThumbnail || post?.thumbnail;
          return (
            <div key={r.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
              {thumb
                ? <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-10 h-10 rounded-lg bg-pink-50 text-pink-600 flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 truncate">{r.name || (r.keyword ? `“${r.keyword}”` : "Any comment")}{channels.length > 1 && r.channelId && <span className="text-[10px] font-bold text-pink-600"> · {channels.find(c => c.id === r.channelId)?.name ?? "IG"}</span>}{!r.enabled && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
                <p className="text-[11px] text-ink-400 truncate">{r.postId ? `Post: ${(r.postCaption || post?.caption || r.postId).slice(0, 38) || r.postId}` : "All posts"} · {r.keyword ? `keyword “${r.keyword}”` : "any comment"}{r.buttonUrl ? " · 🔗 button" : ""}{r.requireFollow ? " · 🔒 follow" : ""} · {r.matchCount ?? 0} sent</p>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-ink-500 cursor-pointer shrink-0"><input type="checkbox" className="accent-brand-700" checked={r.enabled} onChange={() => toggleRule(r)} /> on</label>
              <button onClick={() => { setRuleForm({ ...r, name: r.name ?? "", keyword: r.keyword ?? "", buttonLabel: r.buttonLabel ?? "", buttonUrl: r.buttonUrl ?? "", publicReply: r.publicReply ?? "", requireFollow: r.requireFollow ?? false, followPrompt: r.followPrompt ?? "" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
              <button onClick={() => delRule(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {!rules.length && !ruleForm && !pickAccount && <p className="text-xs text-ink-400">No comment rules yet — create one to turn post comments into DMs.</p>}

        {/* Step 1: pick the Instagram account so posts are never mixed across accounts. */}
        {pickAccount && (
          <div className="border-2 border-pink-500/30 rounded-control p-3 space-y-2">
            <p className="text-xs font-bold text-ink-700">Which Instagram account is this rule for?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {channels.map(c => (
                <button key={c.id} type="button" onClick={() => { setRuleForm({ ...BLANK_RULE, channelId: c.id }); setPickAccount(false); }}
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
            <input className={`${inp} w-full`} placeholder="Trigger keyword (optional — blank = any comment)" value={ruleForm.keyword} onChange={e => setRuleForm({ ...ruleForm, keyword: e.target.value })} />
            <textarea className={`${inp} w-full`} rows={2} placeholder="DM message, e.g. Thanks for commenting! Here's your guide 📄" value={ruleForm.dmMessage} onChange={e => setRuleForm({ ...ruleForm, dmMessage: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Button label (optional, e.g. Download)" maxLength={20} value={ruleForm.buttonLabel} onChange={e => setRuleForm({ ...ruleForm, buttonLabel: e.target.value })} />
              <input className={inp} placeholder="Button link https://… (optional)" value={ruleForm.buttonUrl} onChange={e => setRuleForm({ ...ruleForm, buttonUrl: e.target.value.trim() })} />
            </div>
            <input className={`${inp} w-full`} placeholder="Public reply under the comment (optional, e.g. Sent you a DM! 📩)" value={ruleForm.publicReply} onChange={e => setRuleForm({ ...ruleForm, publicReply: e.target.value })} />

            {/* Follow-to-unlock gate */}
            <div className="rounded-control bg-canvas border border-line p-2.5 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-ink-700 cursor-pointer">
                <input type="checkbox" className="accent-brand-700" checked={ruleForm.requireFollow} onChange={e => setRuleForm({ ...ruleForm, requireFollow: e.target.checked })} />
                🔒 Require a follow before sending the link
              </label>
              {ruleForm.requireFollow && <>
                <textarea className={`${inp} w-full`} rows={2} placeholder="Follow prompt, e.g. Almost there! Follow us, then tap “I've followed” to unlock your guide 🎁" value={ruleForm.followPrompt} onChange={e => setRuleForm({ ...ruleForm, followPrompt: e.target.value })} />
                <p className="text-[11px] text-ink-400">We DM a “Visit profile” + “I've followed ✅” button. On tap we re-check the follow, then send the link. Verified blocking needs Meta App Review (<code className="font-mono">is_user_follow_business</code>); until then we trust the tap.</p>
              </>}
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

export default InstagramTab;
