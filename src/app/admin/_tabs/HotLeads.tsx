"use client";

// Who to call first (hot-leads.ts): the last three days' chats ranked by what
// the customers wrote and did, each with the reasons in plain words. Tapping a
// lead opens the chat.

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { PageInfo } from "@/components/PageInfo";
import type { GoTo } from "../_shared";

interface Lead { conversationId: string; name: string; phone: string; platform: string; score: number; band: "hot" | "warm"; reasons: string[]; lastMessage: string; lastInboundAt: string | null }
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Facebook", webchat: "Web chat" };

export function HotLeads({ goTo }: { goTo: GoTo }) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  useEffect(() => {
    fetch("/api/admin/hot-leads").then(r => r.json())
      .then(j => setLeads([...(j.hot ?? []), ...(j.warm ?? [])].slice(0, 6)))
      .catch(() => setLeads([]));
  }, []);
  if (leads !== null && !leads.length) return null;   // nothing worth a call: no card
  return (
    <section className="bg-white rounded-card border border-line p-4 sm:p-5 space-y-3">
      <div className="group flex items-center gap-1.5">
        <h2 className="text-[15px] font-bold text-ink-900 flex items-center gap-1.5"><Flame className="w-4 h-4 text-orange-500" aria-hidden /> Call these first</h2>
        <PageInfo>Chats from the last three days, ranked by what the customer wrote and did: asking about price, booking or buying, how recently they wrote, whether they&apos;re waiting on you. Someone who just paid, or sounds unhappy, ranks lower. The same list comes in your morning digest email.</PageInfo>
      </div>
      {leads === null ? (
        <div role="status" aria-label="Loading" className="space-y-2">{[0, 1].map(i => <div key={i} className="h-12 rounded-control bg-canvas animate-pulse" />)}</div>
      ) : (
        <ul className="divide-y divide-line">
          {leads.map(l => (
            <li key={l.conversationId}>
              <button type="button" onClick={() => goTo("livechat", { openPhone: l.phone })} className="no-press w-full min-h-11 text-left py-2.5 flex items-start gap-3 hover:bg-canvas rounded-control px-1 transition-colors">
                <span className={`shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${l.band === "hot" ? "bg-orange-50 text-orange-700" : "bg-amber-50 text-amber-700"}`}>{l.band}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink-900 truncate">{l.name || `…${l.phone.slice(-4)}`} <span className="font-normal text-slate-500">· {CHANNEL[l.platform] ?? l.platform}</span></span>
                  <span className="block text-[12px] text-slate-500 truncate">{l.reasons.join(" · ")}</span>
                  {l.lastMessage && <span className="block text-[12px] text-ink-700 truncate">“{l.lastMessage}”</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
