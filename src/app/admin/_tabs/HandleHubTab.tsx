"use client";

// Handle Hub tab — one branded WhatsApp entry point surfaced everywhere as
// per-source tracked links + QR codes, so every chat's origin is attributed.
import { useState, useEffect, useCallback } from "react";
import { inp, RailCard, StatRow } from "../_shared";

interface Source {
  id: string; label: string; refCode: string; kind: string; touches: number;
  lastTouchAt: string | null; createdAt: string; link: string | null; qr: string | null;
}
interface Config { number: string; handle: string; greeting: string }

function HandleHubTab() {
  const [config, setConfig] = useState<Config>({ number: "", handle: "", greeting: "" });
  const [sources, setSources] = useState<Source[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("qr");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/handle-hub").then(r => r.json()).then(d => {
      if (d.config) setConfig(d.config);
      setSources(d.sources ?? []);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) });
    setSaved(true); setTimeout(() => setSaved(false), 1500); load();
  }
  async function addSource() {
    if (!label.trim()) return;
    await fetch("/api/admin/handle-hub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label.trim(), kind }) });
    setLabel(""); load();
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Delete the "${name}" source? Its links/QRs will stop being attributed.`)) return;
    await fetch(`/api/admin/handle-hub?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  }
  function copy(link: string, id: string) {
    navigator.clipboard?.writeText(link).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  }

  const totalTouches = sources.reduce((n, s) => n + (s.touches || 0), 0);

  return (
    <div className="flex gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-2xl space-y-5">
        <div>
          <h2 className="text-xl font-extrabold text-brand-dark">Handle Hub</h2>
          <p className="text-sm text-slate-500">One branded WhatsApp entry point for every channel — with a tracked link + QR per source, so you know exactly which QR, ad, or post started each conversation.</p>
        </div>

        {/* Entry point config */}
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-sm font-bold text-ink-900">Your entry point</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-500">WhatsApp number (with country code)</span>
              <input className={`${inp} w-full mt-1`} placeholder="919555219007" value={config.number} onChange={e => setConfig({ ...config, number: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-500">@handle <span className="text-slate-400">(display; used once WhatsApp usernames are live)</span></span>
              <input className={`${inp} w-full mt-1`} placeholder="yourbrand" value={config.handle} onChange={e => setConfig({ ...config, handle: e.target.value })} />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] text-slate-500">Prefilled greeting (what the customer&apos;s first message says)</span>
            <input className={`${inp} w-full mt-1`} placeholder="Hi! I'd like to know more." value={config.greeting} onChange={e => setConfig({ ...config, greeting: e.target.value })} />
          </label>
          <button onClick={saveConfig} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold">{saved ? "Saved ✓" : "Save entry point"}</button>
          {!config.number && <p className="text-[11px] text-amber-600">Add your WhatsApp number to generate tracked links + QR codes.</p>}
        </div>

        {/* Add a source */}
        <div className="bg-white rounded-card border border-line p-4 space-y-3">
          <p className="text-sm font-bold text-ink-900">Add a source</p>
          <div className="flex gap-2">
            <input className={`${inp} flex-1`} placeholder='Where it lives — e.g. "Instagram bio", "Store counter QR", "Diwali ad"' value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addSource(); }} />
            <select className={`${inp}`} value={kind} onChange={e => setKind(e.target.value)}>
              <option value="qr">QR</option>
              <option value="link">Link</option>
              <option value="bio">Bio</option>
              <option value="ad">Ad</option>
              <option value="other">Other</option>
            </select>
            <button onClick={addSource} className="px-4 py-2 rounded-lg bg-brand-700 text-white text-sm font-bold shrink-0">Add</button>
          </div>
          <p className="text-[11px] text-slate-400">The name becomes the <b>CRM lead Source</b> for new leads from this link — for paid WhatsApp ads, name it exactly as your dashboard filters on (e.g. <span className="font-mono">ppc-whatsapp</span>).</p>
        </div>

        {/* Sources */}
        <div className="space-y-3">
          {sources.map(s => (
            <div key={s.id} className="bg-white rounded-card border border-line p-4 flex gap-4 items-start">
              {s.qr
                ? <a href={s.qr} download={`handle-${s.label.replace(/\s+/g, "-").toLowerCase()}.png`} title="Download QR"><img src={s.qr} alt="QR" className="w-24 h-24 rounded-lg border border-line shrink-0" /></a>
                : <div className="w-24 h-24 rounded-lg border border-dashed border-line grid place-items-center text-[10px] text-slate-400 text-center shrink-0">Add a number to generate QR</div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-ink-900 truncate">{s.label}</p>
                  <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{s.kind}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{s.touches} chat{s.touches === 1 ? "" : "s"} started{s.lastTouchAt ? ` · last ${new Date(s.lastTouchAt).toLocaleDateString()}` : ""}</p>
                {s.link
                  ? <div className="flex items-center gap-2 mt-2">
                      <input readOnly value={s.link} className="text-[11px] font-mono bg-slate-50 border border-line rounded px-2 py-1 flex-1 min-w-0 text-slate-600" onFocus={e => e.currentTarget.select()} />
                      <button onClick={() => copy(s.link!, s.id)} className="text-xs font-bold text-brand-700 hover:underline shrink-0">{copied === s.id ? "Copied ✓" : "Copy"}</button>
                    </div>
                  : <p className="text-[11px] text-amber-600 mt-2">Set your number above to activate this link.</p>}
              </div>
              <button onClick={() => remove(s.id, s.label)} className="text-xs text-red-500 hover:underline shrink-0">Delete</button>
            </div>
          ))}
          {sources.length === 0 && <p className="text-center text-slate-400 text-sm py-6 bg-white rounded-card border border-line">No sources yet — add one above to get a tracked link + QR you can put anywhere.</p>}
        </div>
      </div>

      <aside className="hidden xl:flex flex-col gap-4 w-80 shrink-0">
        <RailCard title="At a glance">
          <StatRow label="Sources" value={sources.length} />
          <StatRow label="Chats attributed" value={totalTouches} />
        </RailCard>
        <RailCard title="How it works">
          <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
            <li>Each source gets a unique <b>click-to-chat link + QR</b> pointing at your WhatsApp.</li>
            <li>The link carries a hidden code in the prefilled message. When the customer sends it, we tag their contact with the <b>source</b> and count the touch.</li>
            <li>New leads from a source are created in your <b>CRM under that source&apos;s name</b> — so name a paid-ad source exactly as your report expects (e.g. <span className="font-mono">ppc-whatsapp</span>). Organic chats stay <span className="font-mono">WhatsApp</span>.</li>
            <li>Put each QR/link where it belongs — bio, ads, packaging, email footer — and see which one actually drives chats.</li>
          </ul>
        </RailCard>
        <RailCard title="Coming with WhatsApp usernames">
          <ul className="space-y-1.5 text-[11px] text-slate-500 list-disc pl-4">
            <li>Your <b>@handle</b> becomes the front of every link — no phone number exposed.</li>
            <li>Leads who hide their number still sync to your CRM, matched by handle.</li>
          </ul>
        </RailCard>
      </aside>
    </div>
  );
}

export default HandleHubTab;
