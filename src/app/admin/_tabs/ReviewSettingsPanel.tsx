"use client";

// Review settings: when AI replies may post on their own, which topics always
// wait for a person (with a preview on sample reviews — nothing is posted),
// and who hears about new reviews, complaints and problems.

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { inp } from "../_shared";

type HoldCategory = "billing" | "safety" | "legal" | "personal_info" | "strong_complaint";
type AlertKind = "new_review" | "needs_approval" | "complaint" | "post_failed" | "reauth" | "sync_failing" | "overdue";
export interface ReviewSettingsValue {
  autoMinStars: number; signature: string; tone: string;
  holdFor: Record<HoldCategory, boolean>;
  alerts: { email: boolean; recipients: string[]; events: Record<AlertKind, boolean>; unansweredHours: number };
}

const TOPICS: { key: HoldCategory; label: string; hint: string }[] = [
  { key: "billing", label: "Refunds, billing disputes or overcharging", hint: "“charged twice”, “want my money back”" },
  { key: "safety", label: "Injury, safety or a serious service failure", hint: "“got sick”, “allergic reaction”, “cockroach”" },
  { key: "legal", label: "Legal threats or allegations", hint: "“consumer court”, “fraud”, “police”" },
  { key: "personal_info", label: "Personal or sensitive information", hint: "a phone number, email or medical details" },
  { key: "strong_complaint", label: "Strong complaints, even with 4–5 stars", hint: "“rude staff”, “never again”" },
];
const ALERTS: { key: AlertKind; label: string }[] = [
  { key: "new_review", label: "A new review arrives" },
  { key: "needs_approval", label: "A reply is waiting for approval" },
  { key: "complaint", label: "A complaint needs attention" },
  { key: "post_failed", label: "A reply couldn't be posted to Google" },
  { key: "reauth", label: "Google access expired or was revoked" },
  { key: "sync_failing", label: "Reviews keep failing to sync" },
  { key: "overdue", label: "A review stays unanswered" },
];
const SAMPLES = [
  { rating: 5, text: "Loved the biryani and the staff were so warm. Will come again!" },
  { rating: 5, text: "Great food but I was charged twice on my card, please refund." },
  { rating: 4, text: "Nice place, though the receptionist was rude to my mother." },
  { rating: 2, text: "Waited 40 minutes for a table that was booked." },
];

export function ReviewSettingsPanel({ value, signaturePlaceholder, emailAvailable, saving, onSave, onCancel }: {
  value: ReviewSettingsValue; signaturePlaceholder: string; emailAvailable: boolean; saving: boolean;
  onSave: (v: ReviewSettingsValue) => void; onCancel: () => void;
}) {
  const [f, setF] = useState<ReviewSettingsValue>(value);
  const [recipients, setRecipients] = useState(value.alerts.recipients.join(", "));
  const [sample, setSample] = useState(SAMPLES[1]);
  const [preview, setPreview] = useState<null | { autoPost: boolean; reasons: string[]; reply: string | null; aiNote: string | null; note: string | null }>(null);
  const [previewing, setPreviewing] = useState<"rules" | "ai" | null>(null);

  async function runPreview(withAi: boolean) {
    setPreviewing(withAi ? "ai" : "rules"); setPreview(null);
    try {
      const r = await fetch("/api/admin/reviews/policy-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...sample, withAi, autoMinStars: f.autoMinStars, holdFor: f.holdFor }) });
      const d = await r.json().catch(() => ({}));
      setPreview(r.ok ? d : { autoPost: false, reasons: [d.error || "Preview isn't available right now."], reply: null, aiNote: null, note: null });
    } finally { setPreviewing(null); }
  }

  const save = () => onSave({ ...f, alerts: { ...f.alerts, recipients: recipients.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean) } });

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Replies</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-ink-700 space-y-1 block">
            Post AI replies on their own for
            <select className={`${inp} w-full`} value={f.autoMinStars} onChange={e => setF({ ...f, autoMinStars: Number(e.target.value) })}>
              <option value={5}>5★ only</option>
              <option value={4}>4★ and up (recommended)</option>
              <option value={3}>3★ and up</option>
              <option value={6}>Never — I approve every reply</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-ink-700 space-y-1 block">
            Signature (optional)
            <input className={`${inp} w-full`} placeholder={signaturePlaceholder} maxLength={120} value={f.signature} onChange={e => setF({ ...f, signature: e.target.value })} />
          </label>
        </div>
        <label className="text-xs font-semibold text-ink-700 space-y-1 block">
          Tone and brand voice (optional)
          <textarea className={`${inp} w-full`} rows={2} maxLength={600} placeholder="e.g. Warm and friendly, mention our chef's name, keep it short" value={f.tone} onChange={e => setF({ ...f, tone: e.target.value })} />
        </label>
        <p className="text-[12px] text-ink-500">Only reviews from the last 7 days get an automatic reply. Older reviews brought in from Google wait for you to write or generate one.</p>
      </section>

      <section className="space-y-2 border-t border-line pt-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Always ask me first when a review mentions</h3>
        <p className="text-[12px] text-ink-500">Even a 5★ reply waits for your approval when the review raises one of these. If Talko can&apos;t read a review clearly, it always waits.</p>
        {TOPICS.map(t => (
          <label key={t.key} className="flex items-start gap-2.5 text-[13px] text-ink-700 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-brand-700" checked={f.holdFor[t.key]} onChange={e => setF({ ...f, holdFor: { ...f.holdFor, [t.key]: e.target.checked } })} />
            <span><b>{t.label}</b> <span className="text-ink-500">— e.g. {t.hint}</span></span>
          </label>
        ))}
        <div className="rounded-control border border-line bg-canvas/60 p-3 space-y-2">
          <p className="text-[12px] font-bold text-ink-700">Try it on a sample review — nothing is posted</p>
          <div className="flex flex-wrap gap-1.5">
            {SAMPLES.map((s, i) => (
              <button key={i} type="button" onClick={() => { setSample(s); setPreview(null); }} className={`px-2 py-1 rounded-full text-[11px] font-bold border ${sample === s ? "bg-ink-900 text-white border-ink-900" : "bg-white border-line text-ink-600"}`}>{s.rating}★ sample {i + 1}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <select aria-label="Sample rating" className={`${inp} w-20`} value={sample.rating} onChange={e => { setSample({ ...sample, rating: Number(e.target.value) }); setPreview(null); }}>
              {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}★</option>)}
            </select>
            <textarea aria-label="Sample review text" className={`${inp} flex-1`} rows={2} value={sample.text} onChange={e => { setSample({ ...sample, text: e.target.value }); setPreview(null); }} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => runPreview(false)} disabled={!!previewing} className="px-3 py-1.5 rounded-control border border-line bg-white text-xs font-bold text-ink-700 disabled:opacity-60">{previewing === "rules" && <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />}Check the rules</button>
            <button type="button" onClick={() => runPreview(true)} disabled={!!previewing} className="px-3 py-1.5 rounded-control bg-brand-50 border border-brand-100 text-brand-700 text-xs font-bold disabled:opacity-60 inline-flex items-center gap-1">{previewing === "ai" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Also draft a sample AI reply</button>
          </div>
          {preview && (
            <div className={`rounded-control border px-3 py-2 text-[12px] ${preview.autoPost ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="status">
              <p className="font-bold">{preview.autoPost ? "This reply would post on its own." : "This reply would wait for your approval."}</p>
              {preview.reasons.length > 0 && <ul className="list-disc ml-4">{preview.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
              {preview.note && <p className="mt-1 text-ink-600">{preview.note}</p>}
              {preview.aiNote && <p className="mt-1">{preview.aiNote}</p>}
              {preview.reply && <p className="mt-2 rounded-control bg-white border border-line px-2 py-1.5 text-ink-800 whitespace-pre-wrap"><span className="block text-[10px] font-bold text-ink-500 uppercase">Sample AI reply</span>{preview.reply}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2 border-t border-line pt-4">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Alerts</h3>
        <p className="text-[12px] text-ink-500">Alerts appear in the bell for admins. Choose what you want to hear about:</p>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {ALERTS.map(a => (
            <label key={a.key} className="flex items-center gap-2 text-[13px] text-ink-700 cursor-pointer">
              <input type="checkbox" className="accent-brand-700" checked={f.alerts.events[a.key]} onChange={e => setF({ ...f, alerts: { ...f.alerts, events: { ...f.alerts.events, [a.key]: e.target.checked } } })} /> {a.label}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12px] text-ink-700">
          Count a review as unanswered after
          <input type="number" min={1} max={336} className={`${inp} w-20`} value={f.alerts.unansweredHours} onChange={e => setF({ ...f, alerts: { ...f.alerts, unansweredHours: Number(e.target.value) } })} /> hours
        </label>
        {emailAvailable ? <>
          <label className="flex items-center gap-2 text-[13px] text-ink-700 cursor-pointer">
            <input type="checkbox" className="accent-brand-700" checked={f.alerts.email} onChange={e => setF({ ...f, alerts: { ...f.alerts, email: e.target.checked } })} /> Also email these alerts
          </label>
          {f.alerts.email && (
            <label className="text-xs font-semibold text-ink-700 space-y-1 block">
              Send to (leave empty for every admin)
              <input className={`${inp} w-full`} placeholder="owner@business.in, manager@business.in" value={recipients} onChange={e => setRecipients(e.target.value)} />
            </label>
          )}
        </> : <p className="text-[12px] text-amber-800">Email alerts aren&apos;t available yet. Alerts still show in the bell.</p>}
      </section>

      <div className="flex items-center gap-2 border-t border-line pt-4">
        <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-60">{saving ? "Saving…" : "Save settings"}</button>
        <button onClick={onCancel} className="px-2 py-1.5 text-xs font-semibold text-ink-400 hover:text-ink-900">Cancel</button>
      </div>
    </div>
  );
}
