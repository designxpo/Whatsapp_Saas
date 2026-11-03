"use client";

// Review settings: when AI replies may post on their own, which topics always
// wait for a person (with a preview on sample reviews — nothing is posted),
// and who hears about new reviews, complaints and problems.

import { useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
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

export function ReviewSettingsPanel({ value, signaturePlaceholder, emailAvailable, saving, onSave, onCancel, showActions = true }: {
  value: ReviewSettingsValue; signaturePlaceholder: string; emailAvailable: boolean; saving: boolean;
  onSave: (v: ReviewSettingsValue) => void; onCancel: () => void; showActions?: boolean;
}) {
  const [section, setSection] = useState<"replies" | "approval" | "alerts">("replies");
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
    <form id="review-settings-form" noValidate onSubmit={e => { e.preventDefault(); save(); }} className="space-y-6">
      <nav aria-label="Review settings sections" className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
        {([{ key: "replies", label: "Replies" }, { key: "approval", label: "Approval rules" }, { key: "alerts", label: "Alerts" }] as const).map(item => (
          <button key={item.key} type="button" aria-pressed={section === item.key} onClick={() => setSection(item.key)}
            className={`rounded-lg px-2 py-2.5 text-xs font-semibold transition-colors ${section === item.key ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-900"}`}>
            {item.label}
          </button>
        ))}
      </nav>

      <section hidden={section !== "replies"} className="space-y-5">
        <div><h3 className="text-sm font-bold text-ink-900">Reply preferences</h3><p className="mt-1 text-xs text-ink-500">Choose when to post and how your business sounds.</p></div>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>Automatic replies</span>
          <select className={`${inp} w-full`} value={f.autoMinStars} onChange={e => { setF({ ...f, autoMinStars: Number(e.target.value) }); setPreview(null); }}>
            <option value={5}>5-star reviews only</option>
            <option value={4}>4- and 5-star reviews</option>
            <option value={3}>3-star reviews and above</option>
            <option value={6}>Off — approve every reply</option>
          </select>
        </label>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>Sign-off <span className="font-normal text-ink-400">· optional</span></span>
          <input className={`${inp} w-full`} placeholder={signaturePlaceholder} maxLength={120} value={f.signature} onChange={e => setF({ ...f, signature: e.target.value })} />
        </label>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>Brand voice <span className="font-normal text-ink-400">· optional</span></span>
          <textarea className={`${inp} w-full`} rows={3} maxLength={600} placeholder="Warm, friendly and concise." value={f.tone} onChange={e => setF({ ...f, tone: e.target.value })} />
        </label>
        <p className="rounded-xl bg-canvas px-4 py-3 text-xs leading-relaxed text-ink-500">Automatic replies apply to reviews from the last 7 days. Older reviews and anything flagged by your approval rules wait for you.</p>
      </section>

      <section hidden={section !== "approval"} className="space-y-4">
        <div><h3 className="text-sm font-bold text-ink-900">Always ask for approval</h3><p className="mt-1 text-xs leading-relaxed text-ink-500">These topics need your review, even with 5 stars. Unclear reviews always wait.</p></div>
        <div className="divide-y divide-line rounded-xl border border-line px-4">
          {TOPICS.map(t => (
            <label key={t.key} title={`Examples: ${t.hint}`} className="flex cursor-pointer items-center justify-between gap-4 py-3.5 text-[13px] text-ink-700">
              <span>{t.label}</span>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand-700" checked={f.holdFor[t.key]} onChange={e => { setF({ ...f, holdFor: { ...f.holdFor, [t.key]: e.target.checked } }); setPreview(null); }} />
            </label>
          ))}
        </div>
        <details className="group rounded-xl border border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-xs font-semibold text-ink-700 [&::-webkit-details-marker]:hidden">Test your rules <ChevronDown className="h-4 w-4 text-ink-400 transition-transform group-open:rotate-180" /></summary>
          <div className="space-y-3 px-4 pb-4">
            <p className="text-xs text-ink-500">Use a sample review. Nothing is posted.</p>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLES.map((s, i) => (
                <button key={i} type="button" onClick={() => { setSample(s); setPreview(null); }} className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold ${sample === s ? "bg-ink-900 text-white border-ink-900" : "bg-white border-line text-ink-600"}`}>{s.rating}★ sample {i + 1}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <select aria-label="Sample rating" className={`${inp} w-20 shrink-0`} value={sample.rating} onChange={e => { setSample({ ...sample, rating: Number(e.target.value) }); setPreview(null); }}>
                {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}★</option>)}
              </select>
              <textarea aria-label="Sample review text" className={`${inp} min-w-0 flex-1`} rows={3} value={sample.text} onChange={e => { setSample({ ...sample, text: e.target.value }); setPreview(null); }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => runPreview(false)} disabled={!!previewing} className="rounded-control border border-line bg-white px-3 py-2 text-xs font-semibold text-ink-700 disabled:opacity-60">{previewing === "rules" && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}Check rules</button>
              <button type="button" onClick={() => runPreview(true)} disabled={!!previewing} className="inline-flex items-center gap-1 rounded-control border border-brand-100 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 disabled:opacity-60">{previewing === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Preview AI reply</button>
            </div>
            {preview && (
              <div className={`rounded-control border px-3 py-2 text-xs ${preview.autoPost ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="status">
                <p className="font-semibold">{preview.autoPost ? "This reply would post automatically." : "This reply would wait for approval."}</p>
                {preview.reasons.length > 0 && <ul className="ml-4 list-disc">{preview.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                {preview.note && <p className="mt-1 text-ink-600">{preview.note}</p>}
                {preview.aiNote && <p className="mt-1">{preview.aiNote}</p>}
                {preview.reply && <p className="mt-2 whitespace-pre-wrap rounded-control border border-line bg-white px-2 py-1.5 text-ink-800"><span className="block text-[10px] font-bold uppercase text-ink-500">Sample AI reply</span>{preview.reply}</p>}
              </div>
            )}
          </div>
        </details>
      </section>

      <section hidden={section !== "alerts"} className="space-y-4">
        <div><h3 className="text-sm font-bold text-ink-900">Notifications</h3><p className="mt-1 text-xs text-ink-500">Choose which events appear in your admin notification bell.</p></div>
        <div className="divide-y divide-line rounded-xl border border-line px-4">
          {ALERTS.map(a => (
            <label key={a.key} className="flex cursor-pointer items-center justify-between gap-4 py-3 text-[13px] text-ink-700">
              <span>{a.label}</span><input type="checkbox" className="h-4 w-4 shrink-0 accent-brand-700" checked={f.alerts.events[a.key]} onChange={e => setF({ ...f, alerts: { ...f.alerts, events: { ...f.alerts.events, [a.key]: e.target.checked } } })} />
            </label>
          ))}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-xs text-ink-700">
          Unanswered after
          <input type="number" min={1} max={336} className={`${inp} w-20`} value={f.alerts.unansweredHours} onChange={e => setF({ ...f, alerts: { ...f.alerts, unansweredHours: Number(e.target.value) } })} /> hours
        </label>
        {emailAvailable ? <div className="space-y-3 rounded-xl bg-canvas p-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-700">
            <input type="checkbox" className="accent-brand-700" checked={f.alerts.email} onChange={e => setF({ ...f, alerts: { ...f.alerts, email: e.target.checked } })} /> Also send by email
          </label>
          {f.alerts.email && <label className="block space-y-2 text-xs font-semibold text-ink-700">
            <span>Recipients <span className="font-normal text-ink-400">· leave empty for all admins</span></span>
            <input className={`${inp} w-full`} placeholder="owner@business.in, manager@business.in" value={recipients} onChange={e => setRecipients(e.target.value)} />
          </label>}
        </div> : <p className="rounded-xl bg-canvas px-4 py-3 text-xs text-ink-500">Email alerts aren&apos;t available yet. You&apos;ll still see alerts in the bell.</p>}
      </section>

      {showActions && <div className="flex items-center gap-2 border-t border-line pt-4">
        <button type="submit" disabled={saving} className="rounded-control bg-brand-700 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60">{saving ? "Saving…" : "Save settings"}</button>
        <button type="button" onClick={onCancel} className="px-3 py-2 text-xs font-semibold text-ink-500 hover:text-ink-900">Cancel</button>
      </div>}
    </form>
  );
}
