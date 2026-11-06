"use client";

// Review settings: when AI replies may post on their own, what kind of business
// is replying (a preset the owner edits, language, an approved support
// contact), which topics always wait for a person (with a preview on sample
// reviews — nothing is posted), who hears about problems, and per-location
// overrides of the workspace's settings.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useVocab } from "@/lib/vocab-client";
import { reviewSamples } from "@/lib/industry-samples";
import { inp } from "../_shared";
import { BUSINESS_PRESETS, BUSINESS_TYPES, LANGUAGE_LABELS, type BusinessType, type ReplyLanguage } from "@/lib/review-presets";
import { LocationSettings } from "./ReviewLocationSettings";
import { PREVIEWED_KEY } from "./ReviewSetup";

type HoldCategory = "billing" | "safety" | "legal" | "personal_info" | "strong_complaint";
type AlertKind = "new_review" | "needs_approval" | "complaint" | "post_failed" | "reauth" | "sync_failing" | "overdue";
export interface ReviewSettingsValue {
  autoMinStars: number; signature: string; tone: string;
  holdFor: Record<HoldCategory, boolean>;
  alerts: { email: boolean; recipients: string[]; events: Record<AlertKind, boolean>; unansweredHours: number; summary?: "off" | "daily" | "weekly" };
  businessType: BusinessType; businessDescription: string; replyGuidance: string; supportContact: string; language: ReplyLanguage;
}

// The workspace's industry (Settings) suggests a starting preset.
const INDUSTRY_PRESET: Record<string, BusinessType> = {
  restaurant: "restaurant", healthcare: "clinic", education: "education", travel: "hotel", ecommerce: "retail",
  finance: "services", agency: "services", saas: "services", creator: "services", realestate: "services",
};

const TOPICS: { key: HoldCategory; label: string; hint: string }[] = [
  { key: "billing", label: "Refunds, billing disputes or overcharging", hint: "“charged twice”, “want my money back”" },
  { key: "safety", label: "Injury, safety or a serious service failure", hint: "“unsafe”, “injured”, “serious service failure”" },
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


export function ReviewSettingsPanel({ value, signaturePlaceholder, emailAvailable, saving, onSave, onCancel, showActions = true, locations = [] }: {
  value: ReviewSettingsValue; signaturePlaceholder: string; emailAvailable: boolean; saving: boolean;
  onSave: (v: ReviewSettingsValue) => void; onCancel: () => void; showActions?: boolean;
  locations?: { id: string; name: string }[];
}) {
  const { industry } = useVocab();
  const samples = useMemo(() => reviewSamples(industry), [industry]);
  const [section, setSection] = useState<"replies" | "business" | "approval" | "alerts" | "locations">("replies");
  const [f, setF] = useState<ReviewSettingsValue>(() => {
    const suggested = value.businessType === "other" ? INDUSTRY_PRESET[industry ?? ""] : undefined;
    return suggested && !value.replyGuidance ? { ...value, businessType: suggested, replyGuidance: BUSINESS_PRESETS[suggested].guidance } : value;
  });
  const [recipients, setRecipients] = useState(value.alerts.recipients.join(", "));
  const [sample, setSample] = useState(samples[1]);
  const [preview, setPreview] = useState<null | { autoPost: boolean; reasons: string[]; reply: string | null; aiNote: string | null; note: string | null }>(null);
  const [previewing, setPreviewing] = useState<"rules" | "ai" | null>(null);

  useEffect(() => { setSample(samples[1]); setPreview(null); }, [samples]);

  async function runPreview(withAi: boolean) {
    setPreviewing(withAi ? "ai" : "rules"); setPreview(null);
    try {
      const settings = { tone: f.tone, signature: f.signature, businessType: f.businessType, businessDescription: f.businessDescription, replyGuidance: f.replyGuidance, supportContact: f.supportContact, language: f.language };
      const r = await fetch("/api/admin/reviews/policy-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...sample, withAi, autoMinStars: f.autoMinStars, holdFor: f.holdFor, settings }) });
      const d = await r.json().catch(() => ({}));
      setPreview(r.ok ? d : { autoPost: false, reasons: [d.error || "Preview isn't available right now."], reply: null, aiNote: null, note: null });
      if (r.ok) { try { localStorage.setItem(PREVIEWED_KEY, "1"); } catch { /* this visit only */ } }
    } finally { setPreviewing(null); }
  }

  const save = () => onSave({ ...f, alerts: { ...f.alerts, recipients: recipients.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean) } });

  return (
    <form id="review-settings-form" noValidate onSubmit={e => { e.preventDefault(); save(); }} className="space-y-6">
      <nav aria-label="Review settings sections" className={`grid gap-1 rounded-xl bg-canvas p-1 ${locations.length ? "grid-cols-5" : "grid-cols-4"}`}>
        {([{ key: "replies", label: "Replies" }, { key: "business", label: "Business" }, { key: "approval", label: "Approval" }, { key: "alerts", label: "Alerts" }, ...(locations.length ? [{ key: "locations", label: "Locations" }] : [])] as { key: typeof section; label: string }[]).map(item => (
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

      <section hidden={section !== "business"} className="space-y-5">
        <div><h3 className="text-sm font-bold text-ink-900">Your business</h3><p className="mt-1 text-xs text-ink-500">Replies follow this. Start from a preset for your kind of business and edit it.</p></div>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>Kind of business</span>
          <select className={`${inp} w-full`} value={f.businessType} onChange={e => { const t = e.target.value as BusinessType; setF({ ...f, businessType: t, replyGuidance: !f.replyGuidance || Object.values(BUSINESS_PRESETS).some(p => p.guidance === f.replyGuidance) ? BUSINESS_PRESETS[t].guidance : f.replyGuidance }); setPreview(null); }}>
            {BUSINESS_TYPES.map(t => <option key={t} value={t}>{BUSINESS_PRESETS[t].label}</option>)}
          </select>
        </label>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>About the business <span className="font-normal text-ink-400">· optional</span></span>
          <textarea className={`${inp} w-full`} rows={2} maxLength={400} placeholder={BUSINESS_PRESETS[f.businessType].describe} value={f.businessDescription} onChange={e => setF({ ...f, businessDescription: e.target.value })} />
        </label>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span className="flex items-center justify-between gap-2">Reply guidance
            {f.replyGuidance !== BUSINESS_PRESETS[f.businessType].guidance && <button type="button" onClick={() => setF({ ...f, replyGuidance: BUSINESS_PRESETS[f.businessType].guidance })} className="font-normal text-brand-700">Use the preset text</button>}
          </span>
          <textarea className={`${inp} w-full`} rows={4} maxLength={800} value={f.replyGuidance} onChange={e => setF({ ...f, replyGuidance: e.target.value })} />
        </label>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>Contact for customers with a problem <span className="font-normal text-ink-400">· optional</span></span>
          <input className={`${inp} w-full`} maxLength={120} placeholder="e.g. care@yourbusiness.in or +91 98XXX XXXXX" value={f.supportContact} onChange={e => setF({ ...f, supportContact: e.target.value })} />
          <span className="block font-normal text-ink-500">Replies to complaints invite people to reach you here. Leave it empty and replies won&apos;t include any contact details — the AI never makes one up.</span>
        </label>
        <label className="block space-y-2 text-xs font-semibold text-ink-700">
          <span>Reply language</span>
          <select className={`${inp} w-full`} value={f.language} onChange={e => setF({ ...f, language: e.target.value as ReplyLanguage })}>
            {(Object.keys(LANGUAGE_LABELS) as ReplyLanguage[]).map(l => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
          </select>
        </label>
        <p className="rounded-xl bg-canvas px-4 py-3 text-xs leading-relaxed text-ink-500">Replies never promise refunds, discounts or investigations, and never repeat a customer&apos;s personal details. Try it under Approval → Test your rules.</p>
      </section>

      <section hidden={section !== "locations"} className="space-y-4">
        <div><h3 className="text-sm font-bold text-ink-900">Location settings</h3><p className="mt-1 text-xs text-ink-500">A location uses the workspace settings unless you give it its own.</p></div>
        <LocationSettings locations={locations} workspace={f} />
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
              {samples.map((s, i) => (
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
                {preview.reply && <p className="mt-2 whitespace-pre-wrap rounded-control border border-line bg-white px-2 py-1.5 text-ink-800"><span className="block text-[11px] font-bold uppercase text-ink-500">Sample AI reply</span>{preview.reply}</p>}
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
          <input type="number" min={1} max={336} className={`${inp} w-20`} aria-label="Unanswered after how many hours" value={f.alerts.unansweredHours} onChange={e => setF({ ...f, alerts: { ...f.alerts, unansweredHours: Number(e.target.value) } })} /> hours
        </label>
        {emailAvailable ? <div className="space-y-3 rounded-xl bg-canvas p-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-700">
            <input type="checkbox" className="accent-brand-700" checked={f.alerts.email} onChange={e => setF({ ...f, alerts: { ...f.alerts, email: e.target.checked } })} /> Also send by email
          </label>
          {f.alerts.email && <label className="block space-y-2 text-xs font-semibold text-ink-700">
            <span>Recipients <span className="font-normal text-ink-500">· leave empty for all admins</span></span>
            <input className={`${inp} w-full`} placeholder="owner@business.in, manager@business.in" value={recipients} onChange={e => setRecipients(e.target.value)} />
          </label>}
          {f.alerts.email && <label className="block space-y-2 text-xs font-semibold text-ink-700">
            <span>Summary email</span>
            <select className={`${inp} w-full`} value={f.alerts.summary ?? "off"} onChange={e => setF({ ...f, alerts: { ...f.alerts, summary: e.target.value as "off" | "daily" | "weekly" } })}>
              <option value="off">None</option><option value="daily">Every morning</option><option value="weekly">Every Monday morning</option>
            </select>
          </label>}
        </div> : <p className="rounded-xl bg-canvas px-4 py-3 text-xs text-ink-500">Email alerts aren&apos;t available yet. You&apos;ll still see alerts in the bell.</p>}
      </section>

      {showActions && <div className="flex items-center gap-2 border-t border-line pt-4">
        <button type="submit" disabled={saving} className="min-h-10 rounded-control bg-brand-700 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60">{saving ? "Saving…" : "Save settings"}</button>
        <button type="button" onClick={onCancel} className="min-h-10 px-3 py-2 text-xs font-semibold text-ink-500 hover:text-ink-900">Cancel</button>
      </div>}
    </form>
  );
}
