"use client";

// Meta Ads tab — extracted verbatim from the former monolithic admin/page.tsx.
// Lazy-loaded by the dashboard shell so this ~1.8k-line feature ships as its own
// chunk instead of bloating the initial admin bundle. Logic is unchanged.

import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import dynamic from "next/dynamic";
import { Loader2, Send, Plus, Trash2, Copy, Globe, Search, RefreshCw, ArrowLeft, ChevronRight, MapPin, Megaphone, FileText, CircleCheck, Heart, MessageCircle, Bookmark, MoreHorizontal, ThumbsUp, Reply, UploadCloud, Image as ImageIcon, Video, GalleryHorizontalEnd } from "lucide-react";
import { type Tab, inp, btnPrimary, railLoading, RailCard, StatRow } from "../_shared";

type AdsData = {
  connected: boolean;
  accountId: string;
  pageId: string;
  account: { name: string; currency: string; status: number } | null;
  error: string | null;
  campaigns: { id: string; name: string; effectiveStatus: string; delivery?: Delivery; objective: string; dailyBudget: number | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }[];
  attribution: { adId: string; headline: string; contacts: number; leads: number }[];
  portalCampaignIds?: string[];
};
type Delivery = { label: string; phase: "active" | "learning" | "limited" | "off" | "review" | "error" | "other" };
type AdDraftSummary = { id: string; name: string; updatedAt: string };
type AdsDrill = {
  adsets: { id: string; name: string; effectiveStatus: string; delivery?: Delivery; dailyBudget: number | null; optimizationGoal: string; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }[];
  ads: { id: string; name: string; effectiveStatus: string; delivery?: Delivery; thumbnailUrl: string | null; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; conversations: number }[];
};

// Meta's "Delivery" column → pill colours. Learning = amber (still optimising),
// Active = green/brand, Learning limited = orange (stuck), Off = grey, issues = red.
function deliveryPill(d?: Delivery): { cls: string; label: string } {
  const phase = d?.phase ?? "other";
  const cls =
    phase === "active" ? "bg-brand-100 text-brand-700"
    : phase === "learning" ? "bg-amber-100 text-amber-700"
    : phase === "limited" ? "bg-orange-100 text-orange-700"
    : phase === "review" ? "bg-sky-100 text-sky-700"
    : phase === "error" ? "bg-rose-100 text-rose-700"
    : "bg-slate-100 text-slate-500";
  return { cls, label: d?.label ?? "—" };
}

function AdsTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [data, setData] = useState<AdsData | null>(null);
  const [preset, setPreset] = useState<"today" | "last_7d" | "last_30d">("last_7d");
  const [accountInput, setAccountInput] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; value: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(true);
  const [building, setBuilding] = useState(false);
  const [resumeDraft, setResumeDraft] = useState<{ id: string; data: Record<string, unknown> } | null>(null);
  const [drafts, setDrafts] = useState<AdDraftSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [detail, setDetail] = useState<{ level: "campaign" | "adset" | "ad"; id: string; name: string } | null>(null);
  const [pageInput, setPageInput] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { fetch("/api/admin/me").then(r => r.json()).then(d => setIsAdmin(d.user?.role !== "member")).catch(() => {}); }, []);

  const loadDrafts = useCallback(() => { fetch("/api/admin/meta/drafts").then(r => r.json()).then(d => setDrafts(d.drafts ?? [])).catch(() => {}); }, []);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  async function openDraft(id: string) {
    const d = await fetch(`/api/admin/meta/drafts?id=${id}`).then(r => r.json()).catch(() => null);
    if (d?.draft) { setResumeDraft({ id: d.draft.id, data: d.draft.data ?? {} }); setBuilding(true); }
  }
  async function deleteDraft(id: string) {
    await fetch(`/api/admin/meta/drafts?id=${id}`, { method: "DELETE" }).catch(() => {});
    loadDrafts();
  }
  function newAd() { setResumeDraft(null); setBuilding(true); }

  const load = useCallback(() => {
    fetch(`/api/admin/meta?preset=${preset}`).then(r => r.json()).then(d => { setData(d); setBlocked(false); }).catch(() => setBlocked(true));
  }, [preset]);
  useEffect(() => { load(); }, [load]);

  async function connect() {
    if (!accountInput.trim()) return;
    setBusy("connect"); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: accountInput.trim() }) }).then(r => r.json());
      if (d.error && !d.success) setMsg(d.error);
      else if (!d.connected) setMsg(`Account saved — but Meta says: "${d.error}". Finish steps 2 and 3 below, then hit Retry.`);
      setAccountInput("");
      load();
    } catch { setBlocked(true); }
    finally { setBusy(""); }
  }

  async function act(campaignId: string, action: "pause" | "resume" | "budget" | "duplicate", dailyBudget?: number) {
    setBusy(campaignId); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, action, dailyBudget }) }).then(r => r.json());
      if (d.error) setMsg(d.error); else load();
    } finally { setBusy(""); setBudgetEdit(null); }
  }

  const cur = data?.account?.currency ?? "";
  const money = (n: number) => `${cur === "INR" ? "₹" : cur ? cur + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const timeAgo = (iso: string) => {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };
  const totals = (data?.campaigns ?? []).reduce(
    (t, c) => ({ spend: t.spend + c.spend, impressions: t.impressions + c.impressions, clicks: t.clicks + c.clicks, conversations: t.conversations + c.conversations }),
    { spend: 0, impressions: 0, clicks: 0, conversations: 0 },
  );
  const leadsTotal = (data?.attribution ?? []).reduce((n, a) => n + a.leads, 0);

  const campaignCard = (c: AdsData["campaigns"][number]) => (
    <div key={c.id} className="bg-white rounded-card border border-line p-4 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink-900 truncate">{c.name}</p>
          <p className="text-[11px] text-slate-400">{c.objective.toLowerCase().replace(/_/g, " ")}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${deliveryPill(c.delivery).cls}`}>{deliveryPill(c.delivery).label}</span>
          {isAdmin && (c.effectiveStatus === "ACTIVE"
            ? <button disabled={busy === c.id} onClick={() => act(c.id, "pause")} className="px-3 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas disabled:opacity-50">Pause</button>
            : c.effectiveStatus === "PAUSED" && <button disabled={busy === c.id} onClick={() => act(c.id, "resume")} className="px-3 py-1 rounded-lg bg-brand-700 text-white text-[11px] font-bold disabled:opacity-50">Resume</button>)}
          {isAdmin && <button disabled={busy === c.id} title="Duplicate (copy created paused)" onClick={() => { if (confirm(`Duplicate "${c.name}"? The copy is created PAUSED.`)) act(c.id, "duplicate"); }} className="px-2 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas disabled:opacity-50"><Copy className="w-3 h-3" /></button>}
          <button onClick={() => setDetail({ level: "campaign", id: c.id, name: c.name })} className="px-3 py-1 rounded-lg bg-ink-950 text-white text-[11px] font-bold">Open</button>
        </div>
      </div>
      <button onClick={() => setDetail({ level: "campaign", id: c.id, name: c.name })} className="w-full grid grid-cols-4 gap-2 text-center">
        {[
          ["Spend", money(c.spend)], ["CPC", c.cpc ? money(c.cpc) : "—"],
          ["CTR", c.ctr ? `${Number(c.ctr).toFixed(2)}%` : "—"], ["Chats", c.conversations.toLocaleString()],
        ].map(([l, v]) => (
          <div key={l} className="bg-canvas rounded-control py-1.5 hover:bg-brand-50">
            <p className="text-sm font-bold text-ink-900">{v}</p>
            <p className="text-[10px] text-slate-400 font-semibold">{l}</p>
          </div>
        ))}
      </button>
      {isAdmin && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          Daily budget:
          {budgetEdit?.id === c.id ? (
            <>
              <input className="border border-line rounded-control px-2 py-1 w-24 text-xs" autoFocus value={budgetEdit.value} onChange={e => setBudgetEdit({ id: c.id, value: e.target.value })}
                onKeyDown={e => { if (e.key === "Enter" && Number(budgetEdit.value) > 0) act(c.id, "budget", Number(budgetEdit.value)); if (e.key === "Escape") setBudgetEdit(null); }} />
              <button disabled={busy === c.id || !(Number(budgetEdit.value) > 0)} onClick={() => act(c.id, "budget", Number(budgetEdit.value))} className="font-bold text-brand-700 disabled:opacity-50">Save</button>
              <button onClick={() => setBudgetEdit(null)} className="text-slate-400 font-bold">cancel</button>
            </>
          ) : (
            <>
              <b className="text-ink-900">{c.dailyBudget != null ? `${money(c.dailyBudget)}/day` : "set at ad-set level"}</b>
              {c.dailyBudget != null && <button onClick={() => setBudgetEdit({ id: c.id, value: String(c.dailyBudget) })} className="font-bold text-brand-700 hover:underline">change</button>}
            </>
          )}
        </div>
      )}
    </div>
  );

  // ── Request blocked client-side (almost always an ad blocker) ──
  if (blocked) {
    return (
      <div className="max-w-2xl space-y-4">
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> Meta Ads</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-card px-5 py-4 text-sm text-amber-900 space-y-2">
          <p className="font-bold">An ad blocker is blocking this page.</p>
          <p>Your browser extension (uBlock Origin, AdBlock, Brave Shields, Privacy Badger, etc.) is blocking the request because the address contains advertising-related words. This is a browser issue, not a problem with the platform — every other tab works.</p>
          <p className="font-semibold">To fix it, do one of these:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Click your ad-blocker icon → <b>pause / disable on waba.analytixlabs.co.in</b>, then reload.</li>
            <li>Or open this page in an <b>Incognito window</b> with extensions off.</li>
          </ul>
          <button onClick={() => { setBlocked(false); load(); }} className="mt-1 px-4 py-2 rounded-control bg-amber-600 text-white text-xs font-bold">I&apos;ve disabled it — retry</button>
        </div>
      </div>
    );
  }

  // ── Not connected: friendly 3-step wizard ──
  if (data && (!data.accountId || !data.connected)) {
    return (
      <div className="max-w-2xl space-y-5">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> Meta Ads</h2>
          <p className="text-sm text-slate-500">Run and monitor your Facebook &amp; Instagram ads right here — and see exactly which ad brings WhatsApp leads, not just clicks.</p>
        </div>

        {data.accountId && !data.connected && (
          <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">
            Account <b>act_{data.accountId}</b> is saved, but Meta replied: <i>{data.error ?? "unknown error"}</i>.
            {" "}Usually this means step 2 or 3 below isn&apos;t done yet — or Meta is having an outage.
            <button onClick={load} className="ml-2 font-bold underline">Retry</button>
          </div>
        )}
        {msg && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">{msg}</div>}

        <section className="bg-white rounded-card border border-line p-5 space-y-4">
          <p className="text-xs font-bold text-slate-400 uppercase">Connect your ad account — 3 steps, one time</p>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-brand-700 text-white text-xs font-bold flex items-center justify-center shrink-0">1</div>
            <div className="flex-1 space-y-2">
              <p className="text-sm font-semibold text-ink-900">Paste your ad account ID</p>
              <p className="text-xs text-slate-500">Open <b>adsmanager.facebook.com</b> — the ID is the number after <code className="bg-canvas px-1 rounded">act=</code> in the address bar.</p>
              <div className="flex gap-2">
                <input className={`${inp} flex-1`} placeholder="e.g. 1234567890" value={accountInput} onChange={e => setAccountInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") connect(); }} />
                <button onClick={connect} disabled={busy === "connect" || !accountInput.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold disabled:opacity-50">
                  {busy === "connect" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect"}
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-canvas text-ink-600 text-xs font-bold flex items-center justify-center shrink-0">2</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">Give the system user access to the ad account</p>
              <p className="text-xs text-slate-500">Business settings → Users → System users → <b>whatsapp-api</b> → Assign assets → <b>Ad accounts</b> → pick your account → Full control.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-canvas text-ink-600 text-xs font-bold flex items-center justify-center shrink-0">3</div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">Add ads permissions to the token</p>
              <p className="text-xs text-slate-500">Generate a new token for <b>whatsapp-api</b> with <code className="bg-canvas px-1 rounded">ads_read</code> + <code className="bg-canvas px-1 rounded">ads_management</code> added to the existing WhatsApp scopes, then update <code className="bg-canvas px-1 rounded">META_WA_ACCESS_TOKEN</code> in Vercel and redeploy.</p>
            </div>
          </div>
        </section>

        <p className="text-xs text-slate-400">Reading insights can&apos;t break anything — your WhatsApp setup keeps working exactly as is. Campaign controls (pause/budget) are admin-only.</p>
      </div>
    );
  }

  // ── Full-page ad builder (replaces the dashboard while creating) ──
  if (building) {
    return <CreateAdBuilder currency={cur} hasPage={!!data?.pageId} campaigns={(data?.campaigns ?? []).map(c => ({ id: c.id, name: c.name, objective: c.objective, dailyBudget: c.dailyBudget }))}
      draftId={resumeDraft?.id ?? null} draftData={resumeDraft?.data ?? null}
      onClose={() => { setBuilding(false); loadDrafts(); }}
      onCreated={() => { setBuilding(false); setData(null); load(); loadDrafts(); }} />;
  }

  // ── Connected dashboard ──
  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> Meta Ads</h2>
          {data?.account && <p className="text-sm text-slate-500">{data.account.name} · {data.account.currency} · {data.account.status === 1 ? <span className="text-brand-700 font-semibold">● active</span> : <span className="text-amber-600 font-semibold">status {data.account.status}</span>}</p>}
        </div>
        <div className="flex gap-2 items-center">
          {([["today", "Today"], ["last_7d", "7 days"], ["last_30d", "30 days"]] as ["today" | "last_7d" | "last_30d", string][]).map(([k, label]) => (
            <button key={k} onClick={() => { setPreset(k); setData(null); }} className={`px-3 py-1.5 rounded-full text-xs font-bold ${preset === k ? "bg-ink-950 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
          ))}
          <button onClick={() => { setData(null); load(); }} className="p-2 rounded-control border border-line text-ink-600 hover:bg-canvas"><RefreshCw className="w-3.5 h-3.5" /></button>
          {isAdmin && <button onClick={newAd} className={btnPrimary}><Plus className="w-4 h-4" /> Create ad</button>}
        </div>
      </div>

      {msg && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{msg}</div>}
      {data && !data.pageId && isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800 flex items-center gap-2 flex-wrap">
          <span>To <b>create ads from here</b>, save the Facebook Page your WhatsApp number is connected to:</span>
          <input className="border border-amber-300 rounded-control px-2 py-1 text-xs w-40 bg-white" placeholder="Page ID (numeric)" value={pageInput} onChange={e => setPageInput(e.target.value)} />
          <button onClick={async () => { const d = await fetch("/api/admin/meta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId: pageInput.trim() }) }).then(r => r.json()); if (d.error) setMsg(d.error); else { setPageInput(""); load(); } }} className="px-3 py-1 rounded-control bg-amber-600 text-white text-xs font-bold">Save</button>
        </div>
      )}
      {data?.error && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">Meta error while loading campaigns: {data.error}</div>}

      {detail ? (
        <AdNodeDetail node={detail} preset={preset} currency={cur} isAdmin={isAdmin}
          onBack={() => setDetail(null)}
          onOpen={(level, id, name) => setDetail({ level, id, name })} />
      ) : !data ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : <>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Spend", value: money(totals.spend) },
          { label: "Impressions", value: totals.impressions.toLocaleString() },
          { label: "Clicks", value: totals.clicks.toLocaleString() },
          { label: "WhatsApp chats started", value: totals.conversations.toLocaleString() },
        ].map(c => (
          <div key={c.label} className="bg-white border border-line rounded-card p-4">
            <p className="text-xl font-extrabold text-ink-900 truncate">{c.value}</p>
            <p className="text-[11px] text-slate-500 font-medium">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Drafts — auto-saved, never live until you launch them */}
      {drafts.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-bold text-slate-400 uppercase">Drafts — saved, not running</p>
          <div className="bg-white rounded-card border border-line divide-y divide-line">
            {drafts.map(dr => (
              <div key={dr.id} className="flex items-center gap-3 px-4 py-2.5">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{dr.name}</p>
                  <p className="text-[11px] text-slate-400">Last edited {timeAgo(dr.updatedAt)}</p>
                </div>
                <button onClick={() => openDraft(dr.id)} className="px-3 py-1 rounded-lg bg-brand-700 text-white text-[11px] font-bold">Continue</button>
                <button onClick={() => { if (confirm(`Delete draft "${dr.name}"?`)) deleteDraft(dr.id); }} className="px-2 py-1 rounded-lg border border-line text-[11px] font-bold text-slate-500 hover:text-red-600 hover:border-red-200"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(() => {
        const portalIds = new Set(data.portalCampaignIds ?? []);
        const byStatus = (c: AdsData["campaigns"][number]) =>
          statusFilter === "all" ? true : statusFilter === "active" ? c.effectiveStatus === "ACTIVE" : c.effectiveStatus !== "ACTIVE";
        const visible = data.campaigns.filter(byStatus);
        const portalCamps = visible.filter(c => portalIds.has(c.id));
        const metaCamps = visible.filter(c => !portalIds.has(c.id));
        const activeCount = data.campaigns.filter(c => c.effectiveStatus === "ACTIVE").length;
        const pausedCount = data.campaigns.length - activeCount;
        return (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-bold text-slate-400 uppercase">Campaigns — click any card for full analytics</p>
              <div className="flex gap-1">
                {([["all", `All ${data.campaigns.length}`], ["active", `Active ${activeCount}`], ["paused", `Paused ${pausedCount}`]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setStatusFilter(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${statusFilter === k ? "bg-ink-950 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`}>{label}</button>
                ))}
              </div>
            </div>

            {data.campaigns.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-8 bg-white rounded-card border border-line">No campaigns yet — hit <b>Create ad</b> to build one here, or create one in Ads Manager and it appears with live numbers.</p>
            ) : visible.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-6 bg-white rounded-card border border-line">No {statusFilter} campaigns.</p>
            ) : (
              <div className="space-y-4">
                {portalCamps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-brand-700 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Created in this portal · {portalCamps.length}</p>
                    {portalCamps.map(campaignCard)}
                  </div>
                )}
                {metaCamps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> From Meta Ads Manager · {metaCamps.length}</p>
                    {metaCamps.map(campaignCard)}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })()}

      <section className="bg-white rounded-card border border-line p-5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Leads from your ads — our data, not Meta&apos;s</p>
          {leadsTotal > 0 && <button onClick={() => goTo("contacts")} className="text-[11px] font-bold text-brand-700 hover:underline">View in Contacts →</button>}
        </div>
        {data.attribution.length === 0 ? (
          <p className="text-xs text-slate-400 py-3">
            When someone taps a <b>Click-to-WhatsApp ad</b> and messages you, they&apos;re automatically stamped with the ad they came from — and show up here with how many became real leads. Nothing to configure.
          </p>
        ) : (
          <div className="divide-y divide-line">
            <div className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase"><span>Ad</span><span className="text-right">Chats</span><span className="text-right">Leads</span><span className="text-right">Lead rate</span></div>
            {data.attribution.map(a => (
              <div key={a.adId} className="grid grid-cols-[1fr_5rem_5rem_5rem] gap-2 py-2 text-sm items-center">
                <span className="font-semibold text-ink-900 truncate">{a.headline}</span>
                <span className="text-right">{a.contacts}</span>
                <span className="text-right font-bold text-brand-700">{a.leads}</span>
                <span className="text-right text-slate-500">{a.contacts ? Math.round((a.leads / a.contacts) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <AdRulesPanel campaigns={data.campaigns.map(x => ({ id: x.id, name: x.name }))} isAdmin={isAdmin} currency={cur} />
      </>}

    </div>
    <AdsRail leads={leadsTotal} chats={totals.conversations} spend={totals.spend ? money(totals.spend) : null} />
    </div>
  );
}

// Meta Ads rail: cost-per-lead headline + how attribution works + tips.
function AdsRail({ leads, chats, spend }: { leads: number; chats: number; spend: string | null }) {
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      <RailCard title="The number that matters">
        <StatRow label="WhatsApp chats from ads" value={chats} />
        <StatRow label="Became real leads" value={leads} />
        {spend && <StatRow label="Spend this period" value={spend} />}
        <p className="text-[11px] text-slate-400 pt-1">Meta tells you what an ad <b>costs</b> — your portal tells you what it <b>produces</b>. Judge ads by leads, not clicks.</p>
      </RailCard>
      <RailCard title="How attribution works">
        <ol className="space-y-1.5 text-[11px] text-slate-500 list-decimal pl-4">
          <li>Someone taps your <b>Click-to-WhatsApp ad</b> and lands in your chat.</li>
          <li>Meta tags that first message with the ad it came from.</li>
          <li>We stamp the contact (<b>ad_id</b>, headline) — visible in Live Chat &amp; Contacts.</li>
          <li>When the AI or a form captures their details, they count as a <b>lead</b> for that ad.</li>
        </ol>
      </RailCard>
      <RailCard title="Tips">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Pause an ad when its <b>lead rate</b> stays well below your other ads — clicks without leads burn budget.</li>
          <li>Filter Contacts by <b>ad_id</b> to broadcast follow-ups to one ad&apos;s audience.</li>
          <li>Budget changes apply within minutes; Meta may take a few hours to re-learn after big jumps.</li>
        </ul>
      </RailCard>
    </aside>
  );
}

// Search-as-you-type picker for geo / interest targeting (create-ad wizard).
type TargetItem = { key: string; name: string; type?: string; audience?: number; radius?: number; context?: string };

const GEO_TYPE_LABELS: Record<string, string> = {
  country: "Country", region: "State / region", city: "City", subcity: "District", neighborhood: "Local area", metro_area: "Metro area", geo_market: "Market", zip: "PIN / ZIP",
};
const geoTypeLabel = (t?: string) => (t && GEO_TYPE_LABELS[t]) || t || "";
function TargetPicker({ kind, picked, onPick, onRemove, placeholder }: { kind: "geo" | "interest" | "locale"; picked: TargetItem[]; onPick: (x: TargetItem) => void; onRemove: (key: string) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TargetItem[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/admin/meta/search?kind=${kind}&q=${encodeURIComponent(q.trim())}`).then(r => r.json()).then(d => setResults(d.results ?? [])).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [q, kind]);
  return (
    <div className="space-y-1.5">
      {picked.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {picked.map(p => (
            <span key={p.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold" title={p.context}>
              {p.name}{p.type && p.type !== kind ? <span className="font-normal text-brand-700/60">· {kind === "geo" ? geoTypeLabel(p.type) : p.type}</span> : null}{p.context ? <span className="font-normal text-brand-700/50">· {p.context}</span> : null}
              <button onClick={() => onRemove(p.key)} className="text-brand-700/50 hover:text-red-500">×</button>
            </span>
          ))}
        </div>
      )}
      <input className={`${inp} w-full`} placeholder={placeholder} value={q} onChange={e => setQ(e.target.value)} />
      {results.length > 0 && (
        <div className="border border-line rounded-control divide-y divide-line max-h-44 overflow-y-auto bg-white">
          {results.map(r => (
            <button key={r.key} onClick={() => { onPick(r); setQ(""); setResults([]); }} className="w-full text-left px-3 py-1.5 hover:bg-canvas">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-semibold text-ink-900">{r.name}</span>
                <span className="text-[10px] text-slate-400">{kind === "geo" ? geoTypeLabel(r.type) : r.type}{r.audience ? ` · ~${r.audience >= 1e6 ? (r.audience / 1e6).toFixed(1) + "M" : Math.round(r.audience / 1e3) + "K"} people` : ""}</span>
              </div>
              {r.context && <p className="text-[10px] text-slate-400 leading-tight">{r.context}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── One unified location model ────────────────────────────────────────────────
// A location is either a whole country (no radius) or a radius around a point
// (any place — city, local area, metro, mall, college). Radius locations target
// Meta custom_locations (lat/lng + km); the map shows exactly what's covered.
type GeoResult = { name: string; context: string; lat: number; lng: number; type: string; countryCode?: string };
type LocationItem = { id: string; kind: "country" | "radius"; name: string; context?: string; countryCode?: string; lat?: number; lng?: number; radius?: number };
const DEFAULT_LOCATION: LocationItem = { id: "country:IN", kind: "country", name: "India", countryCode: "IN" };

// Client-only Leaflet map (needs `window`) — clean labelled tiles, all radius
// areas on ONE map (colour-coded) so overlaps are visible.
const RadiusLeafletMap = dynamic(() => import("../RadiusLeafletMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center bg-canvas"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></div>,
});
// Distinct colours per area — matched by a dot on each area's row below the map.
const RADIUS_COLORS = ["#2563eb", "#059669", "#db2777", "#d97706", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626"];
function RadiusMap({ points }: { points: { lat: number; lng: number; radius: number; name: string; color?: string }[] }) {
  return (
    <div className="w-full h-72 rounded-control overflow-hidden border border-line">
      <RadiusLeafletMap points={points} />
    </div>
  );
}

// One search bar for everything: countries, cities, local areas, PINs, and any
// landmark (metro, college, mall). Countries become a plain target; everything
// else becomes a radius location with a slider + map.
function LocationPicker({ locations, setLocations }: { locations: LocationItem[]; setLocations: Dispatch<SetStateAction<LocationItem[]>> }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return; }
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/admin/meta/search?kind=place&q=${encodeURIComponent(q.trim())}`).then(r => r.json()).then(d => setResults(d.results ?? [])).catch(() => {}).finally(() => setSearching(false));
    }, 450);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (r: GeoResult) => {
    const isCountry = r.type === "country";
    const item: LocationItem = isCountry
      ? { id: `country:${r.countryCode ?? r.name}`, kind: "country", name: r.name, countryCode: r.countryCode }
      : { id: `radius:${r.lat.toFixed(4)},${r.lng.toFixed(4)}`, kind: "radius", name: r.name, context: r.context, lat: r.lat, lng: r.lng, radius: 10 };
    setLocations(ls => {
      if (ls.some(l => l.id === item.id)) return ls;
      // Adding a specific radius area? Drop the default whole-country target so
      // you don't accidentally end up targeting the entire country + the area.
      const base = (item.kind === "radius" && ls.length === 1 && ls[0].id === DEFAULT_LOCATION.id) ? [] : ls;
      return [...base, item];
    });
    setQ(""); setResults([]);
  };
  const remove = (id: string) => setLocations(ls => ls.filter(l => l.id !== id));
  const setRadius = (id: string, radius: number) => setLocations(ls => ls.map(l => l.id === id ? { ...l, radius } : l));

  const radiusItems = locations.filter(l => l.kind === "radius");
  const countryItems = locations.filter(l => l.kind === "country");

  return (
    <div className="space-y-2">
      {/* chips */}
      {locations.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {countryItems.map(l => (
            <span key={l.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold">
              {l.name}<span className="font-normal text-brand-700/60">· Country</span>
              <button onClick={() => remove(l.id)} className="text-brand-700/50 hover:text-red-500">×</button>
            </span>
          ))}
        </div>
      )}
      {/* single search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input className={`${inp} w-full pl-8`} placeholder="Search a country, city, local area, PIN, or any place (e.g. Saket, IIT Delhi, Phoenix Mall)…" value={q} onChange={e => setQ(e.target.value)} />
        {searching && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" />}
      </div>
      {results.length > 0 && (
        <div className="border border-line rounded-control divide-y divide-line max-h-52 overflow-y-auto bg-white">
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)} className="w-full text-left px-3 py-1.5 hover:bg-canvas flex items-center gap-2">
              {r.type === "country" ? <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <MapPin className="w-3.5 h-3.5 text-brand-600 shrink-0" />}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-900 truncate">{r.name} <span className="font-normal text-[10px] text-slate-400">{r.type === "country" ? "Country" : "+ radius"}</span></p>
                {r.context && <p className="text-[10px] text-slate-400 leading-tight truncate">{r.context}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* radius areas — ONE map with every circle (overlaps visible), then a
          compact row per area (colour-matched to the map) with its own slider */}
      {radiusItems.length > 0 && (
        <RadiusMap points={radiusItems.map((l, i) => ({ lat: l.lat!, lng: l.lng!, radius: l.radius ?? 10, name: l.name, color: RADIUS_COLORS[i % RADIUS_COLORS.length] }))} />
      )}
      {radiusItems.map((l, i) => (
        <div key={l.id} className="rounded-control border border-line p-2.5 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-ink-900 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: RADIUS_COLORS[i % RADIUS_COLORS.length] }} /> {l.name}</p>
              {l.context && <p className="text-[10px] text-slate-400 truncate pl-4">{l.context}</p>}
            </div>
            <button onClick={() => remove(l.id)} className="text-[11px] font-bold text-red-500 hover:text-red-600 shrink-0">Remove</button>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-ink-700 font-semibold whitespace-nowrap">Radius</span>
            <input type="range" min={1} max={80} value={l.radius ?? 10} onChange={e => setRadius(l.id, Number(e.target.value))} className="flex-1 accent-brand-700" />
            <span className="text-brand-700 font-bold w-12 text-right">{l.radius ?? 10} km</span>
          </div>
        </div>
      ))}

      {countryItems.length > 0 && radiusItems.length > 0 && (
        <p className="text-[11px] text-amber-600">You have a whole country and specific areas selected — Meta will target <b>both</b>. Remove the country to target only the pinned areas.</p>
      )}
      {locations.length === 0 && <p className="text-[11px] text-slate-400">Add at least one location.</p>}
    </div>
  );
}

// Guided 4-step Click-to-WhatsApp campaign builder. Everything is created
// PAUSED by default — nothing spends until explicitly launched live.
const OBJECTIVES: { key: "OUTCOME_ENGAGEMENT" | "OUTCOME_SALES" | "OUTCOME_LEADS" | "OUTCOME_TRAFFIC" | "OUTCOME_AWARENESS"; label: string; hint: string }[] = [
  { key: "OUTCOME_ENGAGEMENT", label: "Engagement", hint: "Most WhatsApp chats — best for lead gen (recommended)" },
  { key: "OUTCOME_LEADS", label: "Leads", hint: "Optimise for people likely to become leads" },
  { key: "OUTCOME_SALES", label: "Sales", hint: "Optimise for people likely to convert / buy" },
  { key: "OUTCOME_TRAFFIC", label: "Traffic", hint: "Cheapest clicks into WhatsApp — high volume, lower intent" },
  { key: "OUTCOME_AWARENESS", label: "Awareness", hint: "Maximum reach — brand visibility, not chats" },
];
const BID_STRATEGIES: { key: "LOWEST_COST_WITHOUT_CAP" | "COST_CAP" | "LOWEST_COST_WITH_BID_CAP"; label: string; hint: string; needsAmount: boolean }[] = [
  { key: "LOWEST_COST_WITHOUT_CAP", label: "Highest volume", hint: "Get the most results for your budget (recommended)", needsAmount: false },
  { key: "COST_CAP", label: "Cost per result goal", hint: "Meta keeps your average cost per result around a target", needsAmount: true },
  { key: "LOWEST_COST_WITH_BID_CAP", label: "Bid cap", hint: "Hard limit on what you bid in each auction (advanced)", needsAmount: true },
];
const SPECIAL_CATS: [string, string][] = [
  ["CREDIT", "Credit"], ["EMPLOYMENT", "Employment"], ["HOUSING", "Housing"],
  ["FINANCIAL_PRODUCTS_SERVICES", "Financial products & services"], ["ISSUES_ELECTIONS_POLITICS", "Social issues, elections or politics"],
];
const AD_PLATFORMS: [string, string][] = [["facebook", "Facebook"], ["instagram", "Instagram"], ["messenger", "Messenger"], ["audience_network", "Audience Network"]];
// Placement positions per platform (Meta facebook_positions / instagram_positions / …).
const PLATFORM_POSITIONS: Record<string, [string, string][]> = {
  facebook: [["feed", "Feed"], ["facebook_reels", "Reels"], ["story", "Stories"], ["video_feeds", "Video feeds"], ["marketplace", "Marketplace"], ["instream_video", "In-stream video"], ["right_hand_column", "Right column"], ["search", "Search"]],
  instagram: [["stream", "Feed"], ["story", "Stories"], ["reels", "Reels"], ["explore", "Explore"], ["profile_feed", "Profile feed"]],
  messenger: [["messenger_home", "Inbox"], ["story", "Stories"]],
  audience_network: [["classic", "Native & banner"], ["rewarded_video", "Rewarded video"]],
};
const allPositions = (platform: string) => (PLATFORM_POSITIONS[platform] ?? []).map(([v]) => v);
const CONVERSION_LOCATIONS: { key: "WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM"; label: string; hint: string }[] = [
  { key: "WHATSAPP", label: "WhatsApp", hint: "Chat opens with your number" },
  { key: "WEBSITE", label: "Website", hint: "Send people to your site / landing page" },
  { key: "INSTANT_FORM", label: "Instant form", hint: "Collect leads in a native Meta form" },
  { key: "MESSENGER", label: "Messenger", hint: "Chat opens in Messenger" },
];
const WEB_CTAS: [string, string][] = [["LEARN_MORE", "Learn more"], ["SIGN_UP", "Sign up"], ["APPLY_NOW", "Apply now"], ["GET_OFFER", "Get offer"], ["BOOK_TRAVEL", "Book now"], ["DOWNLOAD", "Download"], ["SHOP_NOW", "Shop now"], ["CONTACT_US", "Contact us"], ["SUBSCRIBE", "Subscribe"]];
const PIXEL_EVENTS: [string, string][] = [["LEAD", "Lead"], ["COMPLETE_REGISTRATION", "Complete registration"], ["PURCHASE", "Purchase"], ["ADD_TO_CART", "Add to cart"], ["INITIATED_CHECKOUT", "Initiated checkout"], ["CONTACT", "Contact"], ["SUBMIT_APPLICATION", "Submit application"], ["SCHEDULE", "Schedule"], ["VIEW_CONTENT", "View content"]];
// Performance goals (optimization_goal) Meta allows per conversion location.
// First entry is the recommended default.
const PERF_GOALS = (destination: string, hasPixel: boolean): [string, string][] => {
  if (destination === "WHATSAPP" || destination === "MESSENGER")
    return [["CONVERSATIONS", "Maximise conversations"], ["LINK_CLICKS", "Maximise link clicks"], ["REACH", "Maximise reach"], ["IMPRESSIONS", "Maximise impressions"]];
  if (destination === "INSTANT_FORM")
    return [["LEAD_GENERATION", "Maximise leads"]];
  const base: [string, string][] = [["LANDING_PAGE_VIEWS", "Maximise landing-page views"], ["LINK_CLICKS", "Maximise link clicks"], ["REACH", "Maximise reach"], ["IMPRESSIONS", "Maximise impressions"]];
  return hasPixel ? [["OFFSITE_CONVERSIONS", "Maximise conversions"], ...base] : base;
};

function CreateAdBuilder({ currency, hasPage, campaigns = [], onClose, onCreated, draftId: initialDraftId, draftData }: { currency: string; hasPage: boolean; campaigns?: { id: string; name: string; objective: string; dailyBudget: number | null }[]; onClose: () => void; onCreated: () => void; draftId?: string | null; draftData?: Record<string, unknown> | null }) {
  const TOTAL = 5;
  const [step, setStep] = useState(1);
  // "existing" → add an ad set to an already-created campaign (multiple ad sets per
  // campaign). The campaign's objective is inherited; its budget mode (CBO/ABO) too.
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [intoCampaignId, setIntoCampaignId] = useState("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState<typeof OBJECTIVES[number]["key"]>("OUTCOME_ENGAGEMENT");
  const [optGoal, setOptGoal] = useState("");
  const [destination, setDestination] = useState<"WHATSAPP" | "MESSENGER" | "WEBSITE" | "INSTANT_FORM">("WHATSAPP");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [conversionEvent, setConversionEvent] = useState("LEAD");
  const [leadFormId, setLeadFormId] = useState("");
  const [ctaType, setCtaType] = useState("LEARN_MORE");
  const [pixels, setPixels] = useState<{ id: string; name: string }[]>([]);
  const [leadForms, setLeadForms] = useState<{ id: string; name: string; status: string }[]>([]);
  const [specialCats, setSpecialCats] = useState<string[]>([]);
  const [budgetLevel, setBudgetLevel] = useState<"adset" | "campaign">("adset");
  const [budgetType, setBudgetType] = useState<"daily" | "lifetime">("daily");
  const [budget, setBudget] = useState("500");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bidStrategy, setBidStrategy] = useState<typeof BID_STRATEGIES[number]["key"]>("LOWEST_COST_WITHOUT_CAP");
  const [bidAmount, setBidAmount] = useState("");
  const [locations, setLocations] = useState<LocationItem[]>([DEFAULT_LOCATION]);
  const [flows, setFlows] = useState<{ id: string; name: string; active: boolean }[]>([]);
  const [flowId, setFlowId] = useState("");
  const [flowScope, setFlowScope] = useState<"campaign" | "ad">("campaign");
  const [interests, setInterests] = useState<TargetItem[]>([]);
  const [languages, setLanguages] = useState<TargetItem[]>([]);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(55);
  const [gender, setGender] = useState<"all" | "men" | "women">("all");
  const [advantage, setAdvantage] = useState(true);
  const [placements, setPlacements] = useState<"advantage" | "manual">("advantage");
  const [platforms, setPlatforms] = useState<string[]>(["facebook", "instagram"]);
  const [positions, setPositions] = useState<Record<string, string[]>>({ facebook: allPositions("facebook"), instagram: allPositions("instagram") });
  const togglePlatform = (k: string) => setPlatforms(p => {
    if (p.includes(k)) { setPositions(pos => { const n = { ...pos }; delete n[k]; return n; }); return p.filter(x => x !== k); }
    setPositions(pos => ({ ...pos, [k]: allPositions(k) }));      // enable → all positions on by default
    return [...p, k];
  });
  const togglePosition = (platform: string, value: string) => setPositions(pos => {
    const cur = pos[platform] ?? allPositions(platform);
    const next = cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value];
    return { ...pos, [platform]: next.length ? next : cur };   // keep at least one
  });
  const [customAudiences, setCustomAudiences] = useState<{ id: string; name: string; count: number | null }[]>([]);
  const [includeAuds, setIncludeAuds] = useState<string[]>([]);
  const [excludeAuds, setExcludeAuds] = useState<string[]>([]);
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [urlTags, setUrlTags] = useState("");
  const [creativeFormat, setCreativeFormat] = useState<"single" | "video" | "carousel">("single");
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoName, setVideoName] = useState("");
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [cards, setCards] = useState<{ imageHash: string | null; imageName: string; imagePreview: string | null; headline: string; description: string }[]>([
    { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" },
    { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" },
  ]);
  const [cardUploading, setCardUploading] = useState<number | null>(null);
  // Extra creatives — each launches as its own ad in the SAME ad set (a creative
  // test). Creative 1 above is the primary (full-featured, live-previewed); these
  // are compact single-image / video variants.
  const [extraCreatives, setExtraCreatives] = useState<{ format: "single" | "video"; imageHash: string | null; imageName: string; imagePreview: string | null; videoId: string | null; videoName: string; videoPreview: string | null; primaryText: string; headline: string; description: string; uploading: boolean }[]>([]);
  const setExtra = (i: number, patch: Partial<typeof extraCreatives[number]>) => setExtraCreatives(cs => cs.map((c, x) => x === i ? { ...c, ...patch } : c));
  const [placement, setPlacement] = useState<string>("fb_feed");
  const [previewIdx, setPreviewIdx] = useState(0);   // which creative the preview pane shows (0 = primary)
  const [realPreviews, setRealPreviews] = useState<{ key: string; label: string; html: string }[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<{ lower?: number; upper?: number } | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateErr, setEstimateErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activate, setActivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Campaigns created in THIS session — so a just-made campaign is instantly
  // selectable for another ad set without waiting for Meta's list to refresh.
  const [localCampaigns, setLocalCampaigns] = useState<{ id: string; name: string; objective: string; dailyBudget: number | null }[]>([]);
  // Success screen after a create — offers "add another ad set to this campaign".
  const [done, setDone] = useState<{ campaignId: string; campaignName: string; cbo: boolean; wasNew: boolean } | null>(null);
  const sym = currency === "INR" ? "₹" : currency ? currency + " " : "";
  const bidNeedsAmount = BID_STRATEGIES.find(b => b.key === bidStrategy)?.needsAmount ?? false;
  useEffect(() => { fetch("/api/admin/meta/audiences").then(r => r.json()).then(d => { setCustomAudiences(d.audiences ?? []); setPixels(d.pixels ?? []); setLeadForms(d.leadForms ?? []); }).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows((d.flows ?? []).filter((f: { active: boolean }) => f.active))).catch(() => {}); }, []);
  const toIso = (d: string, end = false) => d ? new Date(`${d}T${end ? "23:59" : "00:00"}:00`).toISOString() : null;

  // ── Draft auto-save ── snapshot the whole form so a refresh never loses work
  // (and never launches the ad — drafts only become live when you hit Create).
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null);
  const restoredRef = useRef(false);
  // Restore a resumed draft once on mount.
  useEffect(() => {
    if (restoredRef.current || !draftData) return;
    restoredRef.current = true;
    const d = draftData as Record<string, unknown>;
    const S = <T,>(v: unknown, set: (x: T) => void) => { if (v !== undefined && v !== null) set(v as T); };
    S(d.step, setStep);
    S(d.name, setName); S(d.objective, setObjective); S(d.optGoal, setOptGoal); S(d.destination, setDestination); S(d.websiteUrl, setWebsiteUrl);
    S(d.pixelId, setPixelId); S(d.conversionEvent, setConversionEvent); S(d.leadFormId, setLeadFormId); S(d.ctaType, setCtaType);
    S(d.specialCats, setSpecialCats); S(d.budgetLevel, setBudgetLevel); S(d.budgetType, setBudgetType); S(d.budget, setBudget);
    S(d.startDate, setStartDate); S(d.endDate, setEndDate); S(d.bidStrategy, setBidStrategy); S(d.bidAmount, setBidAmount);
    S(d.locations, setLocations); S(d.interests, setInterests); S(d.languages, setLanguages); S(d.ageMin, setAgeMin); S(d.ageMax, setAgeMax);
    S(d.gender, setGender); S(d.advantage, setAdvantage); S(d.placements, setPlacements); S(d.platforms, setPlatforms); S(d.positions, setPositions);
    S(d.includeAuds, setIncludeAuds); S(d.excludeAuds, setExcludeAuds); S(d.primaryText, setPrimaryText); S(d.headline, setHeadline);
    S(d.description, setDescription); S(d.urlTags, setUrlTags); S(d.creativeFormat, setCreativeFormat); S(d.imageHash, setImageHash);
    S(d.imageName, setImageName); S(d.videoId, setVideoId); S(d.videoName, setVideoName); S(d.flowId, setFlowId); S(d.flowScope, setFlowScope);
    const draftCards = Array.isArray(d.cards) ? d.cards as { imageHash: string | null; imageName: string; headline: string; description: string }[] : [];
    if (draftCards.length) setCards(draftCards.map(c => ({ ...c, imagePreview: null })));
    const draftExtra = Array.isArray(d.extraCreatives) ? d.extraCreatives as { format: "single" | "video"; imageHash: string | null; imageName: string; videoId: string | null; videoName: string; primaryText: string; headline: string; description: string }[] : [];
    if (draftExtra.length) setExtraCreatives(draftExtra.map(ec => ({ ...ec, imagePreview: null, videoPreview: null, uploading: false })));
    // The upload preview blob is gone on reopen — re-fetch Meta-hosted URLs from
    // the saved hashes so the restored image(s) show again.
    void (async () => {
      const hashes = [d.imageHash as string | undefined, ...draftCards.map(c => c.imageHash ?? undefined), ...draftExtra.map(ec => ec.imageHash ?? undefined)].filter(Boolean) as string[];
      if (hashes.length) {
        const res = await fetch(`/api/admin/meta/media?hashes=${hashes.join(",")}`).then(r => r.json()).catch(() => null);
        const urls: Record<string, string> = res?.urls ?? {};
        if (d.imageHash && urls[d.imageHash as string]) setImagePreview(urls[d.imageHash as string]);
        if (draftCards.length) setCards(cs => cs.map((c, i) => { const h = draftCards[i]?.imageHash; return h && urls[h] ? { ...c, imagePreview: urls[h] } : c; }));
        if (draftExtra.length) setExtraCreatives(cs => cs.map((c, i) => { const h = draftExtra[i]?.imageHash; return h && urls[h] ? { ...c, imagePreview: urls[h] } : c; }));
      }
      if (d.videoId) {
        const res = await fetch(`/api/admin/meta/media?videoId=${d.videoId}`).then(r => r.json()).catch(() => null);
        if (res?.thumb) setVideoPreview(res.thumb as string);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const serialize = (): Record<string, unknown> => ({
    step,
    name, objective, optGoal, destination, websiteUrl, pixelId, conversionEvent, leadFormId, ctaType, specialCats,
    budgetLevel, budgetType, budget, startDate, endDate, bidStrategy, bidAmount,
    locations, interests, languages, ageMin, ageMax, gender, advantage, placements, platforms, positions, includeAuds, excludeAuds,
    primaryText, headline, description, urlTags, creativeFormat, imageHash, imageName, videoId, videoName,
    cards: cards.map(c => ({ imageHash: c.imageHash, imageName: c.imageName, headline: c.headline, description: c.description })),
    extraCreatives: extraCreatives.map(ec => ({ format: ec.format, imageHash: ec.imageHash, imageName: ec.imageName, videoId: ec.videoId, videoName: ec.videoName, primaryText: ec.primaryText, headline: ec.headline, description: ec.description })),
    flowId, flowScope,
  });

  // Debounced auto-save once there's something worth keeping.
  useEffect(() => {
    if (creating) return;
    const hasContent = name.trim() || headline.trim() || primaryText.trim() || imageHash || videoId;
    if (!hasContent) return;
    const t = setTimeout(async () => {
      const d = await fetch("/api/admin/meta/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draftId, name: name.trim() || "Untitled ad", data: serialize() }),
      }).then(r => r.json()).catch(() => null);
      if (d?.id && !draftId) setDraftId(d.id);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, name, objective, optGoal, destination, websiteUrl, pixelId, conversionEvent, leadFormId, ctaType, specialCats, budgetLevel, budgetType, budget, startDate, endDate, bidStrategy, bidAmount, locations, interests, languages, ageMin, ageMax, gender, advantage, placements, platforms, positions, includeAuds, excludeAuds, primaryText, headline, description, urlTags, creativeFormat, imageHash, imageName, videoId, videoName, cards, extraCreatives, flowId, flowScope]);

  async function uploadImage(f: File) {
    setUploading(true); setErr(null);
    try {
      setImagePreview(URL.createObjectURL(f));          // instant local preview
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.imageHash) { setImageHash(d.imageHash); setImageName(f.name); } else setErr(d.error || "Upload failed");
    } finally { setUploading(false); }
  }

  async function uploadVideo(f: File) {
    setUploading(true); setErr(null);
    try {
      setVideoPreview(URL.createObjectURL(f));          // instant local preview
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.videoId) { setVideoId(d.videoId); setVideoName(f.name); } else setErr(d.error || "Video upload failed");
    } finally { setUploading(false); }
  }

  async function uploadCardImage(i: number, f: File) {
    setCardUploading(i); setErr(null);
    const preview = URL.createObjectURL(f);
    setCards(cs => cs.map((c, x) => x === i ? { ...c, imagePreview: preview } : c));
    try {
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.imageHash) setCards(cs => cs.map((c, x) => x === i ? { ...c, imageHash: d.imageHash, imageName: f.name } : c));
      else setErr(d.error || "Upload failed");
    } finally { setCardUploading(null); }
  }

  // Upload media for an extra creative (image or video), by index.
  async function uploadExtraMedia(i: number, f: File, kind: "image" | "video") {
    setExtra(i, { uploading: true, ...(kind === "image" ? { imagePreview: URL.createObjectURL(f) } : { videoPreview: URL.createObjectURL(f) }) });
    setErr(null);
    try {
      const fd = new FormData(); fd.append("file", f);
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (kind === "image" && d.imageHash) setExtra(i, { imageHash: d.imageHash, imageName: f.name });
      else if (kind === "video" && d.videoId) setExtra(i, { videoId: d.videoId, videoName: f.name });
      else setErr(d.error || "Upload failed");
    } finally { setExtra(i, { uploading: false }); }
  }

  async function create() {
    setCreating(true); setErr(null);
    try {
      const d = await fetch("/api/admin/meta/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: intoCampaignId || undefined,
          name: name.trim(), objective, conversionLocation: destination, specialAdCategories: specialCats,
          websiteUrl: websiteUrl.trim() || null, pixelId: pixelId || null, conversionEvent: conversionEvent || null,
          leadFormId: leadFormId || null, ctaType,
          budgetLevel, budgetType, budget: Number(budget),
          startTime: toIso(startDate), endTime: toIso(endDate, true),
          bidStrategy, bidAmount: bidNeedsAmount ? Number(bidAmount) : null,
          optimizationGoal: effectiveGoal,
          placements, publisherPlatforms: platforms, activate,
          positions: placements === "manual" ? Object.fromEntries(platforms.map(p => [p, positions[p]?.length ? positions[p] : allPositions(p)])) : {},
          targeting: {
            countries: locations.filter(l => l.kind === "country").map(l => l.countryCode!).filter(Boolean),
            customLocations: locations.filter(l => l.kind === "radius").map(l => ({ lat: l.lat!, lng: l.lng!, radius: l.radius ?? 10, name: l.name })),
            ageMin, ageMax,
            genders: gender === "men" ? [1] : gender === "women" ? [2] : [],
            interests: interests.map(i => ({ id: i.key, name: i.name })),
            locales: languages.map(l => Number(l.key)).filter(Boolean),
            customAudiences: includeAuds.map(id => ({ id })),
            excludedCustomAudiences: excludeAuds.map(id => ({ id })),
            advantageAudience: advantage,
          },
          // Primary creative first, then any extra variants — each becomes its own
          // ad in the one ad set (a creative test).
          creatives: [
            {
              format: creativeFormat,
              imageHash, videoId,
              cards: creativeFormat === "carousel" ? cards.map(c => ({ imageHash: c.imageHash, headline: c.headline.trim(), description: c.description.trim() })) : undefined,
              primaryText: primaryText.trim(), headline: headline.trim(), description: description.trim(), urlTags: urlTags.trim(),
            },
            ...extraCreatives.map(ec => ({
              format: ec.format,
              imageHash: ec.format === "single" ? ec.imageHash : null,
              videoId: ec.format === "video" ? ec.videoId : null,
              primaryText: ec.primaryText.trim(), headline: ec.headline.trim(), description: ec.description.trim(), urlTags: urlTags.trim(),
            })),
          ],
          flowId: destination === "WHATSAPP" && flowId ? flowId : null, flowScope,
        }),
      }).then(r => r.json());
      if (d.success) {
        if (draftId) { await fetch(`/api/admin/meta/drafts?id=${draftId}`, { method: "DELETE" }).catch(() => {}); setDraftId(null); }
        if (d.campaignId) {
          // What campaign did this ad set land in, and is it CBO (shared budget)?
          const cbo = addingToExisting ? existingCbo : budgetLevel === "campaign";
          const cName = addingToExisting ? intoCampaign!.name : name.trim();
          const cBudget = addingToExisting ? intoCampaign!.dailyBudget : (budgetLevel === "campaign" ? Number(budget) : null);
          setLocalCampaigns(prev => prev.some(c => c.id === d.campaignId)
            ? prev
            : [{ id: d.campaignId as string, name: cName, objective, dailyBudget: cBudget }, ...prev]);
          setDone({ campaignId: d.campaignId as string, campaignName: cName, cbo, wasNew: !addingToExisting });
        } else onCreated();
      } else setErr(d.error || "Creation failed");
    } finally { setCreating(false); }
  }

  // After a create, build another ad set under the SAME campaign — inherit its
  // goal + budget mode, clear the ad-set-specific fields, jump back to step 1.
  function addAnotherAdSet(campaignId: string) {
    const c = allCampaigns.find(x => x.id === campaignId);
    setMode("existing"); setIntoCampaignId(campaignId);
    if (c) { setObjective(c.objective as typeof OBJECTIVES[number]["key"]); setBudgetLevel(c.dailyBudget != null ? "campaign" : "adset"); }
    setName("");
    setPrimaryText(""); setHeadline(""); setDescription(""); setUrlTags("");
    setCreativeFormat("single");
    setImageHash(null); setImageName(""); setImagePreview(null);
    setVideoId(null); setVideoName(""); setVideoPreview(null);
    setCards([{ imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" }, { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" }]);
    setExtraCreatives([]);
    setInterests([]); setLanguages([]); setLocations([DEFAULT_LOCATION]);
    setIncludeAuds([]); setExcludeAuds([]);
    setRealPreviews(null); setEstimate(null); setEstimateErr(null);
    setActivate(false); setErr(null); setDone(null); setStep(1);
  }

  // Enough uploaded for Meta to render a real preview?
  const mediaReady = creativeFormat === "single" ? !!imageHash : creativeFormat === "video" ? !!videoId : cards.filter(c => c.imageHash).length >= 2;
  // Debounced live preview straight from Meta — the exact render each placement shows.
  useEffect(() => {
    if (step !== 4 || !mediaReady || !headline.trim() || !primaryText.trim()) { setRealPreviews(null); return; }
    const handle = setTimeout(async () => {
      setPreviewLoading(true); setPreviewErr(null);
      try {
        const d = await fetch("/api/admin/meta/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective, conversionLocation: destination,
            websiteUrl: websiteUrl.trim() || null, pixelId: pixelId || null, conversionEvent: conversionEvent || null, leadFormId: leadFormId || null, ctaType,
            creative: {
              format: creativeFormat, imageHash, videoId,
              cards: creativeFormat === "carousel" ? cards.map(c => ({ imageHash: c.imageHash, headline: c.headline.trim(), description: c.description.trim() })) : undefined,
              primaryText: primaryText.trim(), headline: headline.trim(), description: description.trim(), urlTags: urlTags.trim(),
            },
          }),
        }).then(r => r.json());
        if (d.previews?.length) {
          setRealPreviews(d.previews);
          setPlacement(p => d.previews.some((x: { key: string }) => x.key === p) ? p : d.previews[0].key);
        } else { setRealPreviews(null); setPreviewErr(d.error || "Preview unavailable"); }
      } catch { setPreviewErr("Preview unavailable"); } finally { setPreviewLoading(false); }
    }, 900);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mediaReady, creativeFormat, imageHash, videoId, cards, primaryText, headline, description, urlTags, destination, objective, websiteUrl, ctaType, pixelId, conversionEvent, leadFormId]);

  // Debounced audience-size estimate from Meta — shown on the audience step.
  useEffect(() => {
    if (step !== 3 || locations.length === 0) { return; }
    const handle = setTimeout(async () => {
      setEstimateLoading(true); setEstimateErr(null);
      try {
        const d = await fetch("/api/admin/meta/estimate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            objective, conversionLocation: destination,
            websiteUrl: websiteUrl.trim() || null, pixelId: pixelId || null, conversionEvent: conversionEvent || null, leadFormId: leadFormId || null, ctaType,
            optimizationGoal: effectiveGoal,
            placements, publisherPlatforms: platforms,
            positions: placements === "manual" ? Object.fromEntries(platforms.map(p => [p, positions[p]?.length ? positions[p] : allPositions(p)])) : {},
            targeting: {
              countries: locations.filter(l => l.kind === "country").map(l => l.countryCode!).filter(Boolean),
              customLocations: locations.filter(l => l.kind === "radius").map(l => ({ lat: l.lat!, lng: l.lng!, radius: l.radius ?? 10, name: l.name })),
              ageMin, ageMax,
              genders: gender === "men" ? [1] : gender === "women" ? [2] : [],
              interests: interests.map(i => ({ id: i.key, name: i.name })),
              locales: languages.map(l => Number(l.key)).filter(Boolean),
              customAudiences: includeAuds.map(id => ({ id })),
              excludedCustomAudiences: excludeAuds.map(id => ({ id })),
              advantageAudience: advantage,
            },
          }),
        }).then(r => r.json());
        if (d.lower != null || d.upper != null) { setEstimate({ lower: d.lower, upper: d.upper }); }
        else { setEstimate(null); setEstimateErr(d.error || "Estimate unavailable"); }
      } catch { setEstimateErr("Estimate unavailable"); } finally { setEstimateLoading(false); }
    }, 700);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, locations, interests, languages, ageMin, ageMax, gender, advantage, includeAuds, excludeAuds, placements, platforms, positions, objective, optGoal, pixelId, destination]);

  // Meta's campaigns plus any created this session (so a just-made one is pickable).
  const allCampaigns = localCampaigns.length
    ? [...localCampaigns.filter(lc => !campaigns.some(c => c.id === lc.id)), ...campaigns]
    : campaigns;
  // Adding an ad set to an existing campaign: inherit its objective + budget mode.
  const intoCampaign = mode === "existing" ? (allCampaigns.find(c => c.id === intoCampaignId) ?? null) : null;
  const addingToExisting = !!intoCampaign;
  const existingCbo = !!intoCampaign && intoCampaign.dailyBudget != null;   // campaign-level budget → CBO
  const canNext =
    step === 1 ? name.trim().length > 0 && (mode === "new" || !!intoCampaignId)
    : step === 2 ? (existingCbo || Number(budget) > 0) && (budgetType !== "lifetime" || !!endDate) && (!bidNeedsAmount || Number(bidAmount) > 0) && (destination !== "WEBSITE" || websiteUrl.trim().length > 0) && (destination !== "INSTANT_FORM" || !!leadFormId)
    : step === 3 ? locations.length > 0
    : step === 4 ? primaryText.trim().length > 0 && headline.trim().length > 0
      && (creativeFormat !== "video" || !!videoId)
      && (creativeFormat !== "carousel" || (cards.length >= 2 && cards.every(c => c.imageHash && c.headline.trim().length > 0)))
      && extraCreatives.every(ec => ec.primaryText.trim().length > 0 && ec.headline.trim().length > 0 && (ec.format !== "video" || !!ec.videoId))
    : true;
  const stepTitle = ["", "Campaign name", "Goal & budget", "Audience", "Ad creative", "Review & launch"][step];
  const field = "space-y-1";
  const lbl = "text-[11px] font-bold text-ink-700";

  // Performance goal — selectable; valid options depend on the conversion location.
  const goalOpts = PERF_GOALS(destination, !!pixelId);
  const effectiveGoal = optGoal && goalOpts.some(o => o[0] === optGoal) ? optGoal : goalOpts[0][0];
  const perfGoal = (() => {
    const base = goalOpts.find(o => o[0] === effectiveGoal)?.[1] ?? goalOpts[0][1];
    return effectiveGoal === "OFFSITE_CONVERSIONS" ? `${base} · ${PIXEL_EVENTS.find(e => e[0] === conversionEvent)?.[1]}` : base;
  })();
  const ctaLabel =
    destination === "WHATSAPP" ? "Send WhatsApp message"
    : destination === "MESSENGER" ? "Send message"
    : destination === "INSTANT_FORM" ? "Sign up"
    : WEB_CTAS.find(c => c[0] === ctaType)?.[1] ?? "Learn more";

  // Every creative in this ad set, for the preview switcher. #1 is the primary
  // (gets Meta's live render); extras show the built-in mock.
  const previews = [
    { format: creativeFormat, imageUrl: imagePreview, videoUrl: videoPreview, cards: cards.map(c => ({ imageUrl: c.imagePreview, headline: c.headline, description: c.description })), primaryText, headline, description, real: realPreviews, mediaReady },
    ...extraCreatives.map(ec => ({ format: ec.format, imageUrl: ec.imagePreview, videoUrl: ec.videoPreview, cards: [] as { imageUrl: string | null; headline: string; description: string }[], primaryText: ec.primaryText, headline: ec.headline, description: ec.description, real: null, mediaReady: ec.format === "video" ? !!ec.videoId : !!ec.imageHash })),
  ];
  const pIdx = Math.min(previewIdx, previews.length - 1);   // clamp if a creative was removed
  const pv = previews[pIdx];

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-2xl space-y-3">
      <button onClick={onClose} className="text-xs font-bold text-brand-700 flex items-center gap-1 hover:gap-1.5 transition-all"><ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns</button>
      {done ? (
        <div className="rounded-card border border-brand-200 bg-brand-50 p-5 space-y-4 max-w-lg">
          <div className="flex items-center gap-2.5">
            <CircleCheck className="w-6 h-6 text-brand-700 shrink-0" />
            <div>
              <h2 className="text-lg font-extrabold text-brand-dark">{done.wasNew ? "Campaign created" : "Ad set added"}</h2>
              <p className="text-xs text-slate-500">{activate ? "It's live now." : "Created paused — preview it, then Resume from the campaign list."}</p>
            </div>
          </div>
          <div className="bg-white rounded-control border border-line px-3 py-2 text-xs">
            <p className="font-bold text-ink-900">{done.campaignName}</p>
            <p className="text-slate-500">{done.cbo ? "Shared campaign budget (CBO) — new ad sets share it." : "Per-ad-set budget (ABO) — each ad set sets its own."}</p>
          </div>
          <p className="text-xs text-slate-600">Want to reach more audiences under this campaign? Add another ad set — it lands in <b>{done.campaignName}</b> and inherits its goal{done.cbo ? " and shared budget" : ""}.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => addAnotherAdSet(done.campaignId)} className="px-4 py-2 rounded-control bg-brand-700 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add another ad set</button>
            <button onClick={onCreated} className="px-4 py-2 rounded-control border border-line bg-white text-xs font-bold text-ink-700 hover:bg-canvas">Done — back to campaigns</button>
          </div>
        </div>
      ) : (<>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Megaphone className="w-5 h-5" /> {addingToExisting ? "New ad set" : "New ad"}</h2>
          <p className="text-[11px] text-slate-400">Step {step} of {TOTAL} — {stepTitle}{addingToExisting ? ` · in ${intoCampaign!.name}` : ""}</p>
        </div>
      </div>
      <div className="flex gap-1">{Array.from({ length: TOTAL }, (_, i) => i + 1).map(s => <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-brand-700" : "bg-line"}`} />)}</div>

        {!hasPage && <div className="bg-amber-50 border border-amber-200 rounded-control px-3 py-2 text-xs text-amber-800">Save your Facebook Page ID first (banner on the Ads page) — Click-to-WhatsApp ads run from a Page with your WhatsApp number connected.</div>}

        {step === 1 && (
          <div className="space-y-3">
            {allCampaigns.length > 0 && (
              <div className={field}>
                <p className={lbl}>What are you creating?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => { setMode("new"); setIntoCampaignId(""); }} className={`text-left rounded-control border p-2.5 transition-colors ${mode === "new" ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
                    <p className="text-xs font-bold text-ink-900">New campaign</p>
                    <p className="text-[11px] text-slate-500">Fresh campaign with its first ad set.</p>
                  </button>
                  <button onClick={() => setMode("existing")} className={`text-left rounded-control border p-2.5 transition-colors ${mode === "existing" ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
                    <p className="text-xs font-bold text-ink-900">Add ad set to a campaign</p>
                    <p className="text-[11px] text-slate-500">A new audience under an existing campaign.</p>
                  </button>
                </div>
              </div>
            )}
            {mode === "existing" && (
              <div className={field}>
                <p className={lbl}>Campaign to add the ad set to</p>
                <select className={`${inp} w-full`} value={intoCampaignId} onChange={e => {
                  const id = e.target.value; setIntoCampaignId(id);
                  const c = allCampaigns.find(x => x.id === id);
                  if (c) { setObjective(c.objective as typeof OBJECTIVES[number]["key"]); setBudgetLevel(c.dailyBudget != null ? "campaign" : "adset"); }
                }}>
                  <option value="">Choose a campaign…</option>
                  {allCampaigns.map(c => <option key={c.id} value={c.id}>{c.name}{c.dailyBudget != null ? " · CBO" : " · ABO"}</option>)}
                </select>
                <p className="text-[11px] text-slate-400">The ad set inherits this campaign&apos;s goal{existingCbo ? " and shared budget (CBO)" : " (you set this ad set's own budget next)"}.</p>
              </div>
            )}
            <div className={field}>
              <p className={lbl}>{addingToExisting ? "Ad set name" : "Campaign name"} <span className="font-normal text-slate-400">(internal — customers never see it)</span></p>
              <input className={`${inp} w-full`} placeholder={addingToExisting ? "e.g. Retargeting — website visitors" : "e.g. Data Science — June intake"} value={name} onChange={e => setName(e.target.value)} autoFocus />
              <p className="text-[11px] text-slate-400">Name it so you&apos;ll recognise it later in reports — audience + offer is a good pattern.</p>
            </div>
          </div>
        )}

        {step === 2 && <>
          <div className={field}>
            <p className={lbl}>Campaign goal</p>
            {addingToExisting ? (
              <div className="bg-canvas rounded-control px-3 py-2 text-xs text-ink-900"><b>{OBJECTIVES.find(o => o.key === objective)?.label ?? objective}</b> <span className="text-slate-400 font-normal">· inherited from {intoCampaign!.name}</span></div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {OBJECTIVES.map(o => (
                  <button key={o.key} onClick={() => setObjective(o.key)} className={`text-left rounded-control border p-2.5 transition-colors ${objective === o.key ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
                    <p className="text-xs font-bold text-ink-900">{o.label}</p>
                    <p className="text-[11px] text-slate-500">{o.hint}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={field}>
            <p className={lbl}>Conversion location — where people go after they click</p>
            <div className="grid grid-cols-2 gap-2">
              {CONVERSION_LOCATIONS.map(c => (
                <button key={c.key} onClick={() => setDestination(c.key)} className={`text-left rounded-control border p-2.5 ${destination === c.key ? "border-brand-500 bg-brand-50" : "border-line hover:border-slate-300"}`}>
                  <p className="text-xs font-bold text-ink-900">{c.label}</p>
                  <p className="text-[10px] text-slate-500">{c.hint}</p>
                </button>
              ))}
            </div>
          </div>
          {destination === "WEBSITE" && (
            <div className="rounded-control border border-line p-3 space-y-2">
              <div className={field}>
                <p className={lbl}>Website URL</p>
                <input className={`${inp} w-full`} placeholder="https://yoursite.com/landing" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className={field}>
                  <p className={lbl}>Button</p>
                  <select className={`${inp} w-full`} value={ctaType} onChange={e => setCtaType(e.target.value)}>{WEB_CTAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
                <div className={field}>
                  <p className={lbl}>Optimise for (pixel)</p>
                  <select className={`${inp} w-full`} value={pixelId} onChange={e => setPixelId(e.target.value)}>
                    <option value="">Traffic — just clicks/visits</option>
                    {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              {pixelId && (
                <div className={field}>
                  <p className={lbl}>Conversion event</p>
                  <select className={`${inp} w-full`} value={conversionEvent} onChange={e => setConversionEvent(e.target.value)}>{PIXEL_EVENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
              )}
              {pixels.length === 0 && <p className="text-[11px] text-amber-600">No pixels found on this account — the ad will optimise for visits. Install a pixel in Events Manager to optimise for conversions.</p>}
            </div>
          )}
          {destination === "INSTANT_FORM" && (
            <div className="rounded-control border border-line p-3 space-y-1.5">
              <p className={lbl}>Lead form</p>
              {leadForms.length === 0
                ? <p className="text-[11px] text-amber-600">No lead forms found on your Page. Create one in Ads Manager (or Page → Lead forms) and it&apos;ll appear here.</p>
                : <select className={`${inp} w-full`} value={leadFormId} onChange={e => setLeadFormId(e.target.value)}>
                    <option value="">Choose a form…</option>
                    {leadForms.map(f => <option key={f.id} value={f.id}>{f.name}{f.status && f.status !== "ACTIVE" ? ` (${f.status})` : ""}</option>)}
                  </select>}
            </div>
          )}
          <div className={field}>
            <p className={lbl}>Performance goal <span className="font-normal text-slate-400">(what Meta optimises delivery for)</span></p>
            {goalOpts.length > 1 ? (
              <select className={`${inp} w-full`} value={effectiveGoal} onChange={e => setOptGoal(e.target.value)}>
                {goalOpts.map(([v, l], i) => <option key={v} value={v}>{l}{i === 0 ? " — recommended" : ""}</option>)}
              </select>
            ) : (
              <div className="bg-canvas rounded-control px-3 py-2 text-xs font-bold text-ink-900">{perfGoal}</div>
            )}
          </div>
          {existingCbo ? (
            <div className="bg-canvas rounded-control px-3 py-2 text-[11px] text-slate-500">This campaign uses a shared <b>Advantage campaign budget (CBO)</b> — Meta splits it across ad sets automatically, so this ad set doesn&apos;t take its own budget.</div>
          ) : <>
            <div className="grid grid-cols-2 gap-2">
              <div className={field}>
                <p className={lbl}>Budget control</p>
                {addingToExisting ? (
                  <div className="bg-canvas rounded-control px-3 py-2 text-xs font-bold text-ink-900">Ad-set budget (ABO)</div>
                ) : (
                  <select className={`${inp} w-full`} value={budgetLevel} onChange={e => setBudgetLevel(e.target.value as "adset" | "campaign")}>
                    <option value="adset">Ad-set budget (ABO)</option>
                    <option value="campaign">Campaign budget — Advantage (CBO)</option>
                  </select>
                )}
              </div>
              <div className={field}>
                <p className={lbl}>Budget type</p>
                <select className={`${inp} w-full`} value={budgetType} onChange={e => setBudgetType(e.target.value as "daily" | "lifetime")}>
                  <option value="daily">Daily</option>
                  <option value="lifetime">Lifetime</option>
                </select>
              </div>
            </div>
            {!addingToExisting && <p className="text-[11px] text-slate-400 -mt-1">{budgetLevel === "campaign" ? "CBO: Meta splits one budget across ad sets automatically — best when you add multiple audiences." : "ABO: this ad set gets its own fixed budget — best for tight control."}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div className={field}>
                <p className={lbl}>{budgetType === "lifetime" ? "Total budget" : "Daily budget"} ({currency || "acct currency"})</p>
                <input className={`${inp} w-full`} type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)} />
              </div>
              {budgetType === "lifetime" && (
                <div className={field}>
                  <p className={lbl}>Run until</p>
                  <input className={`${inp} w-full`} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              )}
            </div>
          </>}
          <div className={field}>
            <p className={lbl}>Bidding</p>
            <select className={`${inp} w-full`} value={bidStrategy} onChange={e => setBidStrategy(e.target.value as typeof bidStrategy)}>
              {BID_STRATEGIES.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <p className="text-[11px] text-slate-400">{BID_STRATEGIES.find(b => b.key === bidStrategy)?.hint}</p>
            {bidNeedsAmount && (
              <input className={`${inp} w-40 mt-1`} type="number" min="1" placeholder={`${sym}target per result`} value={bidAmount} onChange={e => setBidAmount(e.target.value)} />
            )}
          </div>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — schedule &amp; special ad categories</summary>
            <div className="pt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className={field}><p className={lbl}>Start date <span className="font-normal text-slate-400">(optional)</span></p><input className={`${inp} w-full`} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                {budgetType !== "lifetime" && <div className={field}><p className={lbl}>End date <span className="font-normal text-slate-400">(optional)</span></p><input className={`${inp} w-full`} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>}
              </div>
              <div className={field}>
                <p className={lbl}>Special ad categories <span className="font-normal text-slate-400">(declare if applicable — avoids rejection)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {SPECIAL_CATS.map(([k, l]) => (
                    <button key={k} onClick={() => setSpecialCats(c => c.includes(k) ? c.filter(x => x !== k) : [...c, k])} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${specialCats.includes(k) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </>}

        {step === 3 && <>
          <div className={field}>
            <p className={lbl}>Locations <span className="font-normal text-slate-400">(search a place — pick a country, or any area to target a radius around it)</span></p>
            <LocationPicker locations={locations} setLocations={setLocations} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className={field}>
              <p className={lbl}>Age range</p>
              <div className="flex items-center gap-2 text-sm">
                <input className={`${inp} w-16`} type="number" min={18} max={65} value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} />
                <span className="text-slate-400">to</span>
                <input className={`${inp} w-16`} type="number" min={18} max={65} value={ageMax} onChange={e => setAgeMax(Number(e.target.value))} />
              </div>
            </div>
            <div className={field}>
              <p className={lbl}>Gender</p>
              <select className={`${inp} w-full`} value={gender} onChange={e => setGender(e.target.value as "all" | "men" | "women")}>
                <option value="all">All</option>
                <option value="men">Men</option>
                <option value="women">Women</option>
              </select>
            </div>
          </div>
          <div className={field}>
            <p className={lbl}>Interests <span className="font-normal text-slate-400">(optional)</span></p>
            <TargetPicker kind="interest" picked={interests} onPick={x => setInterests(g => g.some(y => y.key === x.key) ? g : [...g, x])} onRemove={k => setInterests(g => g.filter(x => x.key !== k))} placeholder="Search interests — e.g. data science, MBA…" />
          </div>
          <label className="flex items-start gap-2 text-[11px] text-ink-700 cursor-pointer bg-canvas rounded-control p-2.5">
            <input type="checkbox" className="accent-brand-700 mt-0.5" checked={advantage} onChange={e => setAdvantage(e.target.checked)} />
            <span><b>Advantage+ audience</b> — let Meta find more people beyond your selections when it improves results. Recommended; your locations/age act as a guide. (Off automatically if you include a custom audience below.)</span>
          </label>

          <div className={field}>
            <p className={lbl}>Placements <span className="font-normal text-slate-400">(where your ad shows)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setPlacements("advantage")} className={`text-left rounded-control border p-2.5 ${placements === "advantage" ? "border-brand-500 bg-brand-50" : "border-line"}`}><p className="text-xs font-bold text-ink-900">Advantage+ (auto)</p><p className="text-[10px] text-slate-500">Meta picks best spots (recommended)</p></button>
              <button onClick={() => setPlacements("manual")} className={`text-left rounded-control border p-2.5 ${placements === "manual" ? "border-brand-500 bg-brand-50" : "border-line"}`}><p className="text-xs font-bold text-ink-900">Manual</p><p className="text-[10px] text-slate-500">Pick platforms &amp; positions yourself</p></button>
            </div>
            {placements === "manual" && (
              <div className="mt-1.5 space-y-2.5">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Platforms</p>
                  <div className="flex flex-wrap gap-1.5">
                    {AD_PLATFORMS.map(([k, l]) => (
                      <button key={k} onClick={() => togglePlatform(k)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${platforms.includes(k) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{l}</button>
                    ))}
                  </div>
                </div>
                {/* Per-platform positions — Feed / Stories / Reels / … */}
                {AD_PLATFORMS.filter(([k]) => platforms.includes(k)).map(([k, l]) => (
                  <div key={k} className="rounded-control border border-line p-2">
                    <p className="text-[10px] font-bold text-ink-700 mb-1">{l} placements</p>
                    <div className="flex flex-wrap gap-1.5">
                      {PLATFORM_POSITIONS[k].map(([val, label]) => {
                        const on = (positions[k] ?? allPositions(k)).includes(val);
                        return <button key={val} onClick={() => togglePosition(k, val)} className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-400"}`}>{label}</button>;
                      })}
                    </div>
                  </div>
                ))}
                {platforms.length === 0 && <p className="text-[11px] text-amber-600">Pick at least one platform.</p>}
              </div>
            )}
          </div>

          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — custom audiences &amp; languages</summary>
            <div className="pt-2 space-y-3">
              {customAudiences.length > 0 && <>
                <div className={field}>
                  <p className={lbl}>Retarget — include people in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {customAudiences.map(a => (
                      <button key={a.id} onClick={() => { setIncludeAuds(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id]); setExcludeAuds(s => s.filter(x => x !== a.id)); }} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${includeAuds.includes(a.id) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{a.name}</button>
                    ))}
                  </div>
                </div>
                <div className={field}>
                  <p className={lbl}>Suppress — exclude people in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {customAudiences.map(a => (
                      <button key={a.id} onClick={() => { setExcludeAuds(s => s.includes(a.id) ? s.filter(x => x !== a.id) : [...s, a.id]); setIncludeAuds(s => s.filter(x => x !== a.id)); }} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${excludeAuds.includes(a.id) ? "border-red-300 bg-red-50 text-red-600" : "border-line text-slate-500"}`}>{a.name}</button>
                    ))}
                  </div>
                </div>
              </>}
              <div className={field}>
                <p className={lbl}>Languages <span className="font-normal text-slate-400">(optional — empty = all)</span></p>
                <TargetPicker kind="locale" picked={languages} onPick={x => setLanguages(g => g.some(y => y.key === x.key) ? g : [...g, x])} onRemove={k => setLanguages(g => g.filter(x => x.key !== k))} placeholder="Search languages — e.g. English, Hindi…" />
              </div>
            </div>
          </details>
        </>}

        {step === 4 && <>
          <div className={field}>
            <p className={lbl}>Format</p>
            <div className="grid grid-cols-3 gap-2">
              {([["single", "Single image", ImageIcon], ["video", "Video", Video], ["carousel", "Carousel", GalleryHorizontalEnd]] as const).map(([k, l, Ic]) => (
                <button key={k} onClick={() => setCreativeFormat(k)} className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-control border text-[11px] font-bold ${creativeFormat === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500 hover:border-slate-300"}`}>
                  <Ic className="w-4 h-4" /> {l}
                </button>
              ))}
            </div>
          </div>

          {creativeFormat === "single" && (
            <div className={field}>
              <p className={lbl}>Image <span className="font-normal text-slate-400">(recommended — 1080×1080)</span></p>
              <label className={`flex items-center gap-2 px-3 py-2.5 rounded-control border border-dashed border-slate-300 text-sm cursor-pointer hover:border-brand-500 ${uploading ? "opacity-60" : ""}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {imageHash ? `✓ ${imageName} — click to replace` : "Upload ad image"}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
          )}

          {creativeFormat === "video" && (
            <div className={field}>
              <p className={lbl}>Video <span className="font-normal text-slate-400">(MP4/MOV · square or vertical works best)</span></p>
              <label className={`flex items-center gap-2 px-3 py-2.5 rounded-control border border-dashed border-slate-300 text-sm cursor-pointer hover:border-brand-500 ${uploading ? "opacity-60" : ""}`}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                {videoId ? `✓ ${videoName} — click to replace` : "Upload video"}
                <input type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadVideo(f); e.currentTarget.value = ""; }} />
              </label>
              <p className="text-[11px] text-slate-400">Meta processes the video after upload — it may take a minute before it can go live. A thumbnail is auto-generated.</p>
            </div>
          )}

          {creativeFormat === "carousel" && (
            <div className={field}>
              <p className={lbl}>Cards <span className="font-normal text-slate-400">(2–10 · each a swipeable image + headline)</span></p>
              <div className="space-y-2">
                {cards.map((c, i) => (
                  <div key={i} className="rounded-control border border-line p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-500">Card {i + 1}</span>
                      {cards.length > 2 && <button onClick={() => setCards(cs => cs.filter((_, x) => x !== i))} className="text-[11px] font-bold text-red-500 hover:text-red-600">Remove</button>}
                    </div>
                    <div className="flex gap-2">
                      <label className={`shrink-0 w-16 h-16 rounded-control border border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:border-brand-500 overflow-hidden ${cardUploading === i ? "opacity-60" : ""}`}>
                        {cardUploading === i ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                          // eslint-disable-next-line @next/next/no-img-element
                          : c.imagePreview ? <img src={c.imagePreview} alt="" className="w-full h-full object-cover" />
                          : <UploadCloud className="w-4 h-4 text-slate-400" />}
                        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadCardImage(i, f); e.currentTarget.value = ""; }} />
                      </label>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <input className={`${inp} w-full`} placeholder={`Card ${i + 1} headline`} value={c.headline} onChange={e => setCards(cs => cs.map((x, y) => y === i ? { ...x, headline: e.target.value } : x))} />
                        <input className={`${inp} w-full`} placeholder="Description (optional)" value={c.description} onChange={e => setCards(cs => cs.map((x, y) => y === i ? { ...x, description: e.target.value } : x))} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {cards.length < 10 && (
                <button onClick={() => setCards(cs => [...cs, { imageHash: null, imageName: "", imagePreview: null, headline: "", description: "" }])} className="text-[11px] font-bold text-brand-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add card</button>
              )}
            </div>
          )}
          <div className={field}>
            <p className={lbl}>Primary text — the message above the image</p>
            <textarea className={`${inp} w-full resize-none`} rows={3} placeholder={"e.g. Confused which Data Science course fits your career? Chat with our counsellor on WhatsApp — free guidance, instant replies."} value={primaryText} onChange={e => setPrimaryText(e.target.value)} />
          </div>
          <div className={field}>
            <p className={lbl}>Headline — bold line next to the button</p>
            <input className={`${inp} w-full`} placeholder="e.g. Talk to a course counsellor" value={headline} onChange={e => setHeadline(e.target.value)} />
          </div>
          <p className="text-[11px] text-slate-400">
            {destination === "WHATSAPP" ? <>Button is <b>“Send WhatsApp message”</b> → opens a chat with your number; the lead lands in Live Chat stamped with this ad.</>
            : destination === "MESSENGER" ? <>Button is <b>“Send message”</b> → opens a Messenger chat.</>
            : destination === "INSTANT_FORM" ? <>Button is <b>“Sign up”</b> → opens your lead form inside the ad.</>
            : <>Button is <b>“{WEB_CTAS.find(c => c[0] === ctaType)?.[1]}”</b> → sends people to your website.</>}
          </p>
          <details className="rounded-control border border-line px-3 py-2">
            <summary className="text-xs font-bold text-slate-500 cursor-pointer select-none">Advanced — description &amp; tracking</summary>
            <div className="pt-2 space-y-2">
              <div className={field}>
                <p className={lbl}>Description <span className="font-normal text-slate-400">(small text under the headline)</span></p>
                <input className={`${inp} w-full`} placeholder="e.g. Free 90-min session · limited seats" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className={field}>
                <p className={lbl}>URL tracking parameters <span className="font-normal text-slate-400">(UTM — for your analytics)</span></p>
                <input className={`${inp} w-full font-mono text-xs`} placeholder="utm_source=meta&utm_medium=paid&utm_campaign=ds_june" value={urlTags} onChange={e => setUrlTags(e.target.value)} />
              </div>
            </div>
          </details>

          {/* ── More creatives — each becomes its own ad in this ONE ad set ── */}
          <div className="rounded-control border border-line p-3 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={lbl}>More creatives <span className="font-normal text-slate-400">(optional — creative test)</span></p>
                <p className="text-[11px] text-slate-400">Each extra creative launches as its own ad in this ad set. Meta rotates them and shifts spend to the best performer.</p>
              </div>
              <span className="shrink-0 text-[11px] font-bold text-brand-700 bg-brand-50 rounded-full px-2 py-0.5">{extraCreatives.length + 1} ad{extraCreatives.length ? "s" : ""}</span>
            </div>
            {extraCreatives.map((ec, i) => (
              <div key={i} className="rounded-control border border-line bg-canvas p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-500">Creative {i + 2}</span>
                  <button onClick={() => setExtraCreatives(cs => cs.filter((_, x) => x !== i))} className="text-[11px] font-bold text-red-500 hover:text-red-600">Remove</button>
                </div>
                <div className="flex gap-2">
                  {([["single", "Image", ImageIcon], ["video", "Video", Video]] as const).map(([k, l, Ic]) => (
                    <button key={k} onClick={() => setExtra(i, { format: k })} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-control border text-[11px] font-bold ${ec.format === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500 hover:border-slate-300"}`}><Ic className="w-3.5 h-3.5" /> {l}</button>
                  ))}
                </div>
                <label className={`flex items-center gap-2 px-3 py-2 rounded-control border border-dashed border-slate-300 text-xs cursor-pointer hover:border-brand-500 ${ec.uploading ? "opacity-60" : ""}`}>
                  {ec.uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                  {ec.format === "single" ? (ec.imageHash ? `✓ ${ec.imageName} — click to replace` : "Upload image") : (ec.videoId ? `✓ ${ec.videoName} — click to replace` : "Upload video")}
                  <input type="file" accept={ec.format === "single" ? "image/*" : "video/*"} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadExtraMedia(i, f, ec.format === "single" ? "image" : "video"); e.currentTarget.value = ""; }} />
                </label>
                <textarea className={`${inp} w-full resize-none`} rows={2} placeholder="Primary text — the message above the media" value={ec.primaryText} onChange={e => setExtra(i, { primaryText: e.target.value })} />
                <input className={`${inp} w-full`} placeholder="Headline — bold line next to the button" value={ec.headline} onChange={e => setExtra(i, { headline: e.target.value })} />
              </div>
            ))}
            <button onClick={() => setExtraCreatives(cs => [...cs, { format: "single", imageHash: null, imageName: "", imagePreview: null, videoId: null, videoName: "", videoPreview: null, primaryText: "", headline: "", description: "", uploading: false }])} className="text-[11px] font-bold text-brand-700 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add another creative</button>
          </div>
        </>}

        {step === 5 && <>
          <div className="bg-canvas rounded-control p-3 space-y-1 text-xs">
            <p><b className="text-ink-900">{name}</b> · {CONVERSION_LOCATIONS.find(c => c.key === destination)?.label}{destination === "WEBSITE" && pixelId ? ` (${PIXEL_EVENTS.find(e => e[0] === conversionEvent)?.[1]})` : ""}{specialCats.length ? ` · ${specialCats.length} special category` : ""}</p>
            <p className="text-slate-500">🎯 {OBJECTIVES.find(o => o.key === objective)?.label} · {budgetLevel === "campaign" ? "CBO" : "ABO"} · {sym}{budget} {budgetType === "lifetime" ? `total until ${endDate || "—"}` : "/day"} · {BID_STRATEGIES.find(b => b.key === bidStrategy)?.label}</p>
            <p className="text-slate-500">📍 {locations.map(l => l.kind === "radius" ? `${l.name} (${l.radius ?? 10}km)` : l.name).join(", ") || "—"} · age {ageMin}–{ageMax} · {gender}{interests.length ? ` · ${interests.map(i => i.name).join(", ")}` : ""}{languages.length ? ` · ${languages.map(l => l.name).join(", ")}` : ""}{includeAuds.length ? ` · +${includeAuds.length} audience` : ""}{excludeAuds.length ? ` · −${excludeAuds.length} excluded` : ""}{advantage && !includeAuds.length ? " · Advantage+" : ""} · {placements === "manual" ? platforms.join(", ") : "auto placements"}</p>
            <p className="text-slate-500">🖼 {creativeFormat === "video" ? (videoId ? `Video · ${videoName}` : "no video") : creativeFormat === "carousel" ? `Carousel · ${cards.filter(c => c.imageHash).length}/${cards.length} cards ready` : (imageHash ? imageName : "no image")} · “{headline}”{description ? ` · ${description}` : ""}</p>
            {extraCreatives.length > 0 && <p className="text-slate-500">🧪 {extraCreatives.length + 1} creatives → {extraCreatives.length + 1} ads in one ad set (Meta rotates + optimises)</p>}
            <p className="text-slate-500 line-clamp-2">{primaryText}</p>
          </div>

          {destination === "WHATSAPP" && (
            <div className="rounded-control border border-line p-3 space-y-2">
              <p className={lbl}>🤖 Auto-start a chatbot flow <span className="font-normal text-slate-400">(optional)</span></p>
              <p className="text-[11px] text-slate-500">When a lead messages from this ad, run a flow automatically — no keyword needed. Off-script replies still fall through to the AI.</p>
              <select className={`${inp} w-full`} value={flowId} onChange={e => setFlowId(e.target.value)}>
                <option value="">No flow — AI / keyword handles it</option>
                {flows.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              {flows.length === 0 && <p className="text-[11px] text-slate-400">No active flows yet — build one in Chatbot Flows, then come back.</p>}
              {flowId && (
                <div className="flex gap-2">
                  {([["campaign", "Whole campaign"], ["ad", "Just this ad"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setFlowScope(k)} className={`flex-1 px-2.5 py-1.5 rounded-control border text-[11px] font-bold ${flowScope === k ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-slate-500"}`}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex items-start gap-2 text-xs text-ink-700 cursor-pointer">
            <input type="checkbox" className="accent-brand-700 mt-0.5" checked={activate} onChange={e => setActivate(e.target.checked)} />
            <span><b>Launch live immediately.</b> Unchecked (recommended): created <b>PAUSED</b> so you can preview first, then Resume.</span>
          </label>
        </>}

        {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{err}</p>}

        <div className="flex items-center justify-between pt-1">
          <button onClick={() => step > 1 ? setStep(step - 1) : onClose()} className="px-3 py-2 text-xs font-bold text-ink-600 hover:text-ink-900">{step > 1 ? "← Back" : "Cancel"}</button>
          {step < TOTAL
            ? <button disabled={!canNext} onClick={() => setStep(step + 1)} className="px-4 py-2 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50">Continue →</button>
            : <button disabled={creating || !hasPage} onClick={create} className="px-4 py-2 rounded-control bg-brand-700 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} {activate ? "Create & go live" : "Create (paused)"}
              </button>}
        </div>
      </>)}
    </div>

    {/* ── Live preview pane ── */}
    {!done && <aside className="hidden lg:block w-[380px] shrink-0 sticky top-2 space-y-3">
      {step === 3
        ? <AudienceDefinition estimate={estimate} loading={estimateLoading} err={estimateErr}
            locations={locations} ageMin={ageMin} ageMax={ageMax} gender={gender} interests={interests} languages={languages}
            includeAuds={includeAuds} excludeAuds={excludeAuds} advantage={advantage} />
        : <>
            {previews.length > 1 && (
              <div className="flex gap-1 flex-wrap">
                {previews.map((_, i) => (
                  <button key={i} onClick={() => setPreviewIdx(i)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${pIdx === i ? "bg-ink-950 text-white" : "bg-canvas text-slate-500 hover:text-ink-700"}`}>Creative {i + 1}</button>
                ))}
              </div>
            )}
            <AdMockPreview placement={placement} setPlacement={setPlacement}
              format={pv.format} imageUrl={pv.imageUrl} videoUrl={pv.videoUrl}
              cards={pv.cards}
              primaryText={pv.primaryText} headline={pv.headline} description={pv.description} ctaLabel={ctaLabel}
              realPreviews={pv.real} previewLoading={pIdx === 0 && previewLoading} previewErr={pIdx === 0 ? previewErr : null} mediaReady={pv.mediaReady} />
          </>}
      <div className="bg-white rounded-card border border-line p-4 space-y-1.5">
        <p className="text-[11px] font-bold text-slate-400 uppercase">What Meta will do</p>
        <p className="text-xs text-ink-700"><b>Goal:</b> {perfGoal}</p>
        <p className="text-xs text-ink-700"><b>Sends to:</b> {CONVERSION_LOCATIONS.find(c => c.key === destination)?.label}{destination === "WEBSITE" && websiteUrl ? ` · ${websiteUrl}` : ""}</p>
        <p className="text-xs text-ink-700"><b>Budget:</b> {sym}{budget || "0"} {budgetType === "lifetime" ? "total" : "/day"} · {budgetLevel === "campaign" ? "CBO" : "ABO"}</p>
        <p className="text-xs text-ink-700"><b>Audience:</b> {locations.map(l => l.name).join(", ") || "—"} · {ageMin}–{ageMax} · {gender}{advantage && !includeAuds.length ? " · Advantage+" : ""}</p>
        <p className="text-[11px] text-slate-400 pt-1">Preview is an approximation — real rendering varies slightly by placement and device.</p>
      </div>
    </aside>}
    </div>
  );
}

// ── Audience definition — Meta's narrow↔broad gauge + live size estimate ──────
function AudienceDefinition({ estimate, loading, err, locations, ageMin, ageMax, gender, interests, languages, includeAuds, excludeAuds, advantage }: {
  estimate: { lower?: number; upper?: number } | null; loading?: boolean; err?: string | null;
  locations: LocationItem[]; ageMin: number; ageMax: number; gender: string; interests: TargetItem[]; languages: TargetItem[];
  includeAuds: string[]; excludeAuds: string[]; advantage: boolean;
}) {
  const fmt = (n?: number) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
  // Broadness drives the gauge. Prefer the real estimate (audience size on a log
  // scale: ~30k → narrow, ~30M → broad); fall back to a constraint heuristic.
  const mid = estimate && (estimate.lower != null || estimate.upper != null)
    ? ((estimate.lower ?? estimate.upper ?? 0) + (estimate.upper ?? estimate.lower ?? 0)) / 2
    : null;
  const heuristicNarrow = Math.min(1, (interests.length ? 0.3 : 0) + (gender !== "all" ? 0.15 : 0) + (locations.some(l => l.kind === "radius") ? 0.25 : 0) + (ageMax - ageMin < 20 ? 0.15 : 0) + (includeAuds.length ? 0.3 : 0) + (languages.length ? 0.1 : 0));
  const broadness = mid && mid > 0
    ? Math.min(1, Math.max(0, (Math.log10(mid) - 4.3) / 3.2))   // 10^4.3≈20k narrow … 10^7.5≈32M broad
    : 1 - heuristicNarrow;
  const tier = broadness > 0.62 ? "broad" : broadness < 0.3 ? "specific" : "defined";
  const pos = `${Math.round(broadness * 100)}%`;
  return (
    <div className="bg-white rounded-card border border-line p-4 space-y-3">
      <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5">Audience definition {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}</p>
      <p className="text-xs text-ink-700">Your audience is <b>{tier}</b>.</p>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {tier === "broad" ? "Broad audiences let Meta find the people most likely to respond — usually a lower cost per result for cold prospecting."
          : tier === "specific" ? "A tight audience can raise cost per result and slow learning. Widen the radius / age, or remove some filters if delivery stalls."
          : "A balanced audience — enough signal for Meta to optimise without over-restricting reach."}
      </p>
      {/* gauge */}
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-rose-200 via-amber-200 to-emerald-500">
        <div className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-ink-900 -translate-x-1/2" style={{ left: pos }} />
      </div>
      <div className="flex justify-between text-[10px] font-semibold text-slate-400"><span>Narrow</span><span>Broad</span></div>

      <div className="border-t border-line pt-2.5">
        {err
          ? <p className="text-[11px] text-amber-600">{err}</p>
          : <p className="text-xs text-ink-800"><b>Estimated audience size:</b> {loading && !estimate ? "calculating…" : estimate ? `${fmt(estimate.lower)} – ${fmt(estimate.upper)}` : "—"}</p>}
        <p className="text-[10px] text-slate-400 pt-1">Estimates don&apos;t include Advantage+ expansion{advantage ? " (on)" : ""} and vary over time.</p>
      </div>

      <div className="border-t border-line pt-2.5 space-y-0.5 text-[11px] text-slate-500">
        <p>📍 {locations.filter(l => l.kind === "country").map(l => l.name).join(", ") || "—"}</p>
        {locations.some(l => l.kind === "radius") && <p>🧭 {locations.filter(l => l.kind === "radius").map(l => `${l.name} (${l.radius ?? 10}km)`).join(", ")}</p>}
        <p>👤 Age {ageMin}–{ageMax} · {gender}{languages.length ? ` · ${languages.map(l => l.name).join(", ")}` : ""}</p>
        {interests.length > 0 && <p>🎯 {interests.map(i => i.name).join(", ")}</p>}
        {includeAuds.length > 0 && <p>➕ {includeAuds.length} custom audience{includeAuds.length > 1 ? "s" : ""}</p>}
        {excludeAuds.length > 0 && <p>➖ {excludeAuds.length} excluded</p>}
      </div>
    </div>
  );
}

// Live ad mock — renders the creative as it appears in Facebook/Instagram feed
// and Instagram story, from the wizard inputs (no API round-trip).
function AdMockPreview({ placement, setPlacement, format = "single", imageUrl, videoUrl, cards = [], primaryText, headline, description, ctaLabel, realPreviews, previewLoading, previewErr, mediaReady }: {
  placement: string; setPlacement: (p: string) => void;
  format?: "single" | "video" | "carousel"; imageUrl: string | null; videoUrl?: string | null;
  cards?: { imageUrl: string | null; headline: string; description: string }[];
  primaryText: string; headline: string; description: string; ctaLabel: string;
  realPreviews?: { key: string; label: string; html: string }[] | null; previewLoading?: boolean; previewErr?: string | null; mediaReady?: boolean;
}) {
  // ── Real Meta render: when generatepreviews returned iframes, show the exact
  // placement render Facebook/Instagram use, scaled to fit the pane. ──────────
  if (realPreviews?.length) {
    const active = realPreviews.find(p => p.key === placement) ?? realPreviews[0];
    const m = active.html.match(/width=["']?(\d+)["']?[\s\S]*?height=["']?(\d+)["']?/i);
    const w = m ? Number(m[1]) : 360;
    const h = m ? Number(m[2]) : 620;
    // Fit within the pane both ways so tall (Reels/Story) renders aren't clipped.
    const scale = Math.min(1, 348 / w, 600 / h);
    return (
      <div className="bg-white rounded-card border border-line p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold text-brand-700 uppercase flex items-center gap-1">{previewLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleCheck className="w-3 h-3" />} Live from Meta</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {realPreviews.map(p => <button key={p.key} onClick={() => setPlacement(p.key)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${placement === p.key ? "bg-ink-950 text-white" : "bg-canvas text-slate-500"}`}>{p.label}</button>)}
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-canvas mx-auto" style={{ width: Math.ceil(w * scale), height: Math.ceil(h * scale) }}>
          <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left" }} dangerouslySetInnerHTML={{ __html: active.html }} />
        </div>
        <p className="text-[11px] text-slate-400">Rendered by Meta — exactly how it appears in {active.label}.</p>
      </div>
    );
  }
  // Otherwise: instant hand-drawn mock (renders live as you type, before media uploads).
  // A freshly-uploaded video is a blob: URL (playable); a reopened draft only has
  // Meta's thumbnail (an http image), so render that as an image instead.
  const videoIsBlob = !!videoUrl && videoUrl.startsWith("blob:");
  // The media block shown inside feed previews — image, video, or carousel strip.
  const media = format === "video"
    ? (videoUrl
        ? (videoIsBlob
            ? <video src={videoUrl} className="w-full aspect-square object-cover bg-black" autoPlay muted loop playsInline />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={videoUrl} alt="" className="w-full aspect-square object-cover bg-black" />)
        : <div className="w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-xs">Your video appears here</div>)
    : format === "carousel"
    ? <div className="flex gap-1.5 overflow-x-auto p-1.5 bg-canvas snap-x">
        {cards.map((c, i) => (
          <div key={i} className="shrink-0 w-[120px] snap-start rounded-md border border-line overflow-hidden bg-white">
            {c.imageUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.imageUrl} alt="" className="w-full aspect-square object-cover" />
              : <div className="w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-[10px]">Card {i + 1}</div>}
            <div className="px-1.5 py-1"><p className="text-[10px] font-bold text-ink-900 truncate">{c.headline || `Card ${i + 1}`}</p>{c.description && <p className="text-[9px] text-slate-400 truncate">{c.description}</p>}</div>
          </div>
        ))}
      </div>
    : (imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageUrl} alt="" className="w-full object-cover" />
        : <div className="w-full aspect-square bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-400 text-xs">Your image appears here</div>);
  const img = media;
  const storyMedia = format === "video" && videoUrl;
  const tabs: [typeof placement, string][] = [["fb_feed", "Facebook"], ["ig_feed", "Instagram"], ["ig_story", "Story"], ["ig_reels", "Reels"]];
  const vBg = format === "carousel" ? cards[0]?.imageUrl : imageUrl;
  return (
    <div className="bg-white rounded-card border border-line p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-slate-400 uppercase flex items-center gap-1">{previewLoading && <Loader2 className="w-3 h-3 animate-spin" />} Preview</p>
        <div className="flex gap-1">
          {tabs.map(([k, l]) => <button key={k} onClick={() => setPlacement(k)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${placement === k ? "bg-ink-950 text-white" : "bg-canvas text-slate-500"}`}>{l}</button>)}
        </div>
      </div>
      {!mediaReady
        ? <p className="text-[11px] text-slate-400">{format === "video" ? "Upload a video" : format === "carousel" ? "Add 2+ card images" : "Upload an image"} to see the exact Meta render. Showing a quick mock for now.</p>
        : previewErr
        ? <p className="text-[11px] text-amber-600">Meta render unavailable ({previewErr}). Showing a quick mock.</p>
        : previewLoading
        ? <p className="text-[11px] text-slate-400">Rendering the real Meta preview…</p>
        : null}

      {placement === "ig_reels" ? (
        /* ── Instagram Reels ── */
        <div className="relative mx-auto w-[210px] h-[373px] rounded-xl overflow-hidden bg-ink-950">
          {storyMedia
            ? (videoIsBlob
              ? <video src={videoUrl!} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop playsInline />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={videoUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />)
            : vBg
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={vBg as string} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 bg-gradient-to-br from-brand-500 to-brand-900 flex items-center justify-center"><span className="text-[10px] text-white/60">Your reel appears here</span></div>}
          {/* top label */}
          <div className="absolute top-2 left-2.5 text-[11px] font-bold text-white drop-shadow">Reels</div>
          {/* right action rail */}
          <div className="absolute right-2 bottom-20 flex flex-col items-center gap-3.5 text-white">
            <Heart className="w-5 h-5 drop-shadow" /><MessageCircle className="w-5 h-5 drop-shadow" /><Send className="w-5 h-5 drop-shadow" /><MoreHorizontal className="w-5 h-5 drop-shadow" />
          </div>
          {/* bottom info + CTA */}
          <div className="absolute inset-x-0 bottom-0 pt-10 pb-2.5 px-2.5 pr-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[1.5px]"><div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-brand-700" /></div>
              <span className="text-[10px] font-bold text-white drop-shadow truncate">yourpage</span><span className="text-[9px] text-white/70 shrink-0">· Sponsored</span>
            </div>
            {primaryText && <p className="text-[10px] text-white/90 drop-shadow line-clamp-2">{primaryText}</p>}
            <div className="bg-white rounded-md flex items-center justify-between gap-1 text-[11px] font-bold text-ink-900 px-2.5 py-1.5"><span className="truncate">{ctaLabel}</span><ChevronRight className="w-3.5 h-3.5 shrink-0 text-ink-500" /></div>
          </div>
        </div>
      ) : placement === "ig_story" ? (
        /* ── Instagram Story ── */
        <div className="relative mx-auto w-[210px] h-[373px] rounded-xl overflow-hidden bg-ink-950">
          {storyMedia
            ? (videoIsBlob
              ? <video src={videoUrl!} className="absolute inset-0 w-full h-full object-cover" autoPlay muted loop playsInline />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={videoUrl!} alt="" className="absolute inset-0 w-full h-full object-cover" />)
            : (format === "carousel" ? cards[0]?.imageUrl : imageUrl)
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={(format === "carousel" ? cards[0]?.imageUrl : imageUrl) as string} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 bg-gradient-to-br from-brand-500 to-brand-900" />}
          <div className="absolute top-1.5 left-2 right-2 h-0.5 rounded-full bg-white/40"><div className="h-full w-1/3 rounded-full bg-white" /></div>
          <div className="absolute top-3.5 left-2 right-2 flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[1.5px]"><div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-brand-700" /></div>
            <span className="text-[10px] font-bold text-white drop-shadow">yourpage</span><span className="text-[9px] text-white/70">Sponsored</span>
          </div>
          <div className="absolute inset-x-0 bottom-0 pt-10 pb-3 px-2.5 bg-gradient-to-t from-black/70 via-black/30 to-transparent space-y-2">
            {primaryText && <p className="text-[10px] text-white/90 drop-shadow line-clamp-2 text-center">{primaryText}</p>}
            <div className="bg-white rounded-full flex items-center justify-center gap-1 text-[11px] font-bold text-ink-900 py-2 px-3"><ChevronRight className="w-3 h-3 -rotate-90 shrink-0" /> <span className="truncate">{ctaLabel}</span></div>
          </div>
        </div>
      ) : placement === "ig_feed" ? (
        /* ── Instagram Feed ── */
        <div className="rounded-lg border border-line overflow-hidden bg-white">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600 p-[1.5px]"><div className="w-full h-full rounded-full bg-white p-[1.5px]"><div className="w-full h-full rounded-full bg-gradient-to-br from-brand-500 to-brand-700" /></div></div>
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-ink-900 leading-tight">yourpage</p><p className="text-[9px] text-slate-400">Sponsored</p></div>
            <MoreHorizontal className="w-4 h-4 text-ink-700" />
          </div>
          {img}
          <button className="w-full flex items-center justify-between bg-canvas px-2.5 py-2 border-y border-line"><span className="text-[11px] font-bold text-ink-900">{ctaLabel}</span><ChevronRight className="w-3.5 h-3.5 text-ink-500" /></button>
          <div className="flex items-center gap-3 px-2.5 pt-2">
            <Heart className="w-4 h-4 text-ink-800" /><MessageCircle className="w-4 h-4 text-ink-800" /><Send className="w-4 h-4 text-ink-800" /><Bookmark className="w-4 h-4 text-ink-800 ml-auto" />
          </div>
          <div className="px-2.5 py-1.5">
            <p className="text-[11px] text-ink-800 line-clamp-3"><b>yourpage</b> {primaryText || "Your caption appears here — the hook that makes people stop scrolling."}</p>
          </div>
        </div>
      ) : (
        /* ── Facebook Feed ── */
        <div className="rounded-lg border border-line overflow-hidden bg-white">
          <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700" />
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-ink-900 leading-tight">Your Page</p><p className="text-[9px] text-slate-400">Sponsored · 🌐</p></div>
            <MoreHorizontal className="w-4 h-4 text-ink-500" />
          </div>
          <p className="text-[11px] text-ink-800 px-2.5 pb-2 whitespace-pre-wrap line-clamp-4">{primaryText || "Your primary text appears here — the hook that makes people stop scrolling."}</p>
          {img}
          <div className="flex items-center justify-between gap-2 bg-canvas px-2.5 py-2">
            <div className="min-w-0"><p className="text-[9px] text-slate-400 uppercase truncate">{description || "your site"}</p><p className="text-xs font-bold text-ink-900 truncate">{headline || "Your headline"}</p></div>
            <button className="shrink-0 text-[11px] font-bold bg-slate-200 text-ink-900 rounded-md px-2.5 py-1.5">{ctaLabel}</button>
          </div>
          <div className="flex items-center justify-around px-2.5 py-1.5 border-t border-line text-slate-500">
            <span className="flex items-center gap-1 text-[10px] font-semibold"><ThumbsUp className="w-3.5 h-3.5" /> Like</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold"><MessageCircle className="w-3.5 h-3.5" /> Comment</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold"><Reply className="w-3.5 h-3.5 -scale-x-100" /> Share</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Dedicated ad detail view — full Meta analytics for one node + child cards ──
type NodeFull = {
  id: string; name: string; effectiveStatus: string; delivery?: Delivery; level: "campaign" | "adset" | "ad";
  objective: string | null; dailyBudget: number | null; thumbnailUrl: string | null;
  dateStart: string | null; dateStop: string | null;
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; uniqueClicks: number; linkClicks: number; ctr: number; cpc: number; cpm: number; cpp: number;
  conversations: number; costPerConversation: number | null;
  actions: { type: string; value: number }[]; costPerAction: { type: string; value: number }[];
};
type ChildRow = { id: string; name: string; effectiveStatus: string; delivery?: Delivery; thumbnailUrl?: string | null; dailyBudget?: number | null; optimizationGoal?: string; spend: number; clicks: number; ctr: number; conversations: number };

const ACTION_LABELS_META: Record<string, string> = {
  link_click: "Link clicks", landing_page_view: "Landing page views", post_engagement: "Post engagement",
  page_engagement: "Page engagement", post_reaction: "Reactions", comment: "Comments", onsite_conversion_post_save: "Saves",
  video_view: "Video views", lead: "Leads", purchase: "Purchases", "onsite_conversion.messaging_conversation_started_7d": "WhatsApp conversations",
  messaging_conversation_started_7d: "WhatsApp conversations", "onsite_conversion.messaging_first_reply": "WhatsApp first replies",
};
function humanizeAction(t: string): string {
  return ACTION_LABELS_META[t] ?? t.replace(/^onsite_conversion\./, "").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());
}

function AdNodeDetail({ node, preset, currency, isAdmin, onBack, onOpen }: {
  node: { level: "campaign" | "adset" | "ad"; id: string; name: string };
  preset: "today" | "last_7d" | "last_30d"; currency: string; isAdmin: boolean;
  onBack: () => void; onOpen: (level: "campaign" | "adset" | "ad", id: string, name: string) => void;
}) {
  const [full, setFull] = useState<NodeFull | null>(null);
  const [adsets, setAdsets] = useState<ChildRow[]>([]);
  const [ads, setAds] = useState<ChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [budgetEdit, setBudgetEdit] = useState<{ id: string; value: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const money = (n: number) => `${currency === "INR" ? "₹" : currency ? currency + " " : ""}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/meta/node?id=${node.id}&level=${node.level}&preset=${preset}`).then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else { setFull(d.node); setAdsets(d.adsets ?? []); setAds(d.ads ?? []); } })
      .catch(() => setErr("Could not load — an ad blocker may be active."))
      .finally(() => setLoading(false));
  }, [node.id, node.level, preset]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (node.level === "ad") fetch(`/api/admin/meta/preview?adId=${node.id}`).then(r => r.json()).then(d => setPreview(d.html ?? null)).catch(() => {}); }, [node.id, node.level]);

  async function act(id: string, action: "pause" | "resume" | "budget" | "duplicate", dailyBudget?: number) {
    setBusy(id);
    try {
      const d = await fetch("/api/admin/meta/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: id, action, dailyBudget }) }).then(r => r.json());
      if (d.error) setErr(d.error); else load();
    } finally { setBusy(""); setBudgetEdit(null); }
  }

  const levelLabel = node.level === "campaign" ? "Campaign" : node.level === "adset" ? "Ad set" : "Ad";
  const childLevel: "adset" | "ad" = node.level === "campaign" ? "adset" : "ad";

  // The metric tiles — everything Meta reports, grouped reach → clicks → cost.
  const tiles: { label: string; value: string; hint?: string }[] = full ? [
    { label: "Amount spent", value: money(full.spend) },
    { label: "Impressions", value: full.impressions.toLocaleString() },
    { label: "Reach", value: full.reach.toLocaleString(), hint: "unique people" },
    { label: "Frequency", value: full.frequency ? full.frequency.toFixed(2) : "—", hint: "times each saw it" },
    { label: "Clicks (all)", value: full.clicks.toLocaleString() },
    { label: "Link clicks", value: full.linkClicks.toLocaleString() },
    { label: "Unique clicks", value: full.uniqueClicks.toLocaleString() },
    { label: "CTR", value: full.ctr ? `${full.ctr.toFixed(2)}%` : "—", hint: "click-through rate" },
    { label: "CPC", value: full.cpc ? money(full.cpc) : "—", hint: "per click" },
    { label: "CPM", value: full.cpm ? money(full.cpm) : "—", hint: "per 1,000 impressions" },
    { label: "WhatsApp chats", value: full.conversations.toLocaleString() },
    { label: "Cost / chat", value: full.costPerConversation != null ? money(full.costPerConversation) : (full.conversations ? money(full.spend / full.conversations) : "—") },
  ] : [];

  const childCard = (c: ChildRow, kind: "adset" | "ad") => {
    const cpr = c.conversations > 0 ? { l: "per chat", v: money(c.spend / c.conversations) } : c.clicks > 0 ? { l: "per click", v: money(c.spend / c.clicks) } : { l: "results", v: "—" };
    const wasteful = c.effectiveStatus === "ACTIVE" && c.spend > 100 && c.conversations === 0 && c.clicks === 0;
    return (
      <div key={c.id} className={`rounded-card border p-3 text-left transition-colors ${wasteful ? "border-amber-200 bg-amber-50/40" : "border-line bg-white hover:border-brand-400"}`}>
        <button onClick={() => onOpen(kind, c.id, c.name)} className="w-full text-left">
          <div className="flex items-center gap-2 mb-2">
            {kind === "ad" && (c.thumbnailUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={c.thumbnailUrl} alt="" className="w-7 h-7 rounded object-cover shrink-0" />
              : <div className="w-7 h-7 rounded bg-canvas shrink-0" />)}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-ink-900 truncate">{c.name}</p>
              {kind === "adset" && <p className="text-[10px] text-slate-400 truncate">{c.optimizationGoal}{c.dailyBudget != null ? ` · ${money(c.dailyBudget)}/day` : ""}</p>}
            </div>
            {wasteful && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full shrink-0">REVIEW</span>}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${deliveryPill(c.delivery).cls}`}>{deliveryPill(c.delivery).label}</span>
          </div>
          <div className="grid grid-cols-4 gap-1 text-center">
            {[["spend", money(c.spend)], ["clicks", c.clicks.toLocaleString()], ["chats", c.conversations.toLocaleString()], [cpr.l, cpr.v]].map(([l, v]) => (
              <div key={l} className="bg-canvas rounded-control py-1">
                <p className="text-xs font-bold text-ink-900">{v}</p>
                <p className="text-[9px] text-slate-400 font-semibold uppercase">{l}</p>
              </div>
            ))}
          </div>
        </button>
        {isAdmin && (
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-line text-[11px]">
            <button disabled={busy === c.id} onClick={() => act(c.id, c.effectiveStatus === "ACTIVE" ? "pause" : "resume")} className="font-bold text-ink-600 hover:text-brand-700">{c.effectiveStatus === "ACTIVE" ? "Pause" : "Resume"}</button>
            {kind === "adset" && c.dailyBudget != null && (budgetEdit?.id === c.id
              ? <span className="flex items-center gap-1"><input className="border border-line rounded-control px-1.5 py-0.5 w-16 bg-white" autoFocus value={budgetEdit.value} onChange={e => setBudgetEdit({ id: c.id, value: e.target.value })} onKeyDown={e => { if (e.key === "Enter" && Number(budgetEdit.value) > 0) act(c.id, "budget", Number(budgetEdit.value)); if (e.key === "Escape") setBudgetEdit(null); }} /><button onClick={() => Number(budgetEdit.value) > 0 && act(c.id, "budget", Number(budgetEdit.value))} className="font-bold text-brand-700">Save</button></span>
              : <button onClick={() => setBudgetEdit({ id: c.id, value: String(c.dailyBudget) })} className="font-bold text-brand-700 hover:underline">budget</button>)}
            <span className="text-slate-300">·</span>
            <button onClick={() => onOpen(kind, c.id, c.name)} className="font-bold text-brand-700 hover:underline">Open →</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-xs font-bold text-brand-700 flex items-center gap-1 hover:gap-1.5 transition-all"><ArrowLeft className="w-3.5 h-3.5" /> Back to campaigns</button>

      {err && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">{err}</div>}

      {loading && !full ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : full && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-slate-400 uppercase">{levelLabel}{full.objective ? ` · ${full.objective.toLowerCase().replace(/_/g, " ")}` : ""}</p>
              <h3 className="text-lg font-extrabold text-ink-900">{full.name}</h3>
              <p className="text-[11px] text-slate-400">{full.dateStart && full.dateStop ? `${full.dateStart} → ${full.dateStop}` : ""}{full.dailyBudget != null ? ` · ${money(full.dailyBudget)}/day` : ""}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${deliveryPill(full.delivery).cls}`}>{deliveryPill(full.delivery).label}</span>
              {isAdmin && <button disabled={busy === full.id} onClick={() => act(full.id, full.effectiveStatus === "ACTIVE" ? "pause" : "resume")} className="px-3 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas">{full.effectiveStatus === "ACTIVE" ? "Pause" : "Resume"}</button>}
              {isAdmin && node.level === "campaign" && <button disabled={busy === full.id} onClick={() => { if (confirm(`Duplicate "${full.name}"? The copy is created PAUSED.`)) act(full.id, "duplicate"); }} className="px-2 py-1 rounded-lg border border-line text-[11px] font-bold text-ink-600 hover:bg-canvas"><Copy className="w-3 h-3" /></button>}
            </div>
          </div>

          {/* Full metric grid */}
          <div className="grid grid-cols-4 gap-2">
            {tiles.map(t => (
              <div key={t.label} className="bg-white border border-line rounded-card p-3">
                <p className="text-base font-extrabold text-ink-900 truncate">{t.value}</p>
                <p className="text-[10px] text-slate-500 font-semibold">{t.label}</p>
                {t.hint && <p className="text-[9px] text-slate-400">{t.hint}</p>}
              </div>
            ))}
          </div>

          {/* All actions Meta tracked */}
          {full.actions.length > 0 && (
            <section className="bg-white rounded-card border border-line p-4">
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">All results Meta tracked</p>
              <div className="divide-y divide-line">
                <div className="grid grid-cols-[1fr_5rem_6rem] gap-2 py-1 text-[10px] font-bold text-slate-400 uppercase"><span>Action</span><span className="text-right">Count</span><span className="text-right">Cost each</span></div>
                {full.actions.map(a => {
                  const cost = full.costPerAction.find(c => c.type === a.type)?.value;
                  return (
                    <div key={a.type} className="grid grid-cols-[1fr_5rem_6rem] gap-2 py-1.5 text-sm">
                      <span className="text-ink-900 truncate">{humanizeAction(a.type)}</span>
                      <span className="text-right font-semibold">{a.value.toLocaleString()}</span>
                      <span className="text-right text-slate-500">{cost != null ? money(cost) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Ad preview (ad level) */}
          {node.level === "ad" && (
            <section className="bg-white rounded-card border border-line p-4">
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">Ad preview</p>
              {preview ? <div className="overflow-auto" dangerouslySetInnerHTML={{ __html: preview }} /> : <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
            </section>
          )}

          {/* Child cards */}
          {node.level !== "ad" && (
            <>
              {node.level === "campaign" && (
                <section className="space-y-2">
                  <p className="text-[11px] font-bold text-slate-400 uppercase">Ad sets ({adsets.length}) — click to drill in</p>
                  <div className="grid grid-cols-2 gap-2">{[...adsets].sort((a, b) => b.spend - a.spend).map(s => childCard(s, "adset"))}</div>
                  {adsets.length === 0 && <p className="text-[11px] text-slate-400">No ad sets.</p>}
                </section>
              )}
              <section className="space-y-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase">Ads ({ads.length}) — click to drill in</p>
                <div className="grid grid-cols-2 gap-2">{[...ads].sort((a, b) => b.spend - a.spend).map(a => childCard(a, "ad"))}</div>
                {ads.length === 0 && <p className="text-[11px] text-slate-400">No ads.</p>}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Automated rules — the budget guardian, checked by the cron every ~5 minutes.
type AdRuleRow = { id: string; name: string; active: boolean; scopeCampaignId: string | null; metric: string; op: string; threshold: number; windowPreset: string; action: string; lastTriggeredAt: string | null; lastResult: string | null };

const RULE_METRICS: [string, string][] = [
  ["spend", "Spend"], ["cpc", "Cost per click"], ["ctr", "CTR %"], ["clicks", "Clicks"],
  ["conversations", "WhatsApp chats started"], ["leads", "Leads (our data)"], ["cost_per_lead", "Cost per lead (our data)"],
];
const RULE_WINDOWS: [string, string][] = [["today", "today"], ["last_7d", "last 7 days"], ["last_30d", "last 30 days"]];

function AdRulesPanel({ campaigns, isAdmin, currency }: { campaigns: { id: string; name: string }[]; isAdmin: boolean; currency: string }) {
  const [rules, setRules] = useState<AdRuleRow[] | null>(null);
  const [form, setForm] = useState<{ name: string; scopeCampaignId: string; metric: string; op: string; threshold: string; windowPreset: string; action: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => { fetch("/api/admin/meta/rules").then(r => r.json()).then(d => setRules(d.rules ?? [])).catch(() => setRules([])); }, []);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form || !form.name.trim() || !form.threshold.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta/rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, scopeCampaignId: form.scopeCampaignId || null, metric: form.metric, op: form.op, threshold: Number(form.threshold), windowPreset: form.windowPreset, action: form.action }),
      }).then(r => r.json());
      if (d.error) setMsg(d.error); else { setForm(null); load(); }
    } finally { setBusy(false); }
  }

  async function toggle(r: AdRuleRow) {
    await fetch("/api/admin/meta/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...r, active: !r.active }) });
    load();
  }

  const metricLabel = (m: string) => RULE_METRICS.find(x => x[0] === m)?.[1] ?? m;
  const sentence = (r: AdRuleRow) =>
    `${r.action === "pause" ? "Pause" : "Alert"} ${r.scopeCampaignId ? (campaigns.find(c => c.id === r.scopeCampaignId)?.name ?? "one campaign") : "any campaign"} when ${metricLabel(r.metric).toLowerCase()} ${RULE_WINDOWS.find(w => w[0] === r.windowPreset)?.[1]} ${r.op === "gt" ? ">" : "<"} ${r.threshold}`;

  return (
    <section className="bg-white rounded-card border border-line p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase">Automated rules — your budget guardian</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Checked every few minutes. Unlike Meta&apos;s rules, these can watch <b>your real leads</b> — e.g. pause anything that spends {currency === "INR" ? "₹" : ""}1,000 with zero leads.</p>
        </div>
        {isAdmin && <button onClick={() => { setForm({ name: "", scopeCampaignId: "", metric: "cost_per_lead", op: "gt", threshold: "", windowPreset: "today", action: "pause" }); setMsg(null); }} className="px-3 py-1.5 rounded-lg bg-brand-700 text-white text-xs font-bold shrink-0"><Plus className="w-3.5 h-3.5 inline" /> Rule</button>}
      </div>

      {rules === null ? railLoading : rules.map(r => (
        <div key={r.id} className="flex items-center gap-2 border border-slate-100 rounded-control px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-ink-900">{r.name}</p>
            <p className="text-[11px] text-slate-500">{sentence(r)}</p>
            {r.lastResult && <p className="text-[10px] text-amber-700 truncate">Last: {r.lastResult}{r.lastTriggeredAt ? ` (${new Date(r.lastTriggeredAt).toLocaleString()})` : ""}</p>}
          </div>
          {isAdmin && <>
            <button onClick={() => toggle(r)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 ${r.active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>{r.active ? "● ON" : "○ OFF"}</button>
            <button onClick={async () => { if (confirm(`Delete rule "${r.name}"?`)) { await fetch("/api/admin/meta/rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id }) }); load(); } }} className="p-1 text-red-400 hover:text-red-600 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
          </>}
        </div>
      ))}
      {rules !== null && rules.length === 0 && !form && <p className="text-xs text-slate-400">No rules yet — try: <i>pause any campaign when cost per lead today &gt; 500</i>.</p>}

      {form && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <input className={`${inp} w-full`} placeholder="Rule name — e.g. CPL guard" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <select className={inp} value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
              <option value="pause">Pause the campaign</option>
              <option value="notify">Alert only (activity log)</option>
            </select>
            <select className={inp} value={form.scopeCampaignId} onChange={e => setForm({ ...form, scopeCampaignId: e.target.value })}>
              <option value="">…for any campaign</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>only: {c.name}</option>)}
            </select>
            <select className={inp} value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}>
              {RULE_METRICS.map(([k, l]) => <option key={k} value={k}>when {l}</option>)}
            </select>
            <select className={inp} value={form.windowPreset} onChange={e => setForm({ ...form, windowPreset: e.target.value })}>
              {RULE_WINDOWS.map(([k, l]) => <option key={k} value={k}>window: {l}</option>)}
            </select>
            <select className={inp} value={form.op} onChange={e => setForm({ ...form, op: e.target.value })}>
              <option value="gt">is greater than</option>
              <option value="lt">is less than</option>
            </select>
            <input className={inp} type="number" placeholder="threshold (e.g. 500)" value={form.threshold} onChange={e => setForm({ ...form, threshold: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={busy || !form.name.trim() || !form.threshold.trim()} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold disabled:opacity-50">{busy ? "Saving…" : "Save rule"}</button>
            <button onClick={() => setForm(null)} className="text-xs text-slate-400 font-bold">cancel</button>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </div>
      )}
    </section>
  );
}

export default AdsTab;
