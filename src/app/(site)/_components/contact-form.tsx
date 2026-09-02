"use client";

import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { track } from "@/lib/analytics";

const TOPICS = ["Sales", "Support", "Partnership", "General"];
const field = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#0783fd] focus:ring-2 focus:ring-[#0783fd]/20 transition";

export function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", topic: "General", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) { setErr("Please fill in your name, email, and message."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "Something went wrong — please try again."); return; }
      // `topic` is the useful dimension here — it separates a sales enquiry
      // from a support question, which are different leads entirely.
      track("generate_lead", { topic: form.topic });
      setDone(true);
    } catch { setErr("Connection error — please try again."); }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-[0_18px_50px_-24px_rgba(7,131,253,0.35)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#DDEFE4] text-[#2f9e6e]"><MailCheck className="h-7 w-7" /></div>
        <h3 className="mt-4 text-xl font-extrabold text-slate-900">Message sent</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">Thanks{form.name ? `, ${form.name.split(" ")[0]}` : ""} — we&apos;ll reply to <span className="font-semibold text-slate-700">{form.email}</span> shortly.</p>
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
          <span className="mb-1.5 block text-xs font-bold text-slate-700">Email *</span>
          <input className={field} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="priya@yourbrand.com" autoComplete="email" />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">What&apos;s this about?</span>
        <select className={field} value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}>
          {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">Message *</span>
        <textarea className={field} rows={5} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} placeholder="How can we help?" />
      </label>

      {/* Honeypot — hidden from humans; bots fill it and get silently dropped. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} className="hidden" aria-hidden="true" />

      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}

      <button type="submit" disabled={busy}
        className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0783fd] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#0668d6] disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
