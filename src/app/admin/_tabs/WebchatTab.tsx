"use client";
import { PageInfo } from "@/components/PageInfo";
import { MessageSquare } from "lucide-react";
import { WebchatCard } from "./SettingsTab";

// Website web-chat widget — first-class channel page.
export default function WebchatTab() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><MessageSquare className="w-5 h-5 text-brand-600" /> Website Chat</h2><PageInfo className="text-sm text-slate-500" lead={<>Put a chat bubble on your website so visitors can message you — the AI answers straight away and your team can join in.</>}>Website chats land in the same Live Chat inbox as WhatsApp. No Facebook or Meta setup needed.</PageInfo>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">How it works</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>Create a widget below and (optionally) lock it to your website&apos;s domains.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><div>Copy the one line of code it gives you and paste it into your website — or send it to whoever looks after your site. <details className="mt-1 text-[12px] text-ink-500"><summary className="cursor-pointer font-semibold">For developers</summary>It&apos;s a <code className="font-mono">&lt;script&gt;</code> tag; paste it into the site&apos;s HTML just before <code className="font-mono">&lt;/body&gt;</code>.</details></div></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">3</span><span>A chat bubble appears on your site. Messages flow into Live Chat and the AI answers instantly; your team can take over anytime.</span></li>
        </ol>
      </section>

      <WebchatCard />
    </div>
  );
}
