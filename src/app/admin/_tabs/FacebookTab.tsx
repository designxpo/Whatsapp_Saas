"use client";
import { useBrand } from "@/components/BrandContext";
import { PageInfo } from "@/components/PageInfo";
import { Facebook } from "lucide-react";
import { MessengerCard } from "./SettingsTab";
import { CommentReplies } from "./CommentReplies";
import type { GoTo } from "../_shared";
import { HandoffResults } from "./HandoffResults";

// Facebook Messenger — first-class channel page (mirrors the Instagram tab).
export default function FacebookTab({ goTo }: { goTo?: GoTo } = {}) {
  const brand = useBrand();
  const who = brand.partnerId ? brand.name : "Talko";   // the name in-app copy uses
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2"><Facebook className="w-5 h-5 text-blue-600" /> Facebook Messenger</h2><PageInfo className="text-sm text-slate-500" lead={<>Let the AI answer messages and comments on your Facebook Page — inside Meta&apos;s rules (you can reply within 24 hours of a customer&apos;s last message, and never message people who haven&apos;t written to you).</>}>Page messages land in the same Live Chat inbox as WhatsApp.</PageInfo>
      </div>

      <section className="bg-white rounded-card border border-line p-5 space-y-3">
        <p className="text-xs font-bold text-slate-400 uppercase">Before you connect</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">1</span><span>A <b>Facebook Page</b> you manage, with permission to read and reply to its messages.</span></li>
          <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-bold flex items-center justify-center">2</span><span>Click <b>Connect with Facebook</b> below and choose your Page — {who} sets up the connection and message routing automatically, no developer settings to touch. (If that button isn&apos;t available, a developer can use <b>Add Page</b> to connect it by hand.)</span></li>
        </ol>
        <p className="text-[12px] text-ink-600 bg-canvas rounded-control px-3 py-2">Heads-up on Meta&apos;s rules (enforced automatically): you can only message someone within <b>24 hours</b> of their last message, and never cold-message. Comment-to-DM is the exception — a comment is an opt-in, so we may send <b>one</b> private reply per comment. Staying inside these keeps the Page safe from blocks.</p>
      </section>

      <MessengerCard />

      <CommentReplies platform="facebook" onOpenChat={goTo ? phone => goTo("livechat", { openPhone: phone }) : undefined} />

      <HandoffResults platform="facebook" />
    </div>
  );
}
