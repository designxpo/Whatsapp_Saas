"use client";

// One location's own review settings. A location uses the workspace's settings
// until someone gives it its own; each field it sets replaces the workspace's
// for that location only. Saved on its own, separately from the workspace form.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { inp } from "../_shared";
import { toast } from "@/components/toast";
import { BUSINESS_PRESETS, BUSINESS_TYPES, LANGUAGE_LABELS, type BusinessType, type ReplyLanguage } from "@/lib/review-presets";

interface Overridable {
  autoMinStars: number; signature: string; tone: string;
  businessType: BusinessType; businessDescription: string; replyGuidance: string; supportContact: string; language: ReplyLanguage;
}

export function LocationSettings({ locations, workspace }: { locations: { id: string; name: string }[]; workspace: Overridable }) {
  const [id, setId] = useState(locations[0]?.id ?? "");
  const [own, setOwn] = useState(false);
  const [f, setF] = useState<Overridable>(workspace);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true); setNote(null);
    fetch(`/api/admin/reviews/location-settings?channelId=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => {
        const o = (d.overrides ?? {}) as Partial<Overridable>;
        setOwn(Object.keys(o).length > 0);
        setF({ ...workspace, ...o });
      })
      .catch(() => setNote({ ok: false, text: "Couldn't load this location's settings." }))
      .finally(() => setLoading(false));
    // workspace values are the starting point only when a location is picked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    setSaving(true); setNote(null);
    try {
      const r = await fetch("/api/admin/reviews/location-settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: id, overrides: own ? f : null }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setNote(null); toast(own ? `Saved for ${locations.find(l => l.id === id)?.name ?? "this location"}` : "This location now uses your main review settings"); }
      else setNote({ ok: false, text: d.error || "Couldn't save. Please try again." });
    } finally { setSaving(false); }
  }

  const name = locations.find(l => l.id === id)?.name ?? "this location";
  return (
    <div className="space-y-4">
      <label className="block space-y-2 text-xs font-semibold text-ink-700">
        <span>Location</span>
        <select className={`${inp} w-full`} value={id} onChange={e => setId(e.target.value)}>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {loading ? <p className="text-xs text-ink-500 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p> : <>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1" role="radiogroup" aria-label={`Settings for ${name}`}>
          <button type="button" role="radio" aria-checked={!own} onClick={() => setOwn(false)} className={`rounded-lg px-2 py-2 text-xs font-semibold ${!own ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"}`}>Use workspace settings</button>
          <button type="button" role="radio" aria-checked={own} onClick={() => setOwn(true)} className={`rounded-lg px-2 py-2 text-xs font-semibold ${own ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"}`}>Its own settings</button>
        </div>
        {own && (
          <div className="space-y-4">
            <label className="block space-y-2 text-xs font-semibold text-ink-700">
              <span>Automatic replies</span>
              <select className={`${inp} w-full`} value={f.autoMinStars} onChange={e => setF({ ...f, autoMinStars: Number(e.target.value) })}>
                <option value={5}>5-star reviews only</option><option value={4}>4- and 5-star reviews</option><option value={3}>3-star reviews and above</option><option value={6}>Off — approve every reply</option>
              </select>
            </label>
            <label className="block space-y-2 text-xs font-semibold text-ink-700">
              <span>Kind of business</span>
              <select className={`${inp} w-full`} value={f.businessType} onChange={e => { const t = e.target.value as BusinessType; setF({ ...f, businessType: t, replyGuidance: BUSINESS_PRESETS[t].guidance }); }}>
                {BUSINESS_TYPES.map(t => <option key={t} value={t}>{BUSINESS_PRESETS[t].label}</option>)}
              </select>
            </label>
            <label className="block space-y-2 text-xs font-semibold text-ink-700">
              <span>About this location</span>
              <textarea className={`${inp} w-full`} rows={2} maxLength={400} placeholder={BUSINESS_PRESETS[f.businessType].describe} value={f.businessDescription} onChange={e => setF({ ...f, businessDescription: e.target.value })} />
            </label>
            <label className="block space-y-2 text-xs font-semibold text-ink-700">
              <span>Reply guidance</span>
              <textarea className={`${inp} w-full`} rows={3} maxLength={800} value={f.replyGuidance} onChange={e => setF({ ...f, replyGuidance: e.target.value })} />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block space-y-2 text-xs font-semibold text-ink-700">
                <span>Sign-off</span>
                <input className={`${inp} w-full`} maxLength={120} value={f.signature} onChange={e => setF({ ...f, signature: e.target.value })} />
              </label>
              <label className="block space-y-2 text-xs font-semibold text-ink-700">
                <span>Reply language</span>
                <select className={`${inp} w-full`} value={f.language} onChange={e => setF({ ...f, language: e.target.value as ReplyLanguage })}>
                  {(Object.keys(LANGUAGE_LABELS) as ReplyLanguage[]).map(l => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
                </select>
              </label>
            </div>
            <label className="block space-y-2 text-xs font-semibold text-ink-700">
              <span>Contact for customers with a problem</span>
              <input className={`${inp} w-full`} maxLength={120} value={f.supportContact} onChange={e => setF({ ...f, supportContact: e.target.value })} />
            </label>
            <label className="block space-y-2 text-xs font-semibold text-ink-700">
              <span>Brand voice</span>
              <textarea className={`${inp} w-full`} rows={2} maxLength={600} value={f.tone} onChange={e => setF({ ...f, tone: e.target.value })} />
            </label>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving || !id} title={!id ? "Choose a location first" : undefined} className="min-h-10 rounded-control bg-ink-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : `Save for ${name}`}</button>
          {note && <span className={`text-xs ${note.ok ? "text-emerald-700" : "text-red-700"}`} role="status">{note.text}</span>}
        </div>
        <p className="text-[11px] text-ink-500">Approval topics and alerts are set for the whole workspace.</p>
      </>}
    </div>
  );
}
