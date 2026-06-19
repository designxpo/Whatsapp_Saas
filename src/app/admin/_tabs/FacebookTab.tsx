"use client";
import { Facebook } from "lucide-react";
import { MessengerCard } from "./SettingsTab";

// Facebook Messenger — first-class channel page (mirrors the Instagram tab).
export default function FacebookTab() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Facebook className="w-5 h-5 text-blue-600" /> Facebook Messenger</h2>
        <p className="text-sm text-slate-500">Auto-reply to Facebook Page DMs with your AI — all within Meta&apos;s rules (24-hour window, no cold messages). Page DMs land in the same Live Chat inbox.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Before you connect</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>A <b>Facebook Page</b> you manage (the same Meta app you use for WhatsApp/Instagram).</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><span>On your Meta app, add the <code className="font-mono text-[12px]">pages_messaging</code> permission and subscribe the <b>messenger</b> webhook to <code className="font-mono text-[12px]">/api/webhooks/messenger</code> (field: <i>messages</i>) using your existing verify token.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>Grab two things to paste below: the <b>Facebook Page ID</b> and a <b>Page access token</b> with <code className="font-mono text-[12px]">pages_messaging</code>.</span></li>
        </ol>
        <p className="text-[11px] text-ink-400 bg-canvas rounded-control px-3 py-2">Heads-up on Meta&apos;s rules (enforced automatically): you can only message someone within <b>24 hours</b> of their last message, and never cold-message. Staying inside these keeps the Page safe from blocks.</p>
      </section>

      <MessengerCard />
    </div>
  );
}
