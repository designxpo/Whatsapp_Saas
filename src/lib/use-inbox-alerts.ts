"use client";

// Agent alerts: hear about a chat that is waiting for a person, wherever you
// are in the portal — including when its browser tab is in the background.
//
// Live Chat refreshes only while its own tab is visible, so a counselor
// working anywhere else heard nothing until they happened to look. This polls
// a small, scoped endpoint (/api/admin/inbox/waiting) from every screen —
// every 15s, every 30s while hidden, at once on coming back — and:
//  - puts the number waiting in the browser tab's title and on Live Chat;
//  - plays a short chime for each chat that newly needs someone (one switch);
//  - shows a desktop notification while the portal is not in front, once the
//    person has allowed it — asked from the bell, never on page load;
//  - opens that chat when the notification is clicked.
//
// Only chats waiting for a PERSON (waitingForTeam in store.ts), not every
// message: the AI answers most in seconds, and alerting on those is noise.
// What has been announced is remembered per chat and message, so each new
// message announces once, and the first load announces nothing — the backlog
// is the count, not a burst of sounds.

import { useCallback, useEffect, useRef, useState } from "react";
import type { WaitingChat } from "./store";

export type { WaitingChat };
type Prefs = { sound: boolean; desktop: boolean };
const PREFS_KEY = "mb-alerts";
const DEFAULT_PREFS: Prefs = { sound: true, desktop: false };

function readPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return DEFAULT_PREFS; }
}
function writePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: this visit only */ }
}

/** Which chats in `chats` have not been announced yet, by chat and message time. */
export function freshChats(chats: WaitingChat[], seen: Set<string>): WaitingChat[] {
  return chats.filter(c => !seen.has(`${c.id}@${c.lastInboundAt}`));
}

/** The browser tab's title with the waiting count in front (or none). */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(/^\(\d+\+?\) /, "");
  return count > 0 ? `(${count > 99 ? "99+" : count}) ${base}` : base;
}

const REASON: Record<WaitingChat["reason"], string> = {
  escalated: "was handed to your team",
  bot_off: "is waiting for a reply",
  ai_off: "is waiting for a reply",
  unanswered: "has had no reply for 2 minutes",
};

// A soft two-note chime, made in the browser (no file to load). Audio can only
// start after the person has interacted with the page, so the context is
// unlocked on the first click or key press.
let audio: AudioContext | null = null;
function audioContext(): AudioContext | null {
  if (audio) return audio;
  const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return null;
  audio = new AC();
  return audio;
}
function chime() {
  const c = audioContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  for (const [freq, at] of [[880, 0], [1320, 0.12]] as const) {
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t + at);
    gain.gain.linearRampToValueAtTime(0.16, t + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.24);
    osc.connect(gain).connect(c.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.26);
  }
}

export function useInboxAlerts(openChat: (chat: WaitingChat) => void) {
  const [count, setCount] = useState(0);
  const [chats, setChats] = useState<WaitingChat[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef(new Set<string>());
  const primed = useRef(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const open = useRef(openChat);
  open.current = openChat;

  useEffect(() => {
    setPrefs(readPrefs());
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    const unlock = () => { void audioContext()?.resume().catch(() => undefined); };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);

  const announce = useCallback((fresh: WaitingChat[]) => {
    const p = prefsRef.current;
    if (p.sound) chime();
    const away = typeof document !== "undefined" && (document.hidden || !document.hasFocus());
    if (!p.desktop || !away || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const c of fresh.slice(0, 3)) {
      const n = new Notification(`${c.name || c.phone} ${REASON[c.reason]}`, { body: c.preview || "Open the portal to reply.", tag: c.id });
      n.onclick = () => { window.focus(); open.current(c); n.close(); };
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await fetch("/api/admin/inbox/waiting", { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { count: number; chats: WaitingChat[] };
          const fresh = freshChats(d.chats, seen.current);
          for (const c of d.chats) seen.current.add(`${c.id}@${c.lastInboundAt}`);
          if (seen.current.size > 1000) seen.current = new Set([...seen.current].slice(-500));
          if (primed.current && fresh.length) announce(fresh);
          primed.current = true;
          setCount(d.count);
          setChats(d.chats);
        }
      } catch { /* offline for a moment: the next tick tries again */ }
      if (!stopped) timer = setTimeout(tick, document.hidden ? 30_000 : 15_000);
    };
    void tick();
    // Coming back to the tab: catch up at once rather than at the next tick.
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [announce]);

  useEffect(() => { document.title = titleWithCount(document.title, count); }, [count]);

  const setSound = useCallback((sound: boolean) => {
    setPrefs(p => { const next = { ...p, sound }; writePrefs(next); return next; });
    if (sound) { void audioContext()?.resume().then(chime).catch(() => undefined); }   // a sample, so they know what it sounds like
  }, []);

  /** Turn desktop notifications on or off. Turning on asks the browser — from this click, never unprompted. */
  const setDesktop = useCallback(async (desktop: boolean) => {
    if (desktop && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
    }
    setPrefs(p => { const next = { ...p, desktop }; writePrefs(next); return next; });
  }, []);

  return { count, chats, sound: prefs.sound, desktop: prefs.desktop && permission === "granted", permission, setSound, setDesktop };
}
