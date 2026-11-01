"use client";

// "Continue on WhatsApp" in a comment rule's editor (handoff.ts). Instagram and
// Facebook add a button to the rule's DM carrying the person's own code;
// YouTube ends the public reply with a typed code, since it hides replies with
// links. Either way the rule says what to send once they arrive on WhatsApp.

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { inp } from "../_shared";

type Platform = "instagram" | "facebook" | "youtube";

export function HandoffOption({ platform, on, message, onChange }: {
  platform: Platform; on: boolean; message: string; onChange: (on: boolean, message: string) => void;
}) {
  const [number, setNumber] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    fetch("/api/admin/handoffs?setup=1").then(r => r.json()).then(j => setNumber(j.number ?? null)).catch(() => setNumber(null));
  }, []);
  const yt = platform === "youtube";
  return (
    <div className="rounded-control bg-canvas border border-line p-2.5 space-y-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-ink-700 cursor-pointer">
        <input type="checkbox" className="accent-emerald-600" checked={on} onChange={e => onChange(e.target.checked, message)} />
        <MessageCircle className="w-3.5 h-3.5 text-emerald-600" /> Continue on WhatsApp
      </label>
      <p className="text-[11px] text-ink-400">
        {yt
          ? <>The reply ends with a personal code, like “Send code YT-4821 to us on WhatsApp (number in the pinned comment)”. No link: YouTube hides replies with links.</>
          : <>The DM gets a “Continue on WhatsApp” button with their own code. When they message you there, you see which post and comment they came from.</>}
      </p>
      {on && <>
        <textarea className={`${inp} w-full`} rows={3} value={message} onChange={e => onChange(true, e.target.value)}
          placeholder="What we send on WhatsApp when they arrive, e.g. Here's the guide you asked for: https://… Reply here with any questions 🙂" />
        {number === null && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-control px-2 py-1.5">
            Add your WhatsApp number in <b>Handle Hub</b> first: the invitation needs it. Until then the {yt ? "reply" : "DM"} goes out without it.
          </p>
        )}
        {yt && number && (
          <p className="text-[11px] text-ink-600 bg-white border border-line rounded-control px-2 py-1.5">
            Pin a comment like this on the video: <b>“WhatsApp us at +{number} and send the code from our reply 🙏”</b>
          </p>
        )}
      </>}
    </div>
  );
}
