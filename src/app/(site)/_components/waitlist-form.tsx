"use client";

import { useState } from "react";
import { Check, Loader2, PartyPopper } from "lucide-react";
import { TIERS, CREATOR_TIERS } from "../_content/site";

const PLAN_OPTIONS = [...TIERS, ...CREATOR_TIERS].map(t => t.name);
const CHANNELS = ["WhatsApp", "Instagram", "Facebook Messenger", "Website chat", "Google reviews"];
const field = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#0783fd] focus:ring-2 focus:ring-[#0783fd]/20 transition";

export function WaitlistForm({ initialPlan = "" }: { initialPlan?: string }) {
  const preset = PLAN_OPTIONS.find(p => p.toLowerCase() === initialPlan.trim().toLowerCase()) ?? "";
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", plan: preset, message: "", website: "" });
  const [channels, setChannels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function toggleChannel(c: string) {
    setChannels(cs => (cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) { setErr("Please enter your name and email."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, channels }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "Something went wrong — please try again."); return; }
      setDone(true);
    } catch { setErr("Connection error — please try again."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_18px_50px_-24px_rgba(7,131,253,0.35)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#DDEFE4] text-[#2f9e6e]"><PartyPopper className="h-7 w-7" /></div>
        <h3 className="mt-4 text-xl font-extrabold text-slate-900">You&apos;re on the list! 🎉</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">Thanks{form.name ? `, ${form.name.split(" ")[0]}` : ""} — we&apos;ve saved your details{form.plan ? ` for the ${form.plan} plan` : ""}. We&apos;ll email you at <span className="font-semibold text-slate-700">{form.email}</span> the moment we launch and get you set up first.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-24px_rgba(7,131,253,0.35)] sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-700">Your name *</span>
          <input className={field} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Priya Sharma" autoComplete="name" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-700">Work email *</span>
          <input className={field} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="priya@yourbrand.com" autoComplete="email" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-700">Phone / WhatsApp</span>
          <input className={field} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" autoComplete="tel" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-slate-700">Business / brand</span>
          <input className={field} value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Your Brand Pvt Ltd" autoComplete="organization" />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">Which plan are you interested in?</span>
        <select className={field} value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })}>
          <option value="">Not sure yet — help me choose</option>
          {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>

      <div className="mt-4">
        <span className="mb-2 block text-xs font-bold text-slate-700">Channels you want to automate</span>
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(c => {
            const on = channels.includes(c);
            return (
              <button key={c} type="button" onClick={() => toggleChannel(c)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? "border-[#0783fd] bg-[#0783fd]/10 text-[#0783fd]" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                {on && <Check className="h-3.5 w-3.5" />}{c}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">Anything you&apos;d like us to know? (optional)</span>
        <textarea className={field} rows={3} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="e.g. We run a spiritual brand on Instagram and want comment-to-DM + review replies." />
      </label>

      {/* Honeypot — hidden from humans; bots fill it and get silently dropped. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} className="hidden" aria-hidden="true" />

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      <button type="submit" disabled={busy}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0783fd] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0668d6] disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Joining…" : "Join the waitlist"}
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-400">No spam. We&apos;ll only email you about early access and launch.</p>
    </form>
  );
}
