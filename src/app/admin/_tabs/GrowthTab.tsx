"use client";

// Growth tools tab — extracted from admin/page.tsx, lazy-loaded.
import dynamic from "next/dynamic";
import { PageInfo } from "@/components/PageInfo";
import { useState, useEffect, useCallback } from "react";
import { useVocab } from "@/lib/vocab-client";
import { Copy, Plus, Trash2, TrendingUp, Download, Sparkles, Lightbulb } from "lucide-react";
import { inp, EmptyState } from "../_shared";
import { toast } from "@/components/toast";
import { Modal } from "@/components/overlay";
import { fmtNum } from "@/lib/format";
import { useConfirm } from "@/components/confirm-dialog";

// ── Growth tools ──────────────────────────────────────────────────────────────
type GrowthRow = { id: string; name: string; kind: string; slug: string; prefill: string | null; tag: string | null; sequenceId: string | null; config: { number?: string; url?: string; igUsername?: string }; clicks: number; conversions: number; active: boolean };
const GROWTH_KINDS: [string, string][] = [["ref_link", "Referral link"], ["qr", "QR code"], ["widget_popup", "Website popup"], ["widget_bar", "Website bar"], ["landing", "Landing page"]];
const EMPTY_GROWTH = { id: undefined as string | undefined, name: "", kind: "ref_link", slug: "", prefill: "", number: "", igUsername: "", url: "", tag: "", sequenceId: "", active: true };

function GrowthLinks() {
  const { vocab } = useVocab();
  const ask = useConfirm();
  const [tools, setTools] = useState<GrowthRow[]>([]);
  const [seqs, setSeqs] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<typeof EMPTY_GROWTH | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const load = useCallback(() => { fetch("/api/admin/growth").then(r => r.json()).then(d => setTools(d.tools ?? [])).catch(() => {}); }, []);
  useEffect(() => { load(); setOrigin(window.location.origin); }, [load]);
  useEffect(() => { fetch("/api/admin/sequences").then(r => r.json()).then(d => setSeqs((d.sequences ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })))).catch(() => {}); }, []);

  async function save() {
    if (!form) return;
    if (!form.name.trim() || !form.slug.trim()) { setMsg(!form.name.trim() ? "Give the tool a name." : "Choose the short link name (the part after /g/)."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/growth", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name: form.name, kind: form.kind, slug: form.slug, prefill: form.prefill || null, tag: form.tag || null, sequenceId: form.sequenceId || null, config: { number: form.number || undefined, igUsername: form.igUsername || undefined, url: form.url || undefined }, active: form.active }) });
      const d = await res.json();
      if (!res.ok) setMsg(d.error || "Couldn't save. Please try again."); else { toast(`“${form.name.trim()}” saved`); setForm(null); load(); }
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!(await ask({ title: "Delete this growth tool?", tone: "danger", confirmLabel: "Delete tool", message: "Its link and QR code stop working. People who already opted in keep their tags." }))) return;
    const r = await fetch("/api/admin/growth", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    if (r?.ok) toast("Growth tool deleted"); else toast({ text: "Couldn't delete it. Please try again.", tone: "error" });
    load();
  }

  const copyLink = (link: string) => { navigator.clipboard?.writeText(link).then(() => toast("Link copied")).catch(() => toast({ text: "Couldn't copy — select the link and copy it yourself.", tone: "error" })); };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Growth Tools</h2><PageInfo className="text-sm text-slate-500" lead={<>Links and QR codes for your bio, posters and ads that open a WhatsApp or Instagram chat with a message already typed</>}>When the person sends that message, they&apos;re tagged and can be started on a follow-up sequence automatically.</PageInfo>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_GROWTH }); setMsg(null); }} className="shrink-0 min-h-9 px-3 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New tool</button>
      </div>

      {/* How a growth tool actually works — the 3-step opt-in chain. */}
      <div className="bg-brand-50/60 border border-brand-700/15 rounded-card p-4 text-[12px] text-ink-700 space-y-1.5">
        <p className="font-bold text-ink-900 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-brand-700" /> How a growth tool works</p>
        <p><b>1. Share the link or QR.</b> Every tool is one short link <span className="font-mono">{origin || "…"}/g/your-name</span> (and a matching QR). Put it in a bio, ad, poster or email.</p>
        <p><b>2. It opens WhatsApp/Instagram pre-filled.</b> Clicking it sends the person into a chat with your <b>opt-in message</b> already typed (from the WhatsApp number, IG username, or custom URL you set).</p>
        <p><b>3. When they hit send, we act.</b> We spot the opt-in message, <b>tag</b> them, <b>start</b> the sequence you chose, and count it as a sign-up. Capital letters don&apos;t matter and extra words around it are fine, so keep the opt-in text <b>distinctive</b> (e.g. <span className="font-mono">GET GUIDE</span>, not <span className="font-mono">hi</span>).</p>
        <p className="text-ink-500">The <b>Type</b> dropdown is just a label for you — every type produces the same link + QR.</p>
      </div>

      {tools.map(t => {
        const dest = t.config?.url ? t.config.url : t.config?.number ? `wa.me/${t.config.number.replace(/\D/g, "")}` : t.config?.igUsername ? `ig.me/${t.config.igUsername.replace(/^@/, "")}` : "no destination set";
        return (
        <div key={t.id} className="bg-white rounded-card border border-line p-3 flex flex-wrap items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0"><TrendingUp className="w-4 h-4" /></div>
          {/* On a phone the buttons wrap under the name instead of squeezing it. */}
          <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-2.75rem)]">
            <p className="text-sm font-semibold text-ink-900 truncate">{t.name} <span className="text-[11px] font-bold text-ink-500">· {GROWTH_KINDS.find(k => k[0] === t.kind)?.[1] ?? t.kind}</span></p>
            <p className="text-[11px] text-ink-500 break-words sm:truncate"><span className="font-mono">{origin}/g/{t.slug}</span> → {dest} · {fmtNum(t.clicks)} clicks · {fmtNum(t.conversions)} signed up{!t.active ? " · switched off" : ""}</p>
          </div>
          <button onClick={() => copyLink(`${origin}/g/${t.slug}`)} aria-label={`Copy the link for ${t.name}`} className="min-h-8 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 flex items-center gap-1"><Copy className="w-3 h-3" /> Link</button>
          <a href={`/api/admin/growth/qr?slug=${encodeURIComponent(t.slug)}`} download={`qr-${t.slug}.png`} aria-label={`Download the QR code for ${t.name}`} className="min-h-8 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0 flex items-center gap-1"><Download className="w-3 h-3" /> QR</a>
          <button onClick={() => setForm({ id: t.id, name: t.name, kind: t.kind, slug: t.slug, prefill: t.prefill ?? "", number: t.config?.number ?? "", igUsername: t.config?.igUsername ?? "", url: t.config?.url ?? "", tag: t.tag ?? "", sequenceId: t.sequenceId ?? "", active: t.active })} className="min-h-8 px-2.5 py-1 rounded-control border border-line text-xs font-bold text-ink-600 hover:bg-canvas shrink-0">Edit</button>
          <button onClick={() => remove(t.id)} aria-label={`Delete ${t.name}`} className="grid place-items-center w-9 h-9 text-ink-400 hover:text-red-600 hover:bg-red-50 rounded-lg shrink-0"><Trash2 className="w-4 h-4" /></button>
        </div>
        );
      })}
      {!tools.length && !form && (
        <div className="bg-white rounded-card border border-line">
          <EmptyState mood="sleeping" title="No growth tools yet"
            body="Make a link or QR code for your Instagram bio, a shop poster or an ad. People who use it land in your chat with a message ready to send — and you see how many came from each one."
            action={<button onClick={() => { setForm({ ...EMPTY_GROWTH }); setMsg(null); }} className="min-h-10 px-4 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-sm font-bold inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Make your first tool</button>} />
        </div>
      )}

      {/* The shared Modal: a titled dialog that closes on Escape and keeps Tab inside. */}
      <Modal open={!!form} onClose={() => setForm(null)} size="lg" title={form?.id ? "Edit growth tool" : "New growth tool"}>
        {form && (<div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className={inp} aria-label="Name" placeholder="Name (only you see this)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <select className={inp} aria-label="Type" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{GROWTH_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <input className={inp} aria-label="Short link name" placeholder="Short link name, e.g. diwali (the part after /g/)" value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
            <input className={inp} aria-label="Message typed for them" placeholder="Message typed for them (e.g. GET GUIDE)" value={form.prefill} onChange={e => setForm({ ...form, prefill: e.target.value })} />
            <input className={inp} aria-label="WhatsApp number" inputMode="tel" placeholder="WhatsApp number (e.g. 9198…)" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} />
            <input className={inp} aria-label="Instagram username" placeholder="…or Instagram username" value={form.igUsername} onChange={e => setForm({ ...form, igUsername: e.target.value })} />
            <input className={`${inp} sm:col-span-2`} aria-label="Web address" placeholder="…or any web address (used instead of the above)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
            <input className={inp} aria-label="Tag (optional)" placeholder={`Tag the ${vocab.contact.one.toLowerCase()} when they sign up (optional)`} value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} />
            <select className={inp} aria-label={`Start a ${vocab.sequence.one.toLowerCase()}`} value={form.sequenceId} onChange={e => setForm({ ...form, sequenceId: e.target.value })}>
              <option value="">Start a {vocab.sequence.one.toLowerCase()}: none</option>
              {seqs.map(s => <option key={s.id} value={s.id}>Start: {s.name}</option>)}
            </select>
          </div>
          <p className="text-[12px] text-ink-500">Set <b>one</b> place to send people — a WhatsApp number, an Instagram username, <i>or</i> a web address. The <b>message typed for them</b> is what we look for when they send it, so make it distinctive. To send follow-up messages after they sign up, pick a {vocab.sequence.one.toLowerCase()} above.</p>

          {/* Shareable link + QR for the saved tool */}
          {form.id && form.slug ? (
            <div className="flex items-center gap-3 bg-canvas border border-line rounded-control p-3">
              <img src={`/api/admin/growth/qr?slug=${encodeURIComponent(form.slug)}`} alt="QR code" className="w-24 h-24 rounded bg-white border border-line shrink-0" />
              <div className="min-w-0 space-y-1.5">
                <p className="text-[11px] font-semibold text-ink-500">Share this link or QR</p>
                <code className="block truncate text-[11px] font-mono text-ink-700">{origin}/g/{form.slug}</code>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => copyLink(`${origin}/g/${form.slug}`)} className="whitespace-nowrap min-h-8 px-2.5 py-1 rounded-control border border-line text-[12px] font-bold text-ink-600 hover:bg-white flex items-center gap-1"><Copy className="w-3 h-3" /> Copy link</button>
                  <a href={`/api/admin/growth/qr?slug=${encodeURIComponent(form.slug)}`} download={`qr-${form.slug}.png`} className="whitespace-nowrap min-h-8 px-2.5 py-1 rounded-control border border-line text-[12px] font-bold text-ink-600 hover:bg-white flex items-center gap-1"><Download className="w-3 h-3" /> Download QR</a>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-ink-500 inline-flex items-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> Save the tool to generate its shareable link + QR code.</p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-ink-600 cursor-pointer"><input type="checkbox" className="accent-brand-700" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Switched on</label>
            <div className="flex-1" />
            <button onClick={save} disabled={busy} className="min-h-10 px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{busy ? "Saving…" : "Save tool"}</button>
            <button onClick={() => setForm(null)} className="min-h-10 px-2 py-1.5 text-xs font-semibold text-ink-500 hover:text-ink-900">Cancel</button>
          </div>
          {msg && <p role="alert" className="text-xs text-red-700">{msg}</p>}
        </div>)}
      </Modal>
    </div>
  );
}

const SocialGrowthTab = dynamic(() => import("./SocialGrowthTab"), { ssr: false });
function GrowthTab() {
  const [section, setSection] = useState<"social" | "links">("social");
  return <div className="space-y-5"><nav aria-label="Growth tools" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
    <button onClick={() => setSection("social")} aria-pressed={section === "social"} className={`min-h-10 rounded-control px-2 sm:px-4 py-2 text-[13px] leading-tight sm:text-sm font-semibold ${section === "social" ? "bg-ink-900 text-white" : "border border-line"}`}>Social Growth & Creators</button>
    <button onClick={() => setSection("links")} aria-pressed={section === "links"} className={`min-h-10 rounded-control px-2 sm:px-4 py-2 text-[13px] leading-tight sm:text-sm font-semibold ${section === "links" ? "bg-ink-900 text-white" : "border border-line"}`}>Links, QR & opt-in tools</button>
  </nav>{section === "social" ? <SocialGrowthTab /> : <GrowthLinks />}</div>;
}
export default GrowthTab;
