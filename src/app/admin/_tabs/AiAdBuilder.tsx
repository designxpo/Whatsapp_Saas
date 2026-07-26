"use client";

// AI Meta-ads builder. The client enters a total budget + a short brief; the AI
// drafts a complete campaign (objective, budget split, audience, ad copy). We
// show it — with live Meta previews and an audience estimate — for approval,
// then publish it LIVE via the same /api/admin/meta/create engine the manual
// builder uses. Everything before "Publish" is a draft that never touches Meta.
import { useState } from "react";
import { ArrowLeft, Sparkles, Loader2, ImagePlus, CheckCircle2, Megaphone } from "lucide-react";
import { inp, btnPrimary } from "../_shared";

type Goal = "WHATSAPP" | "MESSENGER" | "WEBSITE";
interface AdPlan {
  campaignName: string; objective: string; conversionLocation: Goal; optimizationGoal?: string; ctaType?: string;
  dailyBudget: number; days: number; budgetTotal: number; currency: string;
  ageMin: number; ageMax: number; genders: number[]; countries: string[];
  primaryText: string; headline: string; description: string; rationale: string; tips: string[];
}

const GOALS: { value: Goal; label: string; blurb: string }[] = [
  { value: "WHATSAPP", label: "WhatsApp chats", blurb: "People tap the ad and start a WhatsApp chat with you." },
  { value: "MESSENGER", label: "Messenger chats", blurb: "People message your Facebook Page from the ad." },
  { value: "WEBSITE", label: "Website visits", blurb: "People land on a page you choose." },
];
const COUNTRIES: { code: string; name: string }[] = [
  { code: "IN", name: "India" }, { code: "US", name: "United States" }, { code: "GB", name: "UK" },
  { code: "AE", name: "UAE" }, { code: "CA", name: "Canada" }, { code: "AU", name: "Australia" },
  { code: "SG", name: "Singapore" }, { code: "SA", name: "Saudi Arabia" },
];
const genderLabel = (g: number[]) => (g.length === 0 ? "All genders" : g.includes(1) ? "Men" : "Women");

// Downscale big images client-side before upload (serverless body caps + Meta
// only needs ~1080px). Small images / non-images pass through untouched.
async function prepImage(f: File): Promise<File> {
  if (!f.type.startsWith("image/") || f.size <= 1_200_000) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1080 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob ? new File([blob], f.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : f;
  } catch { return f; }
}

export default function AiAdBuilder({ currency, hasPage, onClose, onCreated }: { currency: string; hasPage: boolean; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<"brief" | "review" | "done">("brief");
  // Brief
  const [goal, setGoal] = useState<Goal>("WHATSAPP");
  const [product, setProduct] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [budget, setBudget] = useState("");
  const [days, setDays] = useState("7");
  const [countries, setCountries] = useState<string[]>(["IN"]);
  const [audienceNote, setAudienceNote] = useState("");
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Plan + review
  const [plan, setPlan] = useState<AdPlan | null>(null);
  const [previews, setPreviews] = useState<{ key: string; label: string; html: string }[]>([]);
  const [audience, setAudience] = useState<{ lower?: number; upper?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);

  const toggleCountry = (code: string) => setCountries(cs => (cs.includes(code) ? cs.filter(c => c !== code) : [...cs, code]));

  async function uploadImage(f: File) {
    setUploading(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append("file", await prepImage(f));
      const d = await fetch("/api/admin/meta/media", { method: "POST", body: fd }).then(r => r.json());
      if (d.imageHash) { setImageHash(d.imageHash); setImagePreview(URL.createObjectURL(f)); }
      else setMsg(d.error || "Image upload failed.");
    } catch { setMsg("Image upload failed."); }
    finally { setUploading(false); }
  }

  function briefValid(): string | null {
    if (!product.trim()) return "Tell the AI what you're advertising.";
    if (!(Number(budget) > 0)) return "Enter your total budget.";
    if (!(Number(days) > 0)) return "Enter how many days to run.";
    if (goal === "WEBSITE" && !websiteUrl.trim()) return "Add the website URL to send people to.";
    if (!countries.length) return "Pick at least one country to target.";
    return null;
  }

  async function generate() {
    const err = briefValid(); if (err) { setMsg(err); return; }
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta/ai-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, websiteUrl, product, budgetTotal: Number(budget), days: Number(days), currency, countries, audienceNote }),
      }).then(r => r.json());
      if (d.error || !d.plan) { setMsg(d.error || "Could not draft the campaign."); return; }
      setPlan(d.plan);
      setStep("review");
      void loadReview(d.plan);
    } catch { setMsg("Connection error."); }
    finally { setBusy(false); }
  }

  // Live Meta previews + audience estimate for the drafted plan (best-effort).
  async function loadReview(p: AdPlan) {
    const creative = { format: "single" as const, primaryText: p.primaryText, headline: p.headline, description: p.description, imageHash };
    const dest = { objective: p.objective, conversionLocation: p.conversionLocation, websiteUrl: p.conversionLocation === "WEBSITE" ? websiteUrl : null, ctaType: p.ctaType ?? null };
    fetch("/api/admin/meta/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...dest, creative }) })
      .then(r => r.json()).then(d => setPreviews(d.previews ?? [])).catch(() => {});
    fetch("/api/admin/meta/estimate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objective: p.objective, conversionLocation: p.conversionLocation, optimizationGoal: p.optimizationGoal ?? null, placements: "advantage",
        targeting: { countries: p.countries, cities: [], regions: [], ageMin: p.ageMin, ageMax: p.ageMax, genders: p.genders, interests: [], locales: [], customAudiences: [], excludedCustomAudiences: [], advantageAudience: true } }) })
      .then(r => r.json()).then(d => { if (d.lower != null || d.upper != null) setAudience({ lower: d.lower, upper: d.upper }); }).catch(() => {});
  }

  async function publish() {
    if (!plan) return;
    setBusy(true); setMsg(null);
    try {
      const d = await fetch("/api/admin/meta/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: plan.campaignName, objective: plan.objective, conversionLocation: plan.conversionLocation,
          websiteUrl: plan.conversionLocation === "WEBSITE" ? websiteUrl : null, ctaType: plan.ctaType ?? null,
          optimizationGoal: plan.optimizationGoal ?? null,
          budgetLevel: "campaign", budgetType: "daily", budget: plan.dailyBudget,
          placements: "advantage", specialAdCategories: [],
          targeting: { countries: plan.countries, cities: [], regions: [], ageMin: plan.ageMin, ageMax: plan.ageMax, genders: plan.genders, interests: [], locales: [], customAudiences: [], excludedCustomAudiences: [], advantageAudience: true },
          creative: { format: "single", primaryText: plan.primaryText, headline: plan.headline, description: plan.description, imageHash },
          activate: true,
        }),
      }).then(r => r.json());
      if (d.error || !d.success) { setMsg(d.error || "Publish failed."); return; }
      setLiveId(d.campaignId ?? null); setStep("done"); onCreated();
    } catch { setMsg("Connection error."); }
    finally { setBusy(false); }
  }

  const money = (n: number) => `${currency} ${n.toLocaleString()}`;
  const patch = (p: Partial<AdPlan>) => setPlan(cur => (cur ? { ...cur, ...p } : cur));

  // ── Done ──
  if (step === "done") return (
    <div className="max-w-lg mx-auto text-center py-16 space-y-4">
      <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto"><CheckCircle2 className="w-7 h-7" /></div>
      <h2 className="text-xl font-extrabold text-ink-900">Your ad is live 🎉</h2>
      <p className="text-sm text-slate-500">Meta is reviewing it now (usually under an hour), then it starts delivering. Track spend and results on the Meta Ads dashboard.</p>
      {liveId && <p className="text-[11px] text-slate-400 font-mono">Campaign {liveId}</p>}
      <button onClick={onClose} className={`${btnPrimary} mx-auto`}>Back to dashboard</button>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={step === "review" ? () => setStep("brief") : onClose} className="text-[13px] font-bold text-brand-700 hover:underline flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> {step === "review" ? "Edit brief" : "Cancel"}</button>
        <div className="flex-1" />
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{step === "brief" ? "Step 1 · Brief" : "Step 2 · Review & approve"}</span>
      </div>
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Sparkles className="w-5 h-5" /> AI campaign builder</h2>
        <p className="text-sm text-slate-500">Enter your budget and a one-line brief — the AI drafts the whole campaign for you to approve.</p>
      </div>
      {!hasPage && <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-sm text-amber-800">Connect your Facebook Page first (Meta Ads dashboard) — ads need a Page to run from.</div>}
      {msg && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{msg}</div>}

      {step === "brief" && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">What&apos;s the goal?</label>
            <div className="grid sm:grid-cols-3 gap-2 mt-1.5">
              {GOALS.map(g => (
                <button key={g.value} onClick={() => setGoal(g.value)} className={`text-left rounded-card border p-3 transition ${goal === g.value ? "border-brand-500 bg-brand-50" : "border-line bg-white hover:border-brand-300"}`}>
                  <p className="text-sm font-bold text-ink-900">{g.label}</p>
                  <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{g.blurb}</p>
                </button>
              ))}
            </div>
          </div>
          {goal === "WEBSITE" && <input className={`${inp} w-full`} placeholder="Landing page URL (https://…)" value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)} />}
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">What are you advertising?</label>
            <textarea className={`${inp} w-full mt-1.5`} rows={3} placeholder="e.g. Diwali sale — 30% off all handmade candles, free delivery over ₹999" value={product} onChange={e => setProduct(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">Total budget ({currency})</label>
              <input className={`${inp} w-full mt-1.5`} inputMode="numeric" placeholder="e.g. 5000" value={budget} onChange={e => setBudget(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
            <div>
              <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">Run for (days)</label>
              <input className={`${inp} w-full mt-1.5`} inputMode="numeric" placeholder="7" value={days} onChange={e => setDays(e.target.value.replace(/[^0-9]/g, ""))} />
            </div>
          </div>
          {Number(budget) > 0 && Number(days) > 0 && <p className="text-[11px] text-slate-500 -mt-2">≈ {money(Math.round(Number(budget) / Number(days)))} / day</p>}
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">Target countries</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {COUNTRIES.map(c => (
                <button key={c.code} onClick={() => toggleCountry(c.code)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${countries.includes(c.code) ? "bg-brand-700 text-white border-brand-700" : "bg-white text-ink-500 border-line hover:border-brand-300"}`}>{c.name}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">Ad image</label>
            <div className="flex items-center gap-3 mt-1.5">
              <label className={`cursor-pointer px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas flex items-center gap-1.5 ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {imageHash ? "Change image" : "Upload image"}
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} />
              </label>
              {imagePreview && <img src={imagePreview} alt="" className="w-12 h-12 rounded-lg object-cover border border-line" />}
              {!imageHash && <span className="text-[11px] text-slate-400">Recommended — ads with an image perform far better.</span>}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-ink-500 uppercase tracking-wide">Audience note (optional)</label>
            <input className={`${inp} w-full mt-1.5`} placeholder="e.g. women 25–40 interested in home décor" value={audienceNote} onChange={e => setAudienceNote(e.target.value)} />
          </div>
          <button onClick={generate} disabled={busy || !hasPage} className={btnPrimary}>{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Drafting…</> : <><Sparkles className="w-4 h-4" /> Generate campaign</>}</button>
        </div>
      )}

      {step === "review" && plan && (
        <div className="space-y-4">
          <div className="bg-brand-50 border border-brand-100 rounded-card p-3">
            <p className="text-[13px] text-ink-700 leading-relaxed">{plan.rationale}</p>
          </div>

          {/* Structure summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { label: "Goal", value: GOALS.find(g => g.value === plan.conversionLocation)?.label ?? plan.conversionLocation },
              { label: "Daily budget", value: money(plan.dailyBudget) },
              { label: "Total over " + plan.days + "d", value: money(plan.dailyBudget * plan.days) },
              { label: "Audience", value: `${genderLabel(plan.genders)} · ${plan.ageMin}–${plan.ageMax}` },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-card border border-line px-3 py-2.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{s.label}</p>
                <p className="text-sm font-extrabold text-ink-900 truncate">{s.value}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">
            Targeting {plan.countries.join(", ")} · Advantage+ audience · {audience ? `est. reach ${(audience.lower ?? 0).toLocaleString()}–${(audience.upper ?? 0).toLocaleString()}` : "estimating reach…"}
          </p>

          {/* Editable ad copy */}
          <div className="bg-white rounded-card border border-line p-4 space-y-2.5">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Ad copy — edit anything before you publish</p>
            <div>
              <label className="text-[10px] font-bold text-ink-400 uppercase">Campaign name</label>
              <input className={`${inp} w-full mt-1`} value={plan.campaignName} onChange={e => patch({ campaignName: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-ink-400 uppercase">Primary text</label>
              <textarea className={`${inp} w-full mt-1`} rows={3} value={plan.primaryText} onChange={e => patch({ primaryText: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase">Headline</label>
                <input className={`${inp} w-full mt-1`} maxLength={40} value={plan.headline} onChange={e => patch({ headline: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-ink-400 uppercase">Description</label>
                <input className={`${inp} w-full mt-1`} maxLength={60} value={plan.description} onChange={e => patch({ description: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Live Meta previews */}
          {previews.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1.5">How it looks on Meta</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {previews.slice(0, 3).map(p => (
                  <div key={p.key} className="shrink-0">
                    <p className="text-[10px] font-bold text-ink-400 mb-1">{p.label}</p>
                    <iframe title={p.label} srcDoc={p.html} className="w-[300px] h-[420px] rounded-card border border-line bg-white" sandbox="allow-scripts allow-same-origin" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.tips.length > 0 && (
            <ul className="text-[12px] text-slate-600 space-y-1">
              {plan.tips.map((t, i) => <li key={i} className="flex gap-2"><span className="text-brand-500">•</span>{t}</li>)}
            </ul>
          )}

          <div className="flex items-center gap-3 border-t border-line pt-4">
            <button onClick={publish} disabled={busy} className={btnPrimary}>{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Publishing…</> : <><Megaphone className="w-4 h-4" /> Approve &amp; publish live</>}</button>
            <button onClick={() => setStep("brief")} className="px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-700 hover:bg-canvas">Back</button>
            <span className="text-[11px] text-slate-400">Publishing sets the campaign live on Meta and starts spending your budget.</span>
          </div>
        </div>
      )}
    </div>
  );
}
