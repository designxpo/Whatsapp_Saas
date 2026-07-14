"use client";

// Settings: workspace rail + plan/usage, WhatsApp numbers, team, activity log,
// welcome/away messages, quick replies, LeadSquared CRM + API keys. Extracted
// from admin/page.tsx, lazy-loaded. Pure relocation.
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Trash2, RefreshCw, Phone, Loader2, Facebook, MessageSquare, MessageCircle, Copy, Check, UploadCloud } from "lucide-react";
import { inp, RailCard, StatRow, ConvAvatar, type ChannelRow, setChannelCache, type Tab } from "../_shared";
import { launchWhatsAppSignup, whatsappSignupReady, whatsappSignupMissing, metaPreview } from "@/lib/embedded-signup-client";

function SettingsRail({ goTo }: { goTo: (t: Tab) => void }) {
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [qrCount, setQrCount] = useState<number | null>(null);
  useEffect(() => { fetch("/api/admin/team/members").then(r => r.json()).then(d => setTeamCount((d.members ?? []).length)).catch(() => setTeamCount(0)); }, []);
  useEffect(() => { fetch("/api/admin/quick-replies").then(r => r.json()).then(d => setQrCount((d.quickReplies ?? []).length)).catch(() => setQrCount(0)); }, []);
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="Workspace">
        <StatRow label="People with portal access" value={teamCount ?? "…"} />
        <StatRow label="Quick replies" value={qrCount ?? "…"} />
      </RailCard>
      <RailCard title="Who can do what">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li><b>Admins</b> — everything, including numbers, team, and settings.</li>
          <li><b>Members</b> — Live Chat, broadcasts, flows, templates, contacts.</li>
          <li>Every action is recorded in the <b>activity log</b> on this page.</li>
        </ul>
      </RailCard>
      <RailCard title="Message automations">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li><b>Welcome</b> — sent once, the first time a contact ever messages you.</li>
          <li><b>Away</b> — sent outside your business hours.</li>
          <li><b>Quick replies</b> — type <b>/</b> in the Live Chat composer to use them.</li>
        </ul>
      </RailCard>
      <RailCard title="Go-live reminders" action="Checklist" onAction={() => goTo("home")}>
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Keep your WhatsApp two-step PIN recorded somewhere safe.</li>
          <li>Rotate the admin password once setup is done.</li>
          <li>The cron heartbeat sends queued broadcasts every 5 minutes.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

type WelcomeS = { enabled: boolean; text: string };
type AwayS = { enabled: boolean; text: string; startHour: number; endHour: number; tzOffsetMinutes: number };

// ── Team members + activity log ──
type TeamUserRow = { id: string; email: string; name: string; title: string; role: "admin" | "member"; active: boolean; lastLoginAt: string | null };

function TeamManager() {
  const [users, setUsers] = useState<TeamUserRow[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; email: string; name: string; title: string; role: "admin" | "member"; password: string; active: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/team").then(r => r.json()).then(d => { setUsers(d.users ?? []); setOwner(d.owner ?? null); setNotice(d.notice ?? null); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form) return;
    if (!form.email.trim()) { setMsg("Email is required."); return; }
    if (!form.id && !form.password.trim()) { setMsg("Password is required for a new member."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(u: TeamUserRow) {
    if (!confirm(`Remove ${u.email}? They'll be signed out and can't log in again.`)) return;
    await fetch("/api/admin/team", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: u.id, email: u.email }) });
    load();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Team members</p>
          <p className="text-xs text-slate-500 mt-0.5">Everyone gets their own login. Admins can manage numbers, team, and settings; members get everything else (inbox, broadcasts, flows…). All actions are recorded in the activity log.</p>
        </div>
        <button onClick={() => { setForm({ email: "", name: "", title: "", role: "member", password: "", active: true }); setMsg(null); }}
          className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add member</button>
      </div>

      {notice && <p className="text-xs text-amber-700 bg-amber-50 rounded-control px-3 py-2">{notice} — apply migration <code className="font-mono">0014_team.sql</code>.</p>}

      {owner && (
        <div className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5 bg-canvas/50">
          <div className="w-8 h-8 rounded-full bg-ink-950 text-white flex items-center justify-center text-xs font-bold shrink-0">★</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{owner} <span className="text-[10px] font-bold text-brand-700">· OWNER</span></p>
            <p className="text-[11px] text-ink-400">The env account — always admin, managed via ADMIN_USER/ADMIN_PASSWORD</p>
          </div>
        </div>
      )}

      {users.map(u => (
        <div key={u.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${u.active ? "bg-brand-50 text-brand-700" : "bg-canvas text-ink-400"}`}>
            {(u.name || u.email).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">
              {u.name || u.email} <span className={`text-[10px] font-bold ${u.role === "admin" ? "text-brand-700" : "text-ink-400"}`}>· {u.role.toUpperCase()}</span>
              {!u.active && <span className="text-[10px] font-bold text-red-500"> · DISABLED</span>}
            </p>
            <p className="text-[11px] text-ink-400 truncate">{u.title ? `${u.title} · ` : ""}{u.email}{u.lastLoginAt ? ` · last login ${new Date(u.lastLoginAt).toLocaleString()}` : " · never logged in"}</p>
          </div>
          <button onClick={() => { setForm({ id: u.id, email: u.email, name: u.name, title: u.title ?? "", role: u.role, password: "", active: u.active }); setMsg(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(u)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {form && (
        <div className="border-2 border-brand-700/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="email@company.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} disabled={!!form.id} />
            <input className={inp} placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Role / persona — e.g. Sales Counsellor, Support Lead" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <select className={inp} value={form.role} onChange={e => setForm({ ...form, role: e.target.value as "admin" | "member" })}>
              <option value="member">Member — inbox, broadcasts, flows, templates</option>
              <option value="admin">Admin — everything incl. numbers & team</option>
            </select>
            <input className={inp} type="password" placeholder={form.id ? "New password (blank = keep current)" : "Password"} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save member"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!users.length && !form && !notice && <p className="text-xs text-ink-400">No members yet — only the owner account can log in.</p>}
    </section>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in", "broadcast.send": "Sent broadcast", "broadcast.test": "Sent test message", "template.create": "Created template",
  "template.delete": "Deleted template", "form.create": "Created form", "form.publish": "Published form",
  "form.delete": "Deleted form", "form.deprecate": "Deprecated form", "flow.save": "Saved flow",
  "flow.delete": "Deleted flow", "inbox.reply": "Replied in inbox", "contacts.import": "Imported contacts",
  "channel.save": "Saved WhatsApp number", "channel.delete": "Removed WhatsApp number",
  "rule.save": "Saved API rule", "rule.toggle": "Toggled API rule", "rule.delete": "Deleted API rule",
  "settings.save": "Changed settings", "optout.add": "Added opt-out", "optout.remove": "Removed opt-out",
  "team.add": "Added team member", "team.update": "Updated team member", "team.remove": "Removed team member",
  "ads.connect": "Connected ad account", "ads.pause": "Paused ad campaign", "ads.resume": "Resumed ad campaign", "ads.budget": "Changed ad budget",
  "contact.update": "Updated contact",
};

function ActivityLog() {
  const [entries, setEntries] = useState<{ id: string; userEmail: string; userName: string; action: string; detail: string; at: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const d = await fetch("/api/admin/activity?limit=200").then(r => r.json());
      setEntries(d.activity ?? []);
    } catch { /* keep last */ }
    setRefreshing(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Activity log</p>
          <p className="text-xs text-slate-500 mt-0.5">Who did what, newest first — logins, broadcasts, template/flow/form changes, inbox replies, settings.</p>
        </div>
        <button onClick={load} disabled={refreshing} className="shrink-0 px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto divide-y divide-line -mx-5 px-5">
        {entries.map(e => (
          <div key={e.id} className="py-2 flex items-start gap-3">
            <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
              {(e.userName || e.userEmail).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink-900">
                <span className="font-semibold">{e.userName || e.userEmail}</span>{" "}
                <span className="text-ink-600">{ACTION_LABELS[e.action] ?? e.action}</span>
                {e.detail && <span className="text-ink-400"> — {e.detail}</span>}
              </p>
              <p className="text-[11px] text-ink-400">{new Date(e.at).toLocaleString()}</p>
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="py-6 text-center text-xs text-ink-400">No activity recorded yet (needs migration 0014_team.sql).</p>}
      </div>
    </section>
  );
}

// ── WhatsApp numbers (multi-WABA channels) ──
const EMPTY_CHANNEL = { id: undefined as string | undefined, name: "", phoneId: "", wabaId: "", token: "", appId: "", agentId: "", kbTag: "", active: true, isDefault: false };

// Distinct KB topic tags for the per-channel knowledge picker — same client-side
// derivation the flow editor uses (tags live on kb_documents, no dedicated API).
export async function fetchKbTags(): Promise<string[]> {
  try {
    const d = await fetch("/api/admin/kb").then(r => r.json());
    return [...new Set(((d.documents ?? []) as { tag?: string | null }[]).map(x => x.tag).filter((t): t is string => !!t))].sort();
  } catch { return []; }
}

function ChannelsManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [envMode, setEnvMode] = useState(false);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [form, setForm] = useState<typeof EMPTY_CHANNEL | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [profileFor, setProfileFor] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setChannels(d.channels ?? []); setEnvMode(d.envMode ?? false);
    setChannelCache(d.channels ?? []);     // keep the shared pickers in sync
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { fetchKbTags().then(setKbTags); }, []);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.phoneId.trim() || !form.wabaId.trim()) { setMsg("Name, Phone Number ID and WABA ID are required."); return; }
    if (!form.id && !form.token.trim()) { setMsg("Access token is required for a new number."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, agentId: form.agentId || null, kbTag: form.kbTag || null, appId: form.appId || null }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this number? Its conversations stay but will reply via the default credentials.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function connectWithMeta() {
    if (!whatsappSignupReady()) { setMsg(`Not enabled yet — this deployment is missing ${whatsappSignupMissing().join(" + ")} (an EMPTY value counts as missing; NEXT_PUBLIC_* vars are baked in at build time, so redeploy after setting them). Owner: run Setup → Meta connection doctor for the full diagnosis. For now, use “Add manually”.`); return; }
    setBusy(true); setMsg(null);
    try {
      const { code, wabaId, phoneNumberId } = await launchWhatsAppSignup();
      const res = await fetch("/api/admin/onboarding/whatsapp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wabaId, phoneNumberId }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Connection failed");
      else { setForm(null); load(); }
    } catch (e) { setMsg(e instanceof Error ? e.message : "Connection cancelled"); }
    finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">WhatsApp numbers</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect multiple numbers/WABAs — each gets its own AI persona, flows, templates, and broadcasts. Inbound routes automatically; replies always leave from the same number.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(whatsappSignupReady() || metaPreview()) && (
            <div className="flex items-center gap-1.5">
              <button onClick={connectWithMeta} disabled={busy} className="px-3 py-1.5 rounded-control bg-[#0783fd] hover:bg-[#0668d6] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />} Connect with Facebook
              </button>
              {!whatsappSignupReady() && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Preview</span>}
            </div>
          )}
          <button onClick={() => { setForm({ ...EMPTY_CHANNEL }); setMsg(null); }} className="px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add manually</button>
        </div>
      </div>

      {envMode && <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Currently running on the <code className="font-mono">META_WA_*</code> env credentials (single-number mode). Adding numbers here switches inbound routing to per-number.</p>}

      {channels.filter(c => (c.kind ?? "whatsapp") === "whatsapp").map(c => (
        <div key={c.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><Phone className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{c.name} {c.isDefault && <span className="text-[10px] font-bold text-brand-700">· DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
            <p className="text-[11px] text-ink-400 font-mono truncate">phone {c.phoneId} · waba {c.wabaId} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
          </div>
          <button onClick={() => { setProfileFor(profileFor?.id === c.id ? null : { id: c.id, name: c.name }); setForm(null); }}
            className={`px-2.5 py-1 rounded-control border text-xs font-bold shrink-0 ${profileFor?.id === c.id ? "border-brand-700 text-brand-700 bg-brand-50" : "border-line text-ink-600 hover:bg-canvas"}`}>Profile</button>
          <button onClick={() => { setForm({ id: c.id, name: c.name, phoneId: c.phoneId, wabaId: c.wabaId, token: "", appId: c.appId ?? "", agentId: c.agentId ?? "", kbTag: c.kbTag ?? "", active: c.active, isDefault: c.isDefault }); setMsg(null); setProfileFor(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {channels.filter(c => (c.kind ?? "whatsapp") === "whatsapp").length === 0 && (
        <p className="text-[11px] text-ink-400 border border-dashed border-line rounded-control px-3 py-3">
          No extra WhatsApp numbers added. Instagram, Web Chat and Facebook are separate channels and live in their own tabs, not here.
        </p>
      )}

      {profileFor && <BusinessProfileEditor key={profileFor.id} channelId={profileFor.id} name={profileFor.name} onClose={() => setProfileFor(null)} />}

      {form && (
        <div className="border-2 border-brand-700/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. Sales India" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Phone Number ID (Meta → API Setup)" value={form.phoneId} onChange={e => setForm({ ...form, phoneId: e.target.value.trim() })} />
            <input className={inp} placeholder="WABA ID" value={form.wabaId} onChange={e => setForm({ ...form, wabaId: e.target.value.trim() })} />
            <input className={inp} placeholder="Meta App ID (for template media)" value={form.appId} onChange={e => setForm({ ...form, appId: e.target.value.trim() })} />
          </div>
          <input className={`${inp} w-full font-mono`} placeholder={form.id ? "Access token — leave blank to keep the current one" : "System-user access token"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
          <div className="flex items-center gap-3 flex-wrap">
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this number">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
            <select className={inp} value={form.kbTag} onChange={e => setForm({ ...form, kbTag: e.target.value })} title="AI on this number answers from KB docs with this tag first, falling back to the full knowledge base. Tag docs in the AI Knowledge Base tab.">
              <option value="">Knowledge: global (all docs)</option>
              {kbTags.map(t => <option key={t} value={t}>Knowledge: {t}</option>)}
              {form.kbTag && !kbTags.includes(form.kbTag) && <option value={form.kbTag}>Knowledge: {form.kbTag}</option>}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> default for sends</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save number"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!channels.length && !form && !envMode && <p className="text-xs text-ink-400">No numbers connected yet.</p>}
    </section>
  );
}

// ── WhatsApp business profile editor (the connected number's own profile) ──────
const WA_VERTICAL_OPTS: { v: string; label: string }[] = [
  { v: "", label: "Industry: not set" },
  { v: "PROF_SERVICES", label: "Professional Services" }, { v: "EDU", label: "Education" },
  { v: "FINANCE", label: "Finance" }, { v: "HEALTH", label: "Health" }, { v: "RETAIL", label: "Retail" },
  { v: "APPAREL", label: "Apparel" }, { v: "BEAUTY", label: "Beauty" }, { v: "AUTO", label: "Automotive" },
  { v: "TRAVEL", label: "Travel" }, { v: "HOTEL", label: "Hotel" }, { v: "RESTAURANT", label: "Restaurant" },
  { v: "GROCERY", label: "Grocery" }, { v: "ENTERTAIN", label: "Entertainment" }, { v: "EVENT_PLAN", label: "Event Planning" },
  { v: "GOVT", label: "Government" }, { v: "NONPROFIT", label: "Non-profit" }, { v: "OTHER", label: "Other" },
];

function BusinessProfileEditor({ channelId, name, onClose }: { channelId: string; name: string; onClose: () => void }) {
  const [p, setP] = useState({ about: "", description: "", email: "", address: "", vertical: "", website: "" });
  const [photoUrl, setPhotoUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/admin/channels/profile?channelId=${encodeURIComponent(channelId)}`)
      .then(r => r.json()).then(d => {
        if (d.profile) {
          setP({ about: d.profile.about ?? "", description: d.profile.description ?? "", email: d.profile.email ?? "", address: d.profile.address ?? "", vertical: d.profile.vertical ?? "", website: (d.profile.websites ?? [])[0] ?? "" });
          setPhotoUrl(d.profile.profilePictureUrl ?? "");
        } else if (d.notice) setMsg(d.notice);
      }).catch(() => setMsg("Could not load profile")).finally(() => setLoading(false));
  }, [channelId]);

  async function saveFields() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/profile", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, about: p.about, description: p.description, email: p.email, address: p.address, vertical: p.vertical, websites: p.website ? [p.website] : [] }),
      });
      const d = await res.json();
      setMsg(res.ok ? "Saved ✓" : (d.error || "Save failed"));
    } finally { setBusy(false); }
  }

  async function uploadPhoto(file: File) {
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("channelId", channelId);
      fd.append("file", file);
      const res = await fetch("/api/admin/channels/profile", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { setMsg(d.error || "Photo upload failed"); return; }
      setMsg("Photo updated ✓ — refreshing…");
      const r = await fetch(`/api/admin/channels/profile?channelId=${encodeURIComponent(channelId)}`).then(x => x.json()).catch(() => null);
      if (r?.profile?.profilePictureUrl) setPhotoUrl(r.profile.profilePictureUrl);
    } finally { setBusy(false); }
  }

  return (
    <div className="border-2 border-brand-700/30 rounded-control p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-ink-900">Business profile — <span className="text-brand-700">{name}</span></p>
        <button onClick={onClose} className="text-xs font-semibold text-ink-400 hover:text-ink-900">Close</button>
      </div>
      {loading ? <p className="text-xs text-ink-400">Loading…</p> : (
        <>
          <div className="flex items-center gap-3">
            <ConvAvatar url={photoUrl} label={name} size={56} />
            <div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={e => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); }} />
              <button onClick={() => fileRef.current?.click()} disabled={busy} className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60">Change photo</button>
              <p className="text-[10px] text-ink-400 mt-1">Square JPEG/PNG, ≥192px.</p>
            </div>
          </div>
          <input className={`${inp} w-full`} placeholder="About (status, ≤139 chars)" maxLength={139} value={p.about} onChange={e => setP({ ...p, about: e.target.value })} />
          <textarea className={`${inp} w-full`} rows={2} placeholder="Description (≤512 chars)" maxLength={512} value={p.description} onChange={e => setP({ ...p, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Email" value={p.email} onChange={e => setP({ ...p, email: e.target.value })} />
            <input className={inp} placeholder="Website (https://…)" value={p.website} onChange={e => setP({ ...p, website: e.target.value })} />
            <input className={inp} placeholder="Address" value={p.address} onChange={e => setP({ ...p, address: e.target.value })} />
            <select className={inp} value={p.vertical} onChange={e => setP({ ...p, vertical: e.target.value })}>
              {WA_VERTICAL_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveFields} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save profile"}</button>
            {msg && <p className={`text-xs ${msg.includes("✓") ? "text-emerald-600" : "text-red-500"}`}>{msg}</p>}
          </div>
        </>
      )}
    </div>
  );
}



// Tenant-facing plan + usage card (consumption vs plan limits).
function UsageCard() {
  const [u, setU] = useState<{ usage: { contacts: number; messages: number; channels: number; seats: number }; limits: { contacts: number; messages_per_month: number; channels: number; team_seats: number }; plan: string; status: string; trialEndsAt: string | null } | null>(null);
  useEffect(() => { fetch("/api/admin/usage").then(r => r.json()).then(d => { if (!d.error) setU(d); }).catch(() => {}); }, []);
  if (!u) return null;
  const rows: [string, number, number][] = [
    ["Contacts", u.usage.contacts, u.limits.contacts],
    ["Messages this month", u.usage.messages, u.limits.messages_per_month],
    ["Channels", u.usage.channels, u.limits.channels],
    ["Team seats", u.usage.seats, u.limits.team_seats],
  ];
  const trialLeft = u.trialEndsAt ? Math.max(0, Math.ceil((new Date(u.trialEndsAt).getTime() - Date.now()) / 86400000)) : null;
  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Plan &amp; usage</p>
          <p className="text-sm font-semibold text-ink-900 capitalize">{u.plan} plan {u.status === "trialing" && trialLeft !== null && <span className="text-[11px] font-bold text-amber-600">· {trialLeft} days left in trial</span>}</p>
        </div>
        <a href="/admin/billing" className="shrink-0 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold">Manage plan</a>
      </div>
      <div className="space-y-2.5">
        {rows.map(([label, used, limit]) => {
          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
          const near = limit > 0 && used / limit >= 0.8;
          return (
            <div key={label}>
              <div className="flex justify-between text-[11px] mb-0.5"><span className="text-ink-500">{label}</span><span className={`font-mono ${near ? "text-amber-600 font-bold" : "text-ink-400"}`}>{used.toLocaleString()} / {limit > 0 ? limit.toLocaleString() : "∞"}</span></div>
              <div className="h-1.5 rounded-full bg-canvas overflow-hidden"><div className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : near ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${limit > 0 ? pct : 4}%` }} /></div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// Developer API keys — mint per-tenant keys for the public API (/api/broadcast,
// /api/events, /api/contacts). The full key is shown once on creation.
function ApiKeysCard() {
  const [keys, setKeys] = useState<{ id: string; name: string; prefix: string; lastUsedAt: string | null; revoked: boolean }[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/admin/api-keys").then(r => r.json()).then(d => setKeys(d.keys ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true); setFresh(null);
    try {
      const d = await fetch("/api/admin/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(r => r.json());
      if (d.key) { setFresh(d.key); setName(""); load(); } else alert(d.error || "Failed");
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Any integration using it stops working immediately.")) return;
    await fetch("/api/admin/api-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <p className="text-xs font-bold text-slate-400 uppercase">API access (developers)</p>
      <p className="text-[11px] text-ink-400">Use a key as <code className="font-mono">Authorization: Bearer ak_live_…</code> to call <code className="font-mono">/api/broadcast</code>, <code className="font-mono">/api/events</code> and <code className="font-mono">/api/contacts</code>. Each key is scoped to this workspace.</p>
      <div className="flex gap-2">
        <input className="flex-1 border border-line rounded-control px-2 py-1.5 text-xs bg-white" placeholder="Key name (e.g. CRM integration)" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={create} disabled={busy} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold shrink-0">Create key</button>
      </div>
      {fresh && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-control px-3 py-2 space-y-1">
          <p className="text-[11px] font-bold text-emerald-800">Copy this key now — it won&apos;t be shown again:</p>
          <code className="block font-mono text-[11px] text-emerald-900 break-all select-all">{fresh}</code>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {keys.filter(k => !k.revoked).map(k => (
          <div key={k.id} className="flex items-center justify-between py-2 gap-3">
            <div className="min-w-0">
              <span className="text-xs font-bold text-brand-dark">{k.name}</span>
              <p className="text-[11px] text-slate-500 font-mono">{k.prefix} · {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}</p>
            </div>
            <button onClick={() => revoke(k.id)} className="text-[11px] font-bold text-red-500 hover:text-red-700 shrink-0">Revoke</button>
          </div>
        ))}
        {keys.filter(k => !k.revoked).length === 0 && <p className="text-center text-slate-400 text-sm py-3">No API keys yet.</p>}
      </div>
    </section>
  );
}


// Voice replies — inbound voice notes are transcribed; optionally reply in voice.
function VoiceSettingsCard() {
  type VoiceState = { mode: "off" | "mirror" | "always"; keySet: boolean; providerIsOpenai: boolean };
  const [st, setSt] = useState<VoiceState | null>(null);
  const [mode, setMode] = useState<"off" | "mirror" | "always">("off");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/voice").then(r => r.json()).then((d: VoiceState) => { setSt(d); setMode(d.mode ?? "off"); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, openaiKey: key }) }).then(r => r.json());
      setMsg(d.error ? d.error : "Saved.");
      if (!d.error) { setKey(""); load(); }
    } catch { setMsg("Connection error."); }
    finally { setBusy(false); }
  }

  const needsKey = st && !st.providerIsOpenai && !st.keySet && mode !== "off";

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Voice replies</h3>
        <p className="text-[12px] text-slate-500">Customers can <span className="font-semibold">send voice notes</span> (auto-transcribed and answered) on WhatsApp &amp; Instagram. Optionally have the AI <span className="font-semibold">reply in voice</span> too.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-bold text-slate-400 uppercase">Reply in voice</label>
          <select className={`${inp} w-full mt-1`} value={mode} onChange={e => setMode(e.target.value as VoiceState["mode"])}>
            <option value="off">Off — always reply with text</option>
            <option value="mirror">Mirror — voice only when they send voice</option>
            <option value="always">Always — reply in voice every time</option>
          </select>
        </div>
        {st && !st.providerIsOpenai && (
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase">OpenAI voice key {st.keySet ? "(set)" : "(optional)"}</label>
            <input className={`${inp} w-full mt-1`} type="password" placeholder={st.keySet ? "Leave blank to keep current" : "sk-… (for speech)"} value={key} onChange={e => setKey(e.target.value)} />
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        {st?.providerIsOpenai
          ? "Transcription + speech use your OpenAI AI key — nothing else to add."
          : "Incoming voice notes are transcribed by your AI (Gemini does this natively). Replying in voice uses OpenAI text-to-speech, so add an OpenAI key above to enable it."}
      </p>
      {needsKey && <p className="text-[12px] font-medium text-amber-600">Add an OpenAI voice key to enable spoken replies — until then replies stay as text.</p>}
      {msg && <p className={`text-[12px] font-medium ${msg === "Saved." ? "text-emerald-700" : "text-red-600"}`}>{msg}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
        {st?.keySet && <button onClick={async () => { await fetch("/api/admin/voice", { method: "DELETE" }); load(); }} className="px-3 py-1.5 rounded-control border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50">Remove key</button>}
      </div>
    </section>
  );
}

// LeadSquared CRM moved into the Integrations hub (added like any other connector
// via "Add an integration" → LeadSquared). Its old dedicated card lived here.

// ── Facebook Messenger Pages (connect a Page to auto-reply to DMs) ─────────────
const EMPTY_FB_PAGE = { id: undefined as string | undefined, name: "", pageId: "", token: "", agentId: "", kbTag: "", active: true, isDefault: false };

// Comment-to-DM rules (ManyChat-style: multiple rules, per-post targeting). No
// follow-gate — Facebook Pages have no is_user_follow_business comment flow.
type FbCommentRule = {
  id?: string; channelId: string | null; name: string; enabled: boolean;
  postId: string | null; postCaption: string | null; postPermalink: string | null; postThumbnail: string | null;
  keyword: string; dmMessage: string; buttonLabel: string; buttonUrl: string; publicReply: string; matchCount?: number;
};
type FbPost = { id: string; caption: string; permalink: string; thumbnail: string; mediaType: string; timestamp: string };
const BLANK_FB_RULE: FbCommentRule = { channelId: null, name: "", enabled: true, postId: null, postCaption: null, postPermalink: null, postThumbnail: null, keyword: "", dmMessage: "", buttonLabel: "", buttonUrl: "", publicReply: "" };

export function MessengerCard() {
  const [pages, setPages] = useState<ChannelRow[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FB_PAGE | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Comment-to-DM rules
  const [rules, setRules] = useState<FbCommentRule[]>([]);
  const [posts, setPosts] = useState<FbPost[]>([]);
  const [ruleForm, setRuleForm] = useState<FbCommentRule | null>(null);
  const [pickAccount, setPickAccount] = useState(false);
  const [ruleBusy, setRuleBusy] = useState(false);
  const loadRules = useCallback(() => { fetch("/api/admin/fb-comment-rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setPages((d.channels ?? []).filter((c: ChannelRow) => c.kind === "messenger"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRules(); }, [loadRules]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { fetchKbTags().then(setKbTags); }, []);
  // Load the post grid for the Page the rule editor is targeting (only when the
  // editor opens or the Page changes — so it won't refetch on every keystroke).
  const editorChannel = ruleForm ? (ruleForm.channelId ?? "") : null;
  useEffect(() => {
    if (editorChannel === null) return;
    const qs = editorChannel ? `?channelId=${encodeURIComponent(editorChannel)}` : "";
    setPosts([]);
    fetch(`/api/admin/fb-posts${qs}`).then(r => r.json()).then(d => setPosts(d.media ?? [])).catch(() => {});
  }, [editorChannel]);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.pageId.trim()) { setMsg("Label and Facebook Page id are required."); return; }
    if (!form.id && !form.token.trim()) { setMsg("Page access token is required for a new Page."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/messenger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, agentId: form.agentId || null, kbTag: form.kbTag || null }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else if (d.webhook && !d.webhook.ok) { setMsg(`Saved, but Meta refused the webhook subscription: ${d.webhook.detail}. Messages won't arrive until this is fixed — check the Page token's permissions (pages_messaging).`); load(); }
      else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this Facebook Page? Its conversations stay but it will stop replying.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function saveRule() {
    if (!ruleForm) return;
    if (!ruleForm.dmMessage.trim()) { setMsg("DM message is required"); return; }
    setRuleBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/fb-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ruleForm) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setRuleForm(null); loadRules(); }
    } finally { setRuleBusy(false); }
  }
  async function toggleRule(r: FbCommentRule) {
    await fetch("/api/admin/fb-comment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, enabled: !r.enabled }) }).catch(() => {});
    loadRules();
  }
  async function delRule(id?: string) {
    if (!id || !confirm("Delete this comment rule?")) return;
    await fetch("/api/admin/fb-comment-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    loadRules();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><Facebook className="w-3.5 h-3.5 text-blue-600" /> Facebook Messenger</p>
          <p className="text-xs text-slate-500 mt-0.5">Connect a Facebook Page to auto-reply to Messenger DMs with your AI — within Meta&apos;s rules (24-hour window, no cold messages). Page DMs land in the same Live Chat inbox.</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_FB_PAGE }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Page</button>
      </div>

      {pages.map(c => (
        <div key={c.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Facebook className="w-4 h-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-900 truncate">{c.name}{c.isDefault && <span className="text-[10px] font-bold text-brand-700"> · DEFAULT</span>}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
            <p className="text-[11px] text-ink-400 font-mono truncate">page {c.pageId} · {c.agentId ? `AI: ${agents.find(a => a.id === c.agentId)?.name ?? "custom"}` : "AI: global default"}</p>
          </div>
          <button onClick={() => { setForm({ id: c.id, name: c.name, pageId: c.pageId ?? "", token: "", agentId: c.agentId ?? "", kbTag: c.kbTag ?? "", active: c.active, isDefault: c.isDefault }); setMsg(null); }}
            className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}

      {form && (
        <div className="border-2 border-blue-500/30 rounded-control p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Label, e.g. Main Page" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className={inp} placeholder="Facebook Page ID" value={form.pageId} onChange={e => setForm({ ...form, pageId: e.target.value.trim() })} />
          </div>
          <input className={`${inp} w-full font-mono`} placeholder={form.id ? "Page access token — leave blank to keep the current one" : "Page access token (pages_messaging)"} value={form.token} onChange={e => setForm({ ...form, token: e.target.value.trim() })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this Page">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
            <select className={inp} value={form.kbTag} onChange={e => setForm({ ...form, kbTag: e.target.value })} title="AI on this Page answers from KB docs with this tag first, falling back to the full knowledge base. Tag docs in the AI Knowledge Base tab.">
              <option value="">Knowledge: global (all docs)</option>
              {kbTags.map(t => <option key={t} value={t}>Knowledge: {t}</option>)}
              {form.kbTag && !kbTags.includes(form.kbTag) && <option value={form.kbTag}>Knowledge: {form.kbTag}</option>}
            </select>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> default for sends</label>
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save Page"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!pages.length && !form && <p className="text-xs text-ink-400">No Facebook Pages connected yet. Subscribe your Page to the <code className="font-mono">messenger</code> webhook at <code className="font-mono">/api/webhooks/messenger</code>.</p>}

      {/* Comment-to-DM automation (ManyChat-style: multiple rules + per-post targeting) */}
      <div className="border-t border-line pt-3 mt-1 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> Comment-to-DM automation</p>
          <button onClick={() => { setMsg(null); if (pages.length > 1) { setRuleForm(null); setPickAccount(true); } else { setPickAccount(false); setRuleForm({ ...BLANK_FB_RULE, channelId: pages[0]?.id ?? null }); } }} className="shrink-0 px-3 py-1.5 rounded-control bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New rule</button>
        </div>
        <p className="text-[11px] text-ink-400">When someone comments on a post, send them ONE private DM (Meta allows a single reply per comment). Target a specific post or all posts, gate by a keyword, and attach a link button — like ManyChat.</p>

        {rules.map(r => {
          const post = posts.find(p => p.id === r.postId);
          const thumb = r.postThumbnail || post?.thumbnail;
          return (
            <div key={r.id} className="flex items-center gap-3 border border-line rounded-control px-3 py-2.5">
              {thumb
                ? <img src={thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                : <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><MessageCircle className="w-4 h-4" /></div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900 truncate">{r.name || (r.keyword ? `“${r.keyword}”` : "Any comment")}{pages.length > 1 && r.channelId && <span className="text-[10px] font-bold text-blue-600"> · {pages.find(c => c.id === r.channelId)?.name ?? "Page"}</span>}{!r.enabled && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
                <p className="text-[11px] text-ink-400 truncate">{r.postId ? `Post: ${(r.postCaption || post?.caption || r.postId).slice(0, 38) || r.postId}` : "All posts"} · {r.keyword ? `keyword “${r.keyword}”` : "any comment"}{r.buttonUrl ? " · 🔗 button" : ""} · {r.matchCount ?? 0} sent</p>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-ink-500 cursor-pointer shrink-0"><input type="checkbox" className="accent-blue-600" checked={r.enabled} onChange={() => toggleRule(r)} /> on</label>
              <button onClick={() => { setRuleForm({ ...r, name: r.name ?? "", keyword: r.keyword ?? "", buttonLabel: r.buttonLabel ?? "", buttonUrl: r.buttonUrl ?? "", publicReply: r.publicReply ?? "" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
              <button onClick={() => delRule(r.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          );
        })}
        {!rules.length && !ruleForm && !pickAccount && <p className="text-xs text-ink-400">No comment rules yet — create one to turn post comments into DMs.</p>}

        {/* Step 1: pick the Page so posts are never mixed across Pages. */}
        {pickAccount && (
          <div className="border-2 border-blue-500/30 rounded-control p-3 space-y-2">
            <p className="text-xs font-bold text-ink-700">Which Facebook Page is this rule for?</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {pages.map(c => (
                <button key={c.id} type="button" onClick={() => { setRuleForm({ ...BLANK_FB_RULE, channelId: c.id }); setPickAccount(false); }}
                  className="flex items-center gap-2 border border-line rounded-control px-3 py-2 text-left hover:border-blue-500 hover:bg-blue-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Facebook className="w-4 h-4" /></div>
                  <div className="min-w-0"><p className="text-sm font-semibold text-ink-900 truncate">{c.name}</p><p className="text-[10px] text-ink-400 font-mono truncate">{c.pageId}</p></div>
                </button>
              ))}
            </div>
            <button onClick={() => setPickAccount(false)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
        )}

        {ruleForm && (
          <div className="border-2 border-blue-500/30 rounded-control p-3 space-y-2">
            {pages.length > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded-control bg-blue-50 text-blue-600 font-bold flex items-center gap-1"><Facebook className="w-3.5 h-3.5" /> {pages.find(c => c.id === ruleForm.channelId)?.name ?? "Page"}</span>
                <button type="button" onClick={() => { setRuleForm(null); setPickAccount(true); }} className="text-ink-400 hover:text-ink-900 font-semibold">Change Page</button>
              </div>
            )}
            <input className={`${inp} w-full`} placeholder="Rule name (internal)" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} />
            <div>
              <p className="text-[11px] font-bold text-ink-500 mb-1.5">Target post {pages.length > 1 && ruleForm.channelId && <span className="text-ink-400 font-normal">· {pages.find(c => c.id === ruleForm.channelId)?.name}</span>}</p>
              <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                <button type="button" onClick={() => setRuleForm({ ...ruleForm, postId: null, postCaption: null, postPermalink: null, postThumbnail: null })}
                  className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold border transition-colors ${!ruleForm.postId ? "ring-2 ring-blue-500 border-blue-500 text-blue-600 bg-blue-50" : "border-line text-ink-500 hover:bg-canvas"}`}>
                  <Facebook className="w-4 h-4" /> All
                </button>
                {posts.map(p => {
                  const sel = ruleForm.postId === p.id;
                  return (
                    <button type="button" key={p.id} title={p.caption || "(no caption)"} onClick={() => setRuleForm({ ...ruleForm, postId: p.id, postCaption: p.caption, postPermalink: p.permalink, postThumbnail: p.thumbnail })}
                      className={`relative aspect-square rounded-lg overflow-hidden border transition-all ${sel ? "ring-2 ring-blue-500 border-blue-500" : "border-line hover:opacity-90"}`}>
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-canvas flex items-center justify-center text-ink-300"><Facebook className="w-4 h-4" /></div>}
                      {sel && <span className="absolute inset-0 bg-blue-500/15 flex items-center justify-center"><Check className="w-5 h-5 text-white drop-shadow" /></span>}
                    </button>
                  );
                })}
              </div>
              {!posts.length && <p className="text-[11px] text-amber-600 mt-1.5">No posts loaded — the Page token needs <code className="font-mono">pages_read_engagement</code>. You can still create an &ldquo;All&rdquo; rule.</p>}
            </div>
            <input className={`${inp} w-full`} placeholder="Trigger keyword (optional — blank = any comment)" value={ruleForm.keyword} onChange={e => setRuleForm({ ...ruleForm, keyword: e.target.value })} />
            <textarea className={`${inp} w-full`} rows={2} placeholder="DM message, e.g. Thanks for commenting! Here's your guide 📄" value={ruleForm.dmMessage} onChange={e => setRuleForm({ ...ruleForm, dmMessage: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} placeholder="Button label (optional, e.g. Download)" maxLength={20} value={ruleForm.buttonLabel} onChange={e => setRuleForm({ ...ruleForm, buttonLabel: e.target.value })} />
              <input className={inp} placeholder="Button link https://… (optional)" value={ruleForm.buttonUrl} onChange={e => setRuleForm({ ...ruleForm, buttonUrl: e.target.value.trim() })} />
            </div>
            <input className={`${inp} w-full`} placeholder="Public reply under the comment (optional, e.g. Sent you a DM! 📩)" value={ruleForm.publicReply} onChange={e => setRuleForm({ ...ruleForm, publicReply: e.target.value })} />

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-blue-600" checked={ruleForm.enabled} onChange={e => setRuleForm({ ...ruleForm, enabled: e.target.checked })} /> enabled</label>
              <div className="flex-1" />
              <button onClick={saveRule} disabled={ruleBusy} className="px-4 py-1.5 rounded-control bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold disabled:opacity-60">{ruleBusy ? "Saving…" : "Save rule"}</button>
              <button onClick={() => setRuleForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
            </div>
            {msg && <p className="text-xs text-red-500">{msg}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Website web-chat widget (embed a live chat bubble on any site) ────────────
type WcCfg = { color?: string; title?: string; welcome?: string; position?: "right" | "left"; iconUrl?: string; logoFit?: "cover" | "contain"; offsetSide?: number; offsetBottom?: number };
type WcRow = ChannelRow & { siteKey?: string | null; allowedOrigins?: string[]; widgetConfig?: WcCfg };
type WcForm = { id?: string; name: string; origins: string; active: boolean; agentId: string; kbTag: string; color: string; title: string; welcome: string; position: "right" | "left"; iconUrl: string; logoFit: "cover" | "contain"; offsetSide: string; offsetBottom: string };
const BLANK_WC: WcForm = { name: "", origins: "", active: true, agentId: "", kbTag: "", color: "#0783fd", title: "Chat with us", welcome: "", position: "right", iconUrl: "", logoFit: "cover", offsetSide: "", offsetBottom: "" };

export function WebchatCard() {
  const [list, setList] = useState<WcRow[]>([]);
  const [form, setForm] = useState<WcForm | null>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [kbTags, setKbTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const iconRef = useRef<HTMLInputElement | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // Upload a launcher icon image → public URL → stored in the widget config.
  async function uploadIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !form) return;
    setIconBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const up = await fetch("/api/upload", { method: "POST", body: fd }).then(r => r.json()).catch(() => ({}));
      if (up.url) setForm(f => (f ? { ...f, iconUrl: up.url } : f));
      else setMsg(up.error || "Icon upload failed");
    } finally { setIconBusy(false); }
  }

  const load = useCallback(async () => {
    const d = await fetch("/api/admin/channels").then(r => r.json()).catch(() => ({ channels: [] }));
    setList((d.channels ?? []).filter((c: WcRow) => c.kind === "webchat"));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/ai/agents").then(r => r.json()).then(d => setAgents((d.agents ?? []).map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })))).catch(() => {}); }, []);
  useEffect(() => { fetchKbTags().then(setKbTags); }, []);

  const snippet = (siteKey: string) => `<script src="${origin}/api/widget/${siteKey}/loader.js" async></script>`;
  function copy(text: string, key: string) { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(c => (c === key ? null : c)), 1500); }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setMsg("Give this widget a name."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/channels/webchat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: form.id, name: form.name, allowedOrigins: form.origins, active: form.active, agentId: form.agentId || null, kbTag: form.kbTag || null, widgetConfig: { color: form.color, title: form.title, welcome: form.welcome, position: form.position, iconUrl: form.iconUrl, logoFit: form.logoFit, ...(form.offsetSide.trim() !== "" ? { offsetSide: Number(form.offsetSide) } : {}), ...(form.offsetBottom.trim() !== "" ? { offsetBottom: Number(form.offsetBottom) } : {}) } }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed"); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this web-chat widget? The embed snippet will stop working.")) return;
    await fetch("/api/admin/channels", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-brand-600" /> Website web chat</p>
          <p className="text-xs text-slate-500 mt-0.5">Add a live-chat bubble to your website with one line of code. Visitor chats land in the same Live Chat inbox and your AI replies instantly.</p>
        </div>
        <button onClick={() => { setForm({ ...BLANK_WC }); setMsg(null); }} className="shrink-0 px-3 py-1.5 rounded-control bg-white border border-line hover:bg-canvas text-ink-700 text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New widget</button>
      </div>

      {list.map(c => (
        <div key={c.id} className="border border-line rounded-control px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0"><MessageSquare className="w-4 h-4" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900 truncate">{c.name}{!c.active && <span className="text-[10px] font-bold text-red-500"> · OFF</span>}</p>
              <p className="text-[11px] text-ink-400 truncate">{(c.allowedOrigins && c.allowedOrigins.length) ? c.allowedOrigins.join(", ") : "any origin (lock this down by adding your domains)"}</p>
            </div>
            <button onClick={() => { const w = c.widgetConfig ?? {}; setForm({ id: c.id, name: c.name, origins: (c.allowedOrigins ?? []).join("\n"), active: c.active, agentId: c.agentId ?? "", kbTag: c.kbTag ?? "", color: w.color || "#0783fd", title: w.title || "Chat with us", welcome: w.welcome || "", position: w.position === "left" ? "left" : "right", iconUrl: w.iconUrl || "", logoFit: w.logoFit === "contain" ? "contain" : "cover", offsetSide: w.offsetSide != null ? String(w.offsetSide) : "", offsetBottom: w.offsetBottom != null ? String(w.offsetBottom) : "" }); setMsg(null); }} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
            <button onClick={() => remove(c.id)} className="p-1.5 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
          {c.siteKey && (
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-canvas border border-line rounded-control px-2.5 py-1.5 text-[11px] font-mono text-ink-700">{snippet(c.siteKey)}</code>
              <button onClick={() => copy(snippet(c.siteKey!), c.id)} className="shrink-0 px-2.5 py-1.5 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas flex items-center gap-1">
                {copied === c.id ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
              </button>
            </div>
          )}
        </div>
      ))}

      {form && (
        <div className="border-2 border-brand-700/30 rounded-control p-3 space-y-2">
          <input className={`${inp} w-full`} placeholder="Widget name, e.g. Marketing site" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Allowed website origins (one per line — blank = allow anywhere)</p>
            <textarea className={`${inp} w-full resize-none font-mono text-xs`} rows={3} placeholder={"https://www.yoursite.com\nhttps://shop.yoursite.com"} value={form.origins} onChange={e => setForm({ ...form, origins: e.target.value })} />
          </div>

          {/* ── AI ── */}
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={form.agentId} onChange={e => setForm({ ...form, agentId: e.target.value })} title="Default AI persona for this widget">
              <option value="">AI persona: global default</option>
              {agents.map(a => <option key={a.id} value={a.id}>AI persona: {a.name}</option>)}
            </select>
            <select className={inp} value={form.kbTag} onChange={e => setForm({ ...form, kbTag: e.target.value })} title="AI on this widget answers from KB docs with this tag first, falling back to the full knowledge base. Tag docs in the AI Knowledge Base tab.">
              <option value="">Knowledge: global (all docs)</option>
              {kbTags.map(t => <option key={t} value={t}>Knowledge: {t}</option>)}
              {form.kbTag && !kbTags.includes(form.kbTag) && <option value={form.kbTag}>Knowledge: {form.kbTag}</option>}
            </select>
          </div>

          {/* ── Appearance ── */}
          <p className="text-[11px] font-bold text-slate-400 uppercase pt-1">Appearance</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-600 border border-line rounded-control px-2.5 py-1.5">
              <span className="shrink-0">Brand colour</span>
              <input type="color" className="w-7 h-7 rounded cursor-pointer bg-transparent border-0 p-0" value={/^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : "#0783fd"} onChange={e => setForm({ ...form, color: e.target.value })} />
              <input className={`${inp} flex-1 font-mono text-xs`} maxLength={7} value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
            </label>
            <select className={inp} value={form.position} onChange={e => setForm({ ...form, position: e.target.value as "right" | "left" })}>
              <option value="right">Bottom-right</option>
              <option value="left">Bottom-left</option>
            </select>
          </div>
          {/* Bubble offsets — lift/shift the launcher clear of the site's own floating
              buttons (scroll-to-top, call widget). Blank = defaults (20px / 20px). */}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-600 border border-line rounded-control px-2.5 py-1.5">
              <span className="shrink-0">Gap from bottom</span>
              <input type="number" min={0} max={600} className={`${inp} flex-1 text-xs !py-1`} placeholder="20" value={form.offsetBottom} onChange={e => setForm({ ...form, offsetBottom: e.target.value })} />
              <span className="text-ink-400">px</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-600 border border-line rounded-control px-2.5 py-1.5">
              <span className="shrink-0">Gap from side</span>
              <input type="number" min={0} max={600} className={`${inp} flex-1 text-xs !py-1`} placeholder="20" value={form.offsetSide} onChange={e => setForm({ ...form, offsetSide: e.target.value })} />
              <span className="text-ink-400">px</span>
            </label>
          </div>
          <p className="text-[11px] text-ink-400 -mt-1">If the bubble covers your site&apos;s scroll-to-top or call button, raise &quot;Gap from bottom&quot; (e.g. 100).</p>
          <input className={`${inp} w-full`} maxLength={40} placeholder="Header title, e.g. Acme Support" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <textarea className={`${inp} w-full resize-none`} rows={2} maxLength={300} placeholder="Welcome greeting shown when the chat opens (optional)" value={form.welcome} onChange={e => setForm({ ...form, welcome: e.target.value })} />
          {/* Chat-icon upload — upload your logo (e.g. WhatsApp) or leave blank for the default bubble */}
          <div className="flex items-center gap-2.5 border border-line rounded-control px-2.5 py-2">
            <span className="text-xs text-ink-600 shrink-0">Chat icon</span>
            <input ref={iconRef} type="file" accept="image/*" hidden onChange={uploadIcon} />
            <button onClick={() => iconRef.current?.click()} disabled={iconBusy} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas disabled:opacity-60 flex items-center gap-1.5">
              {iconBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />} Upload logo
            </button>
            {form.iconUrl && <button onClick={() => setForm({ ...form, iconUrl: "" })} className="text-[11px] font-semibold text-ink-400 hover:text-red-600">Remove</button>}
            <span className="text-[11px] text-ink-400 truncate">{form.iconUrl ? "custom logo set" : "default chat bubble"}</span>
          </div>
          {form.iconUrl && (
            <label className="flex items-center gap-2 text-xs text-ink-600 cursor-pointer select-none" title="Crop fills a circle (may clip a non-square logo). Fit shows the whole logo, any shape.">
              <input type="checkbox" checked={form.logoFit === "contain"} onChange={e => setForm({ ...form, logoFit: e.target.checked ? "contain" : "cover" })} />
              Fit whole logo (don&apos;t crop) — for any logo shape
            </label>
          )}
          {/* Live preview of the launcher bubble + header */}
          <div className="flex items-center gap-3 bg-canvas border border-line rounded-control px-3 py-2.5">
            <span className={`shrink-0 w-9 h-9 ${form.iconUrl && form.logoFit === "contain" ? "rounded-lg" : "rounded-full"} flex items-center justify-center text-white overflow-hidden`} style={{ background: form.iconUrl && form.logoFit === "contain" ? "transparent" : (/^#[0-9a-fA-F]{3,6}$/.test(form.color) ? form.color : "#0783fd") }}>
              {form.iconUrl ? <img src={form.iconUrl} alt="" className={`w-full h-full ${form.logoFit === "contain" ? "object-contain" : "object-cover"}`} /> : <MessageSquare className="w-4 h-4" />}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold text-ink-900 truncate">{form.title || "Chat with us"}</p>
              <p className="text-[11px] text-ink-400 truncate">{form.welcome || "No welcome message"} · {form.position === "left" ? "bottom-left" : "bottom-right"}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> active</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save widget"}</button>
            <button onClick={() => setForm(null)} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
      {!list.length && !form && <p className="text-xs text-ink-400">No web-chat widget yet. Create one to get a copy-paste embed snippet.</p>}
    </section>
  );
}

function SettingsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [welcome, setWelcome] = useState<WelcomeS | null>(null);
  const [away, setAway] = useState<AwayS | null>(null);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [nudgeOn, setNudgeOn] = useState<boolean | null>(null);
  const [nudgeVars, setNudgeVars] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(true);
  useEffect(() => { fetch("/api/admin/me").then(r => r.json()).then(d => setIsAdmin(d.user?.role !== "member")).catch(() => {}); }, []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [quickReplies, setQuickReplies] = useState<{ id: string; shortcut: string; body: string }[]>([]);
  const [qrShortcut, setQrShortcut] = useState("");
  const [qrBody, setQrBody] = useState("");

  const loadQr = useCallback(() => { fetch("/api/admin/quick-replies").then(r => r.json()).then(d => setQuickReplies(d.quickReplies ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    fetch("/api/admin/settings").then(r => r.json()).then(d => {
      setWelcome(d.welcome); setAway(d.away); setAiOn(d.ai?.enabled !== false);
      setNudgeOn(d.flowNudge?.enabled !== false); setNudgeVars((d.flowNudge?.variations ?? []) as string[]);
    }).catch(() => {});
    loadQr();
  }, [loadQr]);

  async function save() {
    if (!welcome || !away) return;
    setSaving(true);
    try {
      await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ welcome, away }) });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  // The ON/OFF pills persist instantly (like every other toggle in the app) so a
  // toggle survives a refresh without needing the separate "Save messages" click.
  // We send the full local object so any in-progress text edit is saved too.
  async function persistSettings(patch: { welcome?: WelcomeS; away?: AwayS }) {
    setSaving(true);
    try {
      await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }
  function toggleWelcome() { if (!welcome) return; const next = { ...welcome, enabled: !welcome.enabled }; setWelcome(next); void persistSettings({ welcome: next }); }
  function toggleAway() { if (!away) return; const next = { ...away, enabled: !away.enabled }; setAway(next); void persistSettings({ away: next }); }
  // Tenant-wide AI switch — persists instantly; only a human ever flips this.
  async function toggleAi() {
    if (aiOn === null) return;
    const next = !aiOn; setAiOn(next); setSaving(true);
    try {
      await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ai: { enabled: next } }) });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  // Off-script nudge — persists like the other toggles; the variation boxes have
  // their own Save so mid-edit text isn't half-written by a toggle click. One
  // BOX is one variation (multi-line messages are fine within a box).
  const nudgeList = () => nudgeVars.map(s => s.trim()).filter(Boolean).slice(0, 6);
  async function persistNudge(enabled: boolean) {
    setSaving(true);
    try {
      const d = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flowNudge: { enabled, variations: nudgeList() } }) }).then(r => r.json());
      if (d.flowNudge) { setNudgeOn(d.flowNudge.enabled !== false); setNudgeVars((d.flowNudge.variations ?? []) as string[]); }
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }
  function toggleNudge() { if (nudgeOn === null) return; const next = !nudgeOn; setNudgeOn(next); void persistNudge(next); }

  async function addQr() {
    if (!qrShortcut.trim() || !qrBody.trim()) return;
    await fetch("/api/admin/quick-replies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shortcut: qrShortcut, body: qrBody }) });
    setQrShortcut(""); setQrBody(""); loadQr();
  }

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-2xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Settings</h2>
        <p className="text-sm text-slate-500">WhatsApp numbers, automatic messages, and canned responses.</p>
      </div>

      <UsageCard />
      {isAdmin && <ChannelsManager />}
      {isAdmin && <TeamManager />}
      {isAdmin && <ActivityLog />}

      {/* AI auto-replies — the ONE master switch for the AI on every channel */}
      <section className="bg-white rounded-card border border-line p-5 space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">AI auto-replies</p>
            <p className="text-xs text-slate-500 mt-0.5">
              One switch for the AI assistant everywhere — WhatsApp, Instagram, Facebook Messenger, website chat, and AI follow-ups.
              Chatbot flows, welcome/away messages and human agents keep working when it&apos;s off.
            </p>
          </div>
          {aiOn === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : (
            <button onClick={toggleAi} disabled={saving}
              className={`px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-60 ${aiOn ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {aiOn ? "ON" : "OFF"}
            </button>
          )}
        </div>
        {aiOn === false && <p className="text-[11px] text-amber-600">The AI is silent on all channels — your team replies from Live Chat. Per-conversation “Turn bot off” still works independently.</p>}
      </section>

      {/* Off-script nudge — what flows say when a typed reply matches no menu option */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Off-script nudge</p>
            <p className="text-xs text-slate-500 mt-0.5">
              When a chatbot flow is showing buttons, a menu, or a WhatsApp form and the person types something else, the
              bot replies with one of these lines to guide them back — a different variation each time, up to 3 per step —
              instead of staying silent. When AI auto-replies are ON, real questions go to the AI instead; with the AI off,
              every off-script message gets a nudge.
            </p>
          </div>
          {nudgeOn === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-300" /> : (
            <button onClick={toggleNudge} disabled={saving}
              className={`px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-60 shrink-0 ${nudgeOn ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {nudgeOn ? "ON" : "OFF"}
            </button>
          )}
        </div>
        <div className="space-y-2">
          {nudgeVars.map((v, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-[11px] font-bold text-slate-400 pt-2 shrink-0 w-4 text-right">{i + 1}.</span>
              <textarea className={`${inp} flex-1 resize-none text-xs`} rows={2} maxLength={300} placeholder="e.g.  Please tap one of the options above 👆" value={v}
                onChange={e => setNudgeVars(a => a.map((x, j) => (j === i ? e.target.value : x)))} />
              <button onClick={() => setNudgeVars(a => a.filter((_, j) => j !== i))} className="p-1.5 text-ink-300 hover:text-red-500 shrink-0" aria-label="Remove variation">×</button>
            </div>
          ))}
          {nudgeVars.length < 6 && (
            <button onClick={() => setNudgeVars(a => [...a, ""])} className="px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas">+ Add variation</button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-ink-400">Each box is ONE variation (up to 6, 300 chars, multi-line fine) — the bot rotates through them in order. Remove all to use the built-in defaults.</p>
          <button onClick={() => void persistNudge(nudgeOn !== false)} disabled={saving} className="px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60 shrink-0">{saving ? "Saving…" : "Save nudges"}</button>
        </div>
      </section>

      {/* Welcome message */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Welcome message</p>
            <p className="text-xs text-slate-500 mt-0.5">Sent once, the first time a contact ever messages you (before the AI answers).</p>
          </div>
          {welcome && (
            <button onClick={toggleWelcome} disabled={saving}
              className={`px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-60 ${welcome.enabled ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {welcome.enabled ? "ON" : "OFF"}
            </button>
          )}
        </div>
        {welcome ? (
          <textarea className={`${inp} w-full resize-none`} rows={3} value={welcome.text} onChange={e => setWelcome({ ...welcome, text: e.target.value })} />
        ) : <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
      </section>

      {/* Away message */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase">Away message (outside working hours)</p>
            <p className="text-xs text-slate-500 mt-0.5">Sent at most once per 12h per conversation. The AI keeps answering either way.</p>
          </div>
          {away && (
            <button onClick={toggleAway} disabled={saving}
              className={`px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-60 ${away.enabled ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {away.enabled ? "ON" : "OFF"}
            </button>
          )}
        </div>
        {away ? (
          <>
            <textarea className={`${inp} w-full resize-none`} rows={3} value={away.text} onChange={e => setAway({ ...away, text: e.target.value })} />
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Working hours:</span>
              <input type="number" min={0} max={23} className={`${inp} w-20`} value={away.startHour} onChange={e => setAway({ ...away, startHour: parseInt(e.target.value) || 0 })} />
              <span>to</span>
              <input type="number" min={0} max={24} className={`${inp} w-20`} value={away.endHour} onChange={e => setAway({ ...away, endHour: parseInt(e.target.value) || 0 })} />
              <span className="text-xs text-slate-400">(IST, 24h format)</span>
            </div>
          </>
        ) : <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
      </section>

      <button onClick={save} disabled={saving || !welcome || !away} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin inline" /> : savedAt && Date.now() - savedAt < 3000 ? "Saved ✓" : "Save messages"}
      </button>

      {/* Quick replies */}
      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Quick replies (canned responses)</p>
          <p className="text-xs text-slate-500 mt-0.5">Available in the Team Inbox composer (⚡ or type /) and the CRM chat panel.</p>
        </div>
        <div className="flex gap-2">
          <input className={`${inp} w-32`} placeholder="shortcut" value={qrShortcut} onChange={e => setQrShortcut(e.target.value)} />
          <input className={`${inp} flex-1`} placeholder="Reply text…" value={qrBody} onChange={e => setQrBody(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addQr(); }} />
          <button onClick={addQr} disabled={!qrShortcut.trim() || !qrBody.trim()} className="px-3 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="divide-y divide-slate-100">
          {quickReplies.map(q => (
            <div key={q.id} className="flex items-center justify-between py-2 gap-3">
              <div className="min-w-0">
                <span className="text-xs font-bold text-brand-dark">/{q.shortcut}</span>
                <p className="text-xs text-slate-500 truncate">{q.body}</p>
              </div>
              <button onClick={() => fetch("/api/admin/quick-replies", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: q.id }) }).then(loadQr)} className="p-1.5 text-red-400 hover:text-red-600 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          {quickReplies.length === 0 && <p className="text-center text-slate-400 text-sm py-4">No quick replies yet — add shortcuts like "fees", "location", "demo".</p>}
        </div>
      </section>

      {isAdmin && (
        <section className="bg-white rounded-card border border-line p-5 space-y-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Data &amp; privacy (GDPR)</p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/admin/gdpr/export" className="px-3 py-1.5 rounded-control border border-line text-xs font-bold text-ink-800 hover:bg-canvas">Export all data (JSON)</a>
            <button onClick={async () => {
              const phone = prompt("Erase a contact — enter their phone number.\nThis permanently deletes the contact and ALL their data.");
              if (!phone?.trim()) return;
              if (!confirm(`Permanently erase all data for ${phone}? This cannot be undone.`)) return;
              const r = await fetch("/api/admin/gdpr/erase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) }).then(x => x.json()).catch(() => ({ error: "request failed" }));
              alert(r.error ? `Error: ${r.error}` : `Erased data for ${r.phone}.`);
            }} className="px-3 py-1.5 rounded-control border border-red-200 text-xs font-bold text-red-600 hover:bg-red-50">Erase a contact…</button>
          </div>
          <p className="text-[11px] text-ink-400">Export downloads everything stored for your workspace. Erase fulfils a right‑to‑be‑forgotten request for one contact (removes the contact, conversations, messages, opt‑outs, queue/log, orders and more).</p>
        </section>
      )}

      {isAdmin && <VoiceSettingsCard />}
      {isAdmin && <ApiKeysCard />}
    </div>
    <SettingsRail goTo={goTo} />
    </div>
  );
}

export default SettingsTab;
