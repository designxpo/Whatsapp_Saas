"use client";
import { MessageSquare } from "lucide-react";
import { WebchatCard } from "./SettingsTab";

// Website web-chat widget — first-class channel page.
export default function WebchatTab() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><MessageSquare className="w-5 h-5 text-brand-600" /> Website Web Chat</h2>
        <p className="text-sm text-slate-500">Add a live-chat bubble to your website with one line of code. Visitor chats land in the same Live Chat inbox and your AI replies instantly — no Meta setup needed.</p>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">How it works</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>Create a widget below and (optionally) lock it to your website&apos;s domains.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><span>Copy the one-line <code className="font-mono text-[12px]">&lt;script&gt;</code> snippet and paste it into your site&apos;s HTML (before <code className="font-mono text-[12px]">&lt;/body&gt;</code>).</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>A chat bubble appears on your site. Messages flow into Live Chat and the AI answers instantly; your team can take over anytime.</span></li>
        </ol>
      </section>

      <WebchatCard />
    </div>
  );
}
