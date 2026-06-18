"use client";

// Broadcast tab — manual sends (BroadcastNow), API broadcasting rules, auto-sends
// (Automations), and the BroadcastRail. Extracted from admin/page.tsx, lazy-loaded.
import { useState, useEffect, useCallback } from "react";
import { Check, Copy, FlaskConical, Globe, Image as ImageIcon, Loader2, Plus, Send, Trash2, Zap, X } from "lucide-react";
import { type Tab, inp, railLoading, RailCard, StatRow, RailBar, ChannelSelect, ImageUpload, useAnalytics } from "../_shared";

const TIER_LABELS: Record<string, string> = {
  TIER_50: "50 / day", TIER_250: "250 / day", TIER_1K: "1,000 / day",
  TIER_10K: "10,000 / day", TIER_100K: "100,000 / day", TIER_UNLIMITED: "Unlimited",
};

// Broadcast: daily limit & number status, sending health, templates, campaigns.
function BroadcastRail({ goTo, preview }: { goTo: (t: Tab) => void; preview?: React.ReactNode }) {
  const a = useAnalytics();
  const [tpls, setTpls] = useState<{ name: string; status: string }[] | null>(null);
  const [camps, setCamps] = useState<{ id: string; name?: string | null; templateName: string; status: string; sentCount: number; totalRecipients: number }[] | null>(null);
  const [limits, setLimits] = useState<{ dailyCap: number; sentToday: number; quality: string | null; tier: string | null; displayPhone: string | null; metaError: string | null } | null>(null);
  useEffect(() => { fetch("/api/admin/templates").then(r => r.json()).then(d => setTpls(d.templates ?? [])).catch(() => setTpls([])); }, []);
  useEffect(() => { fetch("/api/admin/campaigns").then(r => r.json()).then(d => setCamps((d.campaigns ?? []).slice(0, 4))).catch(() => setCamps([])); }, []);
  useEffect(() => { fetch("/api/admin/broadcast/limits").then(r => r.json()).then(setLimits).catch(() => {}); }, []);
  const byStatus = (s: string) => (tpls ?? []).filter(t => t.status === s).length;
  const usedPct = limits && limits.dailyCap > 0 ? Math.round((limits.sentToday / limits.dailyCap) * 100) : 0;
  const quality = limits?.quality?.toUpperCase() ?? null;
  return (
    <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
      {preview}
      <RailCard title="Daily sending limit">
        {!limits ? railLoading : <>
          <RailBar label="Used today" count={limits.sentToday} pct={usedPct} color={usedPct >= 90 ? "bg-red-400" : usedPct >= 70 ? "bg-amber-400" : "bg-brand-500"} />
          <StatRow label="Platform cap" value={`${limits.sentToday.toLocaleString()} / ${limits.dailyCap.toLocaleString()}`} tone={usedPct >= 90 ? "bad" : usedPct >= 70 ? "warn" : undefined} />
          <StatRow label="Meta tier limit" value={limits.tier ? (TIER_LABELS[limits.tier] ?? limits.tier) : limits.metaError ? "unavailable" : "—"} />
          <StatRow label="Number quality" value={
            quality === "GREEN" ? <span className="text-brand-700">● GREEN</span>
            : quality === "YELLOW" ? <span className="text-amber-600">● YELLOW</span>
            : quality === "RED" ? <span className="text-red-600">● RED</span>
            : limits.metaError ? "unavailable" : (quality ?? "—")
          } />
          {limits.metaError && <p className="text-[11px] text-amber-600">Meta status check failed — {limits.metaError.length > 60 ? "Meta API unreachable right now (likely their outage)." : limits.metaError}</p>}
          <p className="text-[11px] text-slate-400">When the cap is reached, remaining sends queue and resume automatically after midnight. The cap protects your Meta tier and quality rating.</p>
        </>}
      </RailCard>
      <RailCard title="Sending health" action="Analytics" onAction={() => goTo("analytics")}>
        {!a ? railLoading : <>
          <StatRow label="Active contacts" value={a.contacts.active} onClick={() => goTo("contacts")} />
          <StatRow label="Opted out (auto-skipped)" value={a.contacts.optedOut} onClick={() => goTo("optouts")} />
          <StatRow label="Failed (14 days)" value={a.messaging.totals.failed} tone={a.messaging.totals.failed > 0 ? "warn" : undefined} />
        </>}
      </RailCard>
      <RailCard title="Templates" action="Manage" onAction={() => goTo("templates")}>
        {!tpls ? railLoading : <>
          <StatRow label="Approved — ready to send" value={byStatus("APPROVED")} />
          <StatRow label="Pending Meta review" value={byStatus("PENDING")} tone={byStatus("PENDING") > 0 ? "warn" : undefined} />
          <StatRow label="Rejected" value={byStatus("REJECTED")} tone={byStatus("REJECTED") > 0 ? "bad" : undefined} />
          {tpls.filter(t => t.status === "APPROVED").slice(0, 3).map(t => (
            <p key={t.name} className="text-[11px] font-mono text-ink-600 truncate border-t border-line pt-1.5">{t.name}</p>
          ))}
        </>}
      </RailCard>
      <RailCard title="Recent campaigns" action="History" onAction={() => goTo("campaigns")}>
        {!camps ? railLoading : camps.length === 0
          ? <p className="text-xs text-slate-400">No campaigns yet — your first send shows up here with its delivery funnel.</p>
          : camps.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-2 py-0.5 cursor-pointer hover:bg-canvas rounded-md px-1 -mx-1" onClick={() => goTo("campaigns")}>
              <span className="text-xs font-semibold text-ink-900 truncate">{c.name || c.templateName}</span>
              <span className="text-[11px] text-slate-400 shrink-0">{c.sentCount}/{c.totalRecipients} · {c.status}</span>
            </div>
          ))}
      </RailCard>
      <RailCard title="Good to know">
        <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
          <li>Marketing templates need Meta approval — submit from <b>Templates</b>, status updates here.</li>
          <li>Opted-out numbers are skipped automatically on every send.</li>
          <li>Use <b>Test before sending</b> to preview the exact message on your own phone.</li>
          <li>Event-driven sends (e.g. from your website/CRM) live in <b>API broadcasting</b> with rules and frequency caps.</li>
        </ul>
      </RailCard>
    </aside>
  );
}


// Chatbot Flows: live flow stats + plain-language building guide.

// WhatsApp Forms: publish pipeline + where the answers land.
// ── Broadcast ────────────────────────────────────────────────────────────────
// ── Broadcast section: manual sends + API broadcasting + auto-sends ───────────
function BroadcastTab({ goTo }: { goTo: (t: Tab) => void }) {
  const [sub, setSub] = useState<"now" | "api" | "auto">("now");
  const seg = (active: boolean) => `px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5 ${active ? "bg-brand-700 text-white" : "bg-white border border-line text-slate-500 hover:bg-slate-50"}`;
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button className={seg(sub === "now")} onClick={() => setSub("now")}><Send className="w-4 h-4" />Broadcast now</button>
        <button className={seg(sub === "api")} onClick={() => setSub("api")}><Globe className="w-4 h-4" />API broadcasting</button>
        <button className={seg(sub === "auto")} onClick={() => setSub("auto")}><Zap className="w-4 h-4" />Auto-sends</button>
      </div>
      {sub === "now" && <BroadcastNow goTo={goTo} />}
      {sub === "api" && <ApiBroadcasting />}
      {sub === "auto" && <AutomationsTab />}
    </div>
  );
}

function BroadcastNow({ goTo }: { goTo: (t: Tab) => void }) {
  const [audMode, setAudMode] = useState<"all" | "tag" | "attribute" | "recipients">("all");
  const [tag, setTag] = useState("");
  const [attrKey, setAttrKey] = useState("");
  const [attrValue, setAttrValue] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [languageCode, setLanguageCode] = useState("en_US");
  const [variables, setVariables] = useState("{name}");
  const [headerImageUrl, setHeaderImageUrl] = useState("");
  const [channelId, setChannelId] = useState<string | null>(null);
  const [replyFlowId, setReplyFlowId] = useState("");
  const [flows, setFlows] = useState<{ id: string; name: string; active: boolean; triggerKeywords?: string[] }[]>([]);
  const [templates, setTemplates] = useState<{ name: string; status: string; language: string; category: string; components?: { type: string; format?: string; text?: string }[] }[]>([]);
  const [manualTemplate, setManualTemplate] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retargetNote, setRetargetNote] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/templates${channelId ? `?channelId=${channelId}` : ""}`).then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  }, [channelId]);

  // Flows available to start when a recipient replies ("bot on broadcast").
  useEffect(() => {
    fetch("/api/admin/flows").then(r => r.json()).then(d => setFlows(d.flows ?? [])).catch(() => {});
  }, []);

  // A "Retarget →" click in Campaign history lands here with the segment prefilled.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("wa_retarget");
      if (!raw) return;
      sessionStorage.removeItem("wa_retarget");
      const { note, recipients } = JSON.parse(raw) as { note: string; recipients: { phone: string; fullName: string }[] };
      setAudMode("recipients");
      setRecipientsText(recipients.map(r => `${r.phone}${r.fullName ? "," + r.fullName : ""}`).join("\n"));
      setRetargetNote(note);
    } catch { /* malformed payload — start blank */ }
  }, []);
  useEffect(() => {
    if (audMode === "recipients") { setCount(null); return; }
    fetch(`/api/admin/broadcast?mode=${audMode}&tag=${encodeURIComponent(tag)}&key=${encodeURIComponent(attrKey)}&value=${encodeURIComponent(attrValue)}`).then(r => r.json()).then(d => setCount(d.count ?? null)).catch(() => setCount(null));
  }, [audMode, tag, attrKey, attrValue]);

  function parseRecipients() {
    return recipientsText.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const [phone, ...rest] = line.split(",");
      return { phone: phone.trim(), name: rest.join(",").trim() };
    }).filter(r => r.phone);
  }

  async function send() {
    setError(null); setResult(null);
    const problem = templateProblem();
    if (problem) { setError(problem); return; }
    // Confirm before a real blast — this fires to the whole audience and can't
    // be undone. Show the authoritative recipient count so it's never a surprise.
    const who = recipientCount === null
      ? "your selected audience"
      : `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? "" : "s"}`;
    if (!confirm(`Send "${templateName.trim()}" to ${who}? This sends real WhatsApp messages and can't be undone.`)) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = {
        mode: audMode === "recipients" ? "recipients" : "audience",
        templateName: templateName.trim(),
        languageCode: languageCode.trim() || "en_US",
        variables: variables.split(/\r?\n/).map(v => v.trim()).filter(Boolean),
        headerImageUrl: headerImageUrl.trim() || null,
        channelId,
        replyFlowId: replyFlowId || null,
      };
      if (audMode === "recipients") body.recipients = parseRecipients();
      else body.audience = {
        mode: audMode,
        tag: audMode === "tag" ? tag.trim() : undefined,
        key: audMode === "attribute" ? attrKey.trim() : undefined,
        value: audMode === "attribute" ? attrValue.trim() : undefined,
      };
      const res = await fetch("/api/admin/broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || !d.success) setError(d.error || "Failed"); else setResult(d.message);
    } catch { setError("Connection error"); }
    finally { setSending(false); }
  }

  // One-off test send — exact same template/variables/header as the real
  // broadcast, but to a single typed-in number with nothing recorded.
  async function sendTest() {
    setTestMsg(null);
    const problem = templateProblem();
    if (problem) { setTestMsg({ ok: false, text: problem }); return; }
    const [phone, ...rest] = testPhone.split(",");
    if (phone.replace(/\D/g, "").length < 10) { setTestMsg({ ok: false, text: "Enter a number with country code, e.g. 919876543210" }); return; }
    setTesting(true);
    try {
      const res = await fetch("/api/admin/broadcast/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(), name: rest.join(",").trim() || undefined,
          templateName: templateName.trim(), languageCode: languageCode.trim() || "en_US",
          variables: variables.split(/\r?\n/).map(v => v.trim()).filter(Boolean),
          headerImageUrl: headerImageUrl.trim() || null, channelId,
        }),
      });
      const d = await res.json();
      setTestMsg(res.ok && d.success ? { ok: true, text: `Test sent to ${phone.trim()} ✓ — check the phone.` } : { ok: false, text: d.error || "Test send failed" });
    } catch { setTestMsg({ ok: false, text: "Connection error" }); }
    finally { setTesting(false); }
  }

  const recipientCount = audMode === "recipients" ? parseRecipients().length : count;

  // Selected template details — drive the variable inputs and header field so
  // the form can only produce payloads Meta will accept (no #132018).
  const approved = templates.filter(t => t.status === "APPROVED");
  const selected = !manualTemplate ? approved.find(t => t.name === templateName && t.language === languageCode) : undefined;
  const comps = selected?.components ?? [];
  const headerFormat = comps.find(c => c.type === "HEADER")?.format ?? null;
  const needsImage = headerFormat === "IMAGE";
  const bodyPreview = comps.find(c => c.type === "BODY")?.text ?? "";
  const varCount = selected ? new Set(Array.from(bodyPreview.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size : 0;
  const varsArr = Array.from({ length: varCount }, (_, i) => variables.split(/\r?\n/)[i] ?? "");
  const setVar = (i: number, val: string) => setVariables(varsArr.map((v, j) => (j === i ? val : v)).join("\n"));

  function pickTemplate(value: string) {
    if (value === "__manual") { setManualTemplate(true); setTemplateName(""); return; }
    setManualTemplate(false);
    const [n, l] = value.split("|");
    setTemplateName(n ?? ""); setLanguageCode(l || "en_US");
    setHeaderImageUrl("");                       // never carry a header into a template that lacks one
    const t = approved.find(x => x.name === n && x.language === l);
    const bt = t?.components?.find(c => c.type === "BODY")?.text ?? "";
    const nVars = new Set(Array.from(bt.matchAll(/\{\{(\d+)\}\}/g), m => m[1])).size;
    setVariables(Array.from({ length: nVars }, (_, i) => (i === 0 ? "{name}" : "")).join("\n"));
  }

  // Shared pre-send validation for both real sends and tests.
  function templateProblem(): string | null {
    if (!templateName.trim()) return "Pick an approved template first.";
    if (selected && needsImage && !headerImageUrl.trim()) return "This template has an image header — add or upload the image first.";
    if (selected && varCount > 0 && varsArr.some(v => !v.trim())) return `Fill all ${varCount} variable value(s) — the template's text has {{${varCount}}} placeholders.`;
    return null;
  }

  // Live WhatsApp-style preview of the selected template, mirrored into the rail.
  const filledBody = bodyPreview.replace(/\{\{(\d+)\}\}/g, (_, d) => varsArr[Number(d) - 1]?.trim() || `{{${d}}}`);
  const previewFooter = comps.find(c => c.type === "FOOTER")?.text ?? "";
  const previewButtons = ((comps.find(c => c.type === "BUTTONS") as { buttons?: { text?: string }[] } | undefined)?.buttons) ?? [];
  const previewCard = (
    <div className="bg-white rounded-card border border-line p-4">
      <p className="text-[11px] font-medium text-ink-400 uppercase tracking-[0.06em] mb-2">Preview</p>
      {selected ? (
        <div className="bg-[#e5ddd5] rounded-control p-3">
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            {needsImage && (headerImageUrl.trim()
              ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headerImageUrl} alt="" className="w-full h-32 object-cover" />
              )
              : <div className="h-32 bg-slate-200 flex items-center justify-center text-slate-400"><ImageIcon className="w-6 h-6" /></div>)}
            <p className="px-3 py-2 text-[13px] text-slate-800 whitespace-pre-wrap break-words">{filledBody || "Your message appears here…"}</p>
            {previewFooter.trim() && <p className="px-3 pb-1 text-[11px] text-slate-400">{previewFooter}</p>}
            <p className="px-3 pb-1.5 text-right text-[10px] text-slate-300">10:30</p>
            {previewButtons.map((b, i) => (
              <div key={i} className="border-t border-slate-100 py-1.5 text-center text-[12px] font-semibold text-sky-600">{b.text || "Button"}</div>
            ))}
          </div>
        </div>
      ) : <p className="text-xs text-ink-400">Pick a template above to preview the message your contacts will see.</p>}
    </div>
  );

  return (
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 max-w-2xl space-y-5">
      <h2 className="text-xl font-extrabold text-brand-dark">Broadcast</h2>

      {retargetNote && (
        <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-sm text-brand-700 flex items-center justify-between">
          <span><b>{retargetNote}</b> — recipients prefilled below. Pick a template and send.</span>
          <button onClick={() => { setRetargetNote(null); setRecipientsText(""); setAudMode("all"); }} className="text-brand-600 font-bold">×</button>
        </div>
      )}

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Who</p>
        <div className="flex gap-2 flex-wrap">
          {(["all", "tag", "attribute", "recipients"] as const).map(m => (
            <button key={m} onClick={() => setAudMode(m)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${audMode === m ? "border-brand-dark bg-brand-700 text-white" : "border-line text-slate-600"}`}>
              {m === "all" ? "All contacts" : m === "tag" ? "By tag" : m === "attribute" ? "By attribute" : "Paste list"}
            </button>
          ))}
        </div>
        {audMode === "tag" && <input className={`${inp} w-full`} placeholder="tag (e.g. webinar-june)" value={tag} onChange={e => setTag(e.target.value)} />}
        {audMode === "attribute" && (
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="attribute key (e.g. city)" value={attrKey} onChange={e => setAttrKey(e.target.value)} />
            <input className={inp} placeholder="value (e.g. Mumbai)" value={attrValue} onChange={e => setAttrValue(e.target.value)} />
          </div>
        )}
        {audMode === "recipients"
          ? <textarea className={`${inp} w-full font-mono`} rows={4} placeholder={"919876543210, Asha\n919812345678, Ravi"} value={recipientsText} onChange={e => setRecipientsText(e.target.value)} />
          : <p className="text-sm text-slate-600">{recipientCount === null ? "—" : <><b className="text-brand-dark">{recipientCount.toLocaleString()}</b> active contacts will receive this.</>}</p>}
      </section>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-slate-400 uppercase">Message (approved template)</p>
          <ChannelSelect value={channelId} onChange={setChannelId} allLabel="Send from: default number" className={`${inp} !py-1.5 text-xs`} />
        </div>
        {!manualTemplate ? (
          <select className={`${inp} w-full`} value={selected ? `${selected.name}|${selected.language}` : ""} onChange={e => pickTemplate(e.target.value)}>
            <option value="">{approved.length ? "Choose an approved template…" : "No approved templates yet — create one in Templates"}</option>
            {approved.map(t => (
              <option key={`${t.name}-${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} · {t.language} · {t.category}{t.components?.some(c => c.type === "HEADER" && c.format === "IMAGE") ? " · 🖼 image" : ""}
              </option>
            ))}
            <option value="__manual">Other — type a template name manually…</option>
          </select>
        ) : (
          <div className="grid grid-cols-[1fr_7rem_auto] gap-2 items-center">
            <input className={inp} placeholder="template name" value={templateName} onChange={e => setTemplateName(e.target.value)} />
            <input className={inp} placeholder="en_US" value={languageCode} onChange={e => setLanguageCode(e.target.value)} />
            <button onClick={() => { setManualTemplate(false); setTemplateName(""); }} className="text-xs font-bold text-brand-700 hover:underline">use list</button>
          </div>
        )}

        {selected && bodyPreview && (
          <div className="bg-canvas rounded-control px-3 py-2 text-xs text-ink-600 whitespace-pre-wrap">{bodyPreview}</div>
        )}

        {selected ? (
          varCount === 0 ? (
            <p className="text-[11px] text-slate-400">This template has no variables — nothing else to fill in.</p>
          ) : (
            <div className="space-y-1.5">
              {varsArr.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400 w-12 shrink-0">{`{{${i + 1}}}`}</span>
                  <input className={`${inp} flex-1`} placeholder={i === 0 ? "{name} — fills each contact's first name" : `Value for {{${i + 1}}}`} value={v} onChange={e => setVar(i, e.target.value)} />
                </div>
              ))}
              <p className="text-[11px] text-slate-400">Tip: <b>{"{name}"}</b> is replaced with each recipient&apos;s first name automatically.</p>
            </div>
          )
        ) : (
          <textarea className={`${inp} w-full font-mono`} rows={2} placeholder={"Variables, one per line\n{name}"} value={variables} onChange={e => setVariables(e.target.value)} />
        )}

        {(!selected || needsImage) && (
          <div className="space-y-1">
            {needsImage && <p className="text-[11px] font-bold text-amber-600">This template has an image header — an image is required.</p>}
            <div className="flex items-center gap-3">
              <input className={`${inp} flex-1`} placeholder={needsImage ? "Header image URL (required)" : "Header image URL (only if the template has an image header)"} value={headerImageUrl} onChange={e => setHeaderImageUrl(e.target.value)} />
              <ImageUpload onUploaded={setHeaderImageUrl} />
            </div>
          </div>
        )}
        {selected && headerFormat && headerFormat !== "IMAGE" && headerFormat !== "TEXT" && (
          <p className="text-[11px] text-amber-600">This template has a {headerFormat.toLowerCase()} header — broadcasting that header type isn&apos;t supported yet.</p>
        )}
      </section>

      <section className="bg-white rounded-card border border-line p-5 space-y-2">
        <p className="text-xs font-bold text-slate-400 uppercase">When they reply — start a flow <span className="text-slate-300 normal-case font-normal">(optional)</span></p>
        <p className="text-xs text-slate-500">Pick a chatbot flow to run automatically when a recipient replies to this broadcast — a tap on a template button or any message. Their first reply starts it (no trigger keyword needed); it stays armed for 7 days.</p>
        <select className={`${inp} w-full`} value={replyFlowId} onChange={e => setReplyFlowId(e.target.value)}>
          <option value="">No flow — replies go to Live Chat / AI as usual</option>
          {flows.filter(f => f.active).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {replyFlowId && (() => {
          const f = flows.find(x => x.id === replyFlowId);
          return f ? <p className="text-[11px] text-brand-700 font-semibold">▶ Replies to this broadcast will start <b>{f.name}</b> from its first step.</p> : null;
        })()}
        {flows.filter(f => f.active).length === 0 && <p className="text-[11px] text-amber-600">No active flows yet — build one in the Flows tab first.</p>}
      </section>

      <section className="bg-white rounded-card border border-line p-5 space-y-2">
        <p className="text-xs font-bold text-slate-400 uppercase">Test before sending</p>
        <p className="text-xs text-slate-500">Sends this exact message to one number — not saved as a campaign, contact, or log entry.</p>
        <div className="flex items-center gap-2">
          <input
            className={`${inp} flex-1`} placeholder="919876543210, Name (optional)"
            value={testPhone} onChange={e => setTestPhone(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendTest(); }}
          />
          <button onClick={sendTest} disabled={testing} className="shrink-0 px-4 py-2 rounded-control border border-brand-700 text-brand-700 hover:bg-brand-50 text-sm font-bold flex items-center gap-1.5 disabled:opacity-60">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send test
          </button>
        </div>
        {testMsg && <p className={`text-xs font-semibold ${testMsg.ok ? "text-brand-700" : "text-red-600"}`}>{testMsg.text}</p>}
      </section>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>}
      {result && <div className="bg-brand-green/10 border border-brand-green/40 rounded-lg px-4 py-3 text-sm text-brand-dark font-semibold">{result}</div>}

      <button onClick={send} disabled={sending} className="w-full py-3 rounded-card bg-gradient-to-br from-brand-600 to-brand-900 hover:from-brand-500 hover:to-brand-800 text-white font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send broadcast
      </button>
    </div>
    <BroadcastRail goTo={goTo} preview={previewCard} />
    </div>
  );
}
// ── Automations ────────────────────────────────────────────────────────────────
// ── API broadcasting: portal-defined rules for externally-fired events ────────
type UiCond = { source: "payload" | "contact_attr" | "contact_tag" | "contact_field"; key: string; op: "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt"; value: string };
type UiRule = {
  id?: string; campaignId?: string | null; name: string; active: boolean; eventKey: string;
  conditions: UiCond[]; templateName: string; languageCode: string; variables: string[];
  headerImageUrl: string | null; delayValue: number; delayUnit: string;
  windowStartHour: number | null; windowEndHour: number | null; frequencyCapHours: number;
  channelId: string | null;
};
const NEW_RULE: UiRule = {
  name: "", active: true, eventKey: "", conditions: [], templateName: "", languageCode: "en_US",
  variables: [], headerImageUrl: null, delayValue: 0, delayUnit: "minutes",
  windowStartHour: null, windowEndHour: null, frequencyCapHours: 0, channelId: null,
};
const COND_SOURCES: { v: UiCond["source"]; label: string }[] = [
  { v: "payload", label: "Event data" },
  { v: "contact_attr", label: "Contact attribute" },
  { v: "contact_tag", label: "Contact tag" },
  { v: "contact_field", label: "Contact field" },
];
const COND_OPS: { v: UiCond["op"]; label: string }[] = [
  { v: "equals", label: "is" }, { v: "not_equals", label: "is not" }, { v: "contains", label: "contains" },
  { v: "exists", label: "exists" }, { v: "gt", label: ">" }, { v: "lt", label: "<" },
];

function ApiBroadcasting() {
  const [rules, setRules] = useState<UiRule[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [templates, setTemplates] = useState<{ name: string; status: string; language: string }[]>([]);
  const [editing, setEditing] = useState<UiRule | null>(null);
  const [varsText, setVarsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Dry-run tester
  const [tEvent, setTEvent] = useState("");
  const [tPhone, setTPhone] = useState("");
  const [tData, setTData] = useState("{\n  \"course\": \"Data Science\"\n}");
  const [tBusy, setTBusy] = useState(false);
  const [tResults, setTResults] = useState<{ rule: string; outcome: string; detail?: string; sendAfter?: string; variables?: string[] }[] | null>(null);
  const [tErr, setTErr] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const load = useCallback(() => {
    fetch("/api/admin/api-rules").then(r => r.json()).then(d => { setRules(d.rules ?? []); setNotice(d.notice ?? null); }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/admin/templates").then(r => r.json()).then(d => setTemplates(d.templates ?? [])).catch(() => {}); }, []);

  function openEdit(r?: UiRule) {
    const rule = r ?? NEW_RULE;
    setEditing({ ...rule, conditions: rule.conditions.map(c => ({ ...c })) });
    setVarsText((r?.variables ?? []).join("\n"));
    setMsg(null);
  }
  const setEd = (patch: Partial<UiRule>) => setEditing(e => (e ? { ...e, ...patch } : e));
  const setCond = (i: number, patch: Partial<UiCond>) => setEditing(e => (e ? { ...e, conditions: e.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) } : e));

  async function save() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.eventKey.trim() || !editing.templateName.trim()) { setMsg("Name, event key and template are required."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/api-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, eventKey: editing.eventKey.trim(), variables: varsText.split(/\r?\n/).map(v => v.trim()).filter(Boolean) }),
      });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Save failed");
      else { setEditing(null); load(); }
    } finally { setSaving(false); }
  }
  async function toggleRule(r: UiRule) {
    await fetch("/api/admin/api-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, active: !r.active }) });
    load();
  }
  async function removeRule(id: string) {
    if (!confirm("Delete this rule? Already-queued sends are cancelled.")) return;
    await fetch("/api/admin/api-rules", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }

  async function dryRun() {
    setTErr(null); setTResults(null);
    if (!tEvent.trim() || !tPhone.trim()) { setTErr("Event name and phone are required."); return; }
    let data: Record<string, unknown> = {};
    if (tData.trim()) { try { data = JSON.parse(tData); } catch { setTErr("Test data is not valid JSON."); return; } }
    setTBusy(true);
    try {
      const res = await fetch("/api/admin/api-rules/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: tEvent.trim(), phone: tPhone.trim(), data }) });
      const d = await res.json();
      if (!res.ok) setTErr(d.error || "Test failed"); else setTResults(d.results ?? []);
    } finally { setTBusy(false); }
  }

  const curl = `curl -X POST ${origin}/api/events \\
  -H "Authorization: Bearer $BROADCAST_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"demo_booked","phone":"919876543210","name":"Asha","data":{"course":"Data Science","slot":"7 PM"}}'`;

  const hourOpts = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">API broadcasting</h2>
          <p className="text-sm text-slate-500">Your systems fire one event — the rules you define here decide what gets sent, to whom, and when.</p>
        </div>
        <button onClick={() => openEdit()} className="shrink-0 px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> New rule</button>
      </div>

      {notice && <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">{notice} — apply migration <code className="font-mono">0012_api_rules.sql</code> in Supabase.</div>}

      <section className="bg-slate-900 rounded-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-400 uppercase">Endpoint — fire from your backend, CRM, or website</p>
          <button onClick={() => { navigator.clipboard.writeText(curl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            className="px-2.5 py-1 rounded-lg bg-white/10 text-white text-[11px] font-bold flex items-center gap-1.5 hover:bg-white/20">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? "Copied" : "Copy cURL"}
          </button>
        </div>
        <pre className="text-[11px] leading-relaxed text-brand-500 font-mono overflow-x-auto whitespace-pre">{curl}</pre>
        <p className="text-[11px] text-slate-400">
          Auth: <code className="text-slate-300">Bearer BROADCAST_API_KEY</code> (env). Everything inside <code className="text-slate-300">data</code> is available to rule conditions and template variables as <code className="text-slate-300">{"{{payload.field}}"}</code>.
        </p>
      </section>

      {editing && (
        <section className="bg-white rounded-card border-2 border-brand-dark/30 p-5 space-y-4">
          <p className="text-xs font-bold text-slate-400 uppercase">{editing.id ? "Edit rule" : "New rule"}</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} placeholder="Rule name, e.g. Demo booked → confirmation" value={editing.name} onChange={e => setEd({ name: e.target.value })} />
            <input className={inp} placeholder="event key, e.g. demo_booked" value={editing.eventKey} onChange={e => setEd({ eventKey: e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_") })} />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase">Conditions <span className="font-normal normal-case">— all must pass (leave empty to always fire)</span></p>
            {editing.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className={`${inp} w-40`} value={c.source} onChange={e => setCond(i, { source: e.target.value as UiCond["source"] })}>
                  {COND_SOURCES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
                <input className={`${inp} w-40`} placeholder={c.source === "payload" ? "field, e.g. course" : c.source === "contact_tag" ? "tag name" : c.source === "contact_field" ? "name | email | source" : "attribute key"} value={c.key} onChange={e => setCond(i, { key: e.target.value })} />
                <select className={`${inp} w-28`} value={c.op} onChange={e => setCond(i, { op: e.target.value as UiCond["op"] })}>
                  {COND_OPS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                {c.op !== "exists" && <input className={`${inp} flex-1`} placeholder="value" value={c.value} onChange={e => setCond(i, { value: e.target.value })} />}
                <button onClick={() => setEditing(e => (e ? { ...e, conditions: e.conditions.filter((_, j) => j !== i) } : e))} className="p-1 text-slate-300 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
            <button onClick={() => setEditing(e => (e ? { ...e, conditions: [...e.conditions, { source: "payload", key: "", op: "equals", value: "" }] } : e))}
              className="text-xs font-semibold text-brand-dark flex items-center gap-1 hover:underline"><Plus className="w-3.5 h-3.5" /> Add condition</button>
          </div>

          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Template</p>
              <input className={`${inp} w-full`} list="rule-tpls" placeholder="approved template name" value={editing.templateName} onChange={e => setEd({ templateName: e.target.value })} />
              <datalist id="rule-tpls">{templates.filter(t => t.status === "APPROVED").map(t => <option key={`${t.name}-${t.language}`} value={t.name} />)}</datalist>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Language</p>
              <input className={`${inp} w-full`} value={editing.languageCode} onChange={e => setEd({ languageCode: e.target.value })} />
            </div>
          </div>

          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Template variables <span className="font-normal normal-case">— one per line, in {"{{1}}, {{2}}"} order</span></p>
            <textarea className={`${inp} w-full font-mono`} rows={3} placeholder={"{{contact.name}}\n{{payload.course}}\n{{payload.slot}}"} value={varsText} onChange={e => setVarsText(e.target.value)} />
            <p className="text-[11px] text-slate-400 mt-1">Tokens: <code className="bg-slate-100 px-1 rounded">{"{{payload.x}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{contact.name}}"}</code> <code className="bg-slate-100 px-1 rounded">{"{{contact.attr.key}}"}</code> — or plain literal text.</p>
          </div>

          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Delay</p>
              <div className="flex gap-1.5">
                <input type="number" min={0} className={`${inp} w-20`} value={editing.delayValue} onChange={e => setEd({ delayValue: parseInt(e.target.value || "0", 10) })} />
                <select className={inp} value={editing.delayUnit} onChange={e => setEd({ delayUnit: e.target.value })}>
                  <option value="minutes">min</option><option value="hours">hours</option><option value="days">days</option>
                </select>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Send window (IST)</p>
              <div className="flex gap-1.5 items-center">
                <select className={inp} value={editing.windowStartHour ?? ""} onChange={e => setEd({ windowStartHour: e.target.value === "" ? null : parseInt(e.target.value, 10) })}>
                  <option value="">anytime</option>
                  {hourOpts(0, 23).map(h => <option key={h} value={h}>{h}:00</option>)}
                </select>
                <span className="text-xs text-slate-400">to</span>
                <select className={inp} value={editing.windowEndHour ?? ""} onChange={e => setEd({ windowEndHour: e.target.value === "" ? null : parseInt(e.target.value, 10) })}>
                  <option value="">—</option>
                  {hourOpts(1, 24).map(h => <option key={h} value={h}>{h}:00</option>)}
                </select>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Frequency cap</p>
              <div className="flex gap-1.5 items-center">
                <input type="number" min={0} className={`${inp} w-20`} value={editing.frequencyCapHours} onChange={e => setEd({ frequencyCapHours: parseInt(e.target.value || "0", 10) })} />
                <span className="text-xs text-slate-400">hours (0 = off)</span>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Send from</p>
              <ChannelSelect value={editing.channelId} onChange={v => setEd({ channelId: v })} allLabel="Default number" />
            </div>
            <div className="flex-1" />
            <div className="flex gap-2">
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save rule
              </button>
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm font-semibold text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
        </section>
      )}

      <div className="space-y-2">
        {rules.map(r => (
          <div key={r.id} className={`bg-white rounded-card border p-4 flex items-center gap-4 ${r.active ? "border-line" : "border-slate-100 opacity-60"}`}>
            <button onClick={() => toggleRule(r)} title={r.active ? "Deactivate" : "Activate"}
              className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${r.active ? "bg-brand-green" : "bg-slate-200"}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${r.active ? "left-4.5 right-0.5" : "left-0.5"}`} style={{ left: r.active ? "1.125rem" : "0.125rem" }} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-brand-dark truncate">{r.name}</p>
              <p className="text-[11px] text-slate-400 truncate">
                <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-slate-500">{r.eventKey}</span>
                {" → "}<span className="font-mono">{r.templateName}</span>
                {r.conditions.length > 0 && ` · ${r.conditions.length} condition${r.conditions.length > 1 ? "s" : ""}`}
                {r.delayValue > 0 && ` · after ${r.delayValue} ${r.delayUnit}`}
                {r.windowStartHour !== null && r.windowEndHour !== null && ` · ${r.windowStartHour}:00–${r.windowEndHour}:00 IST`}
                {r.frequencyCapHours > 0 && ` · max 1/${r.frequencyCapHours}h`}
              </p>
            </div>
            <button onClick={() => openEdit(r)} className="px-3 py-1.5 rounded-lg border border-line text-xs font-bold text-slate-500 hover:bg-slate-50 shrink-0">Edit</button>
            <button onClick={() => removeRule(r.id!)} className="p-1.5 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {rules.length === 0 && !notice && <p className="text-center text-slate-400 text-sm py-6">No rules yet — create one above, then fire the event from your system.</p>}
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Test an event (dry run — nothing is sent or queued)</p>
        <div className="grid grid-cols-2 gap-2">
          <input className={inp} placeholder="event, e.g. demo_booked" value={tEvent} onChange={e => setTEvent(e.target.value)} />
          <input className={inp} placeholder="phone, e.g. 919876543210" value={tPhone} onChange={e => setTPhone(e.target.value)} />
        </div>
        <textarea className={`${inp} w-full font-mono`} rows={3} placeholder='{"course": "Data Science"}' value={tData} onChange={e => setTData(e.target.value)} />
        <button onClick={dryRun} disabled={tBusy} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">
          {tBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Dry run
        </button>
        {tErr && <p className="text-xs text-red-500">{tErr}</p>}
        {tResults && (
          <div className="space-y-2">
            {tResults.length === 0 && <p className="text-xs text-slate-400">No active rules listen to this event.</p>}
            {tResults.map((r, i) => (
              <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${r.outcome === "dry_run_match" ? "border-brand-100 bg-brand-50" : "border-amber-200 bg-amber-50"}`}>
                <p className="font-bold text-slate-700">{r.rule} — {r.outcome === "dry_run_match" ? "✓ would send" : `skipped (${r.detail})`}</p>
                {r.outcome === "dry_run_match" && (
                  <p className="text-slate-500 mt-0.5">
                    at {r.sendAfter ? new Date(r.sendAfter).toLocaleString() : "now"}
                    {r.variables?.length ? ` · variables: ${r.variables.map(v => `"${v}"`).join(", ")}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AutomationsTab() {
  const [list, setList] = useState<{ id: string; name: string | null; templateName: string; autoSendTrigger: string; triggerKey: string | null; delayValue: number; delayUnit: string }[]>([]);
  const [trigger, setTrigger] = useState("api_event");
  const [triggerKey, setTriggerKey] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [delayValue, setDelayValue] = useState(0);
  const [delayUnit, setDelayUnit] = useState("minutes");
  const [variables, setVariables] = useState("{name}");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => { fetch("/api/admin/automations").then(r => r.json()).then(d => setList(d.automations ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!templateName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger, triggerKey: triggerKey.trim() || null, templateName: templateName.trim(), variables: variables.split(/\r?\n/).map(v => v.trim()).filter(Boolean), delayValue, delayUnit }) });
      setTemplateName(""); setTriggerKey(""); load();
    } finally { setSaving(false); }
  }
  async function disable(id: string) { await fetch("/api/admin/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, enabled: false }) }); load(); }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark">Auto-sends</h2>
        <p className="text-sm text-slate-500">Simple fixed-template triggers (welcome on contact added, legacy named events). For conditional sends with payload variables, windows and caps, use <b>API broadcasting</b>.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">New automation</p>
        <div className="grid grid-cols-2 gap-2">
          <select className={inp} value={trigger} onChange={e => setTrigger(e.target.value)}>
            <option value="contact_added">When a contact is added</option>
            <option value="api_event">On API event (named)</option>
          </select>
          <input className={inp} placeholder="event name (for api_event)" value={triggerKey} onChange={e => setTriggerKey(e.target.value)} disabled={trigger !== "api_event"} />
        </div>
        <input className={`${inp} w-full`} placeholder="approved template name" value={templateName} onChange={e => setTemplateName(e.target.value)} />
        <textarea className={`${inp} w-full font-mono`} rows={2} placeholder="{name}" value={variables} onChange={e => setVariables(e.target.value)} />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold text-slate-500">Delay</span>
          <input type="number" min={0} className={`${inp} w-20`} value={delayValue} onChange={e => setDelayValue(parseInt(e.target.value || "0", 10))} />
          <select className={inp} value={delayUnit} onChange={e => setDelayUnit(e.target.value)}><option value="minutes">min</option><option value="hours">hours</option><option value="days">days</option></select>
          <button onClick={add} disabled={saving} className="ml-auto px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save</button>
        </div>
      </section>

      <div className="space-y-2">
        {list.map(a => (
          <div key={a.id} className="bg-white rounded-card border border-line p-4 flex items-center justify-between">
            <div><p className="text-sm font-semibold text-brand-dark">{a.autoSendTrigger}{a.triggerKey ? ` · ${a.triggerKey}` : ""}</p><p className="text-[11px] text-slate-400 font-mono">{a.templateName} · after {a.delayValue} {a.delayUnit}</p></div>
            <button onClick={() => disable(a.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        {list.length === 0 && <p className="text-center text-slate-400 text-sm py-6">No automations yet.</p>}
      </div>
    </div>
  );
}

export default BroadcastTab;
