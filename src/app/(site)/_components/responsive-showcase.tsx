"use client";

// "Works on every screen": the Live Chat portal inside a dev-mode responsive
// frame that shrinks from a laptop to a tablet to a phone, on a loop. The
// miniature is real HTML laid out at the device's own width (1280 / 820 / 390
// CSS px) and scaled down to fit, and its panes reflow with container queries
// exactly where the portal's do: three panes on a laptop, list + chat on a
// tablet, one screen with the bottom tabs on a phone. (Styles: marketing.css,
// "Responsive showcase".)

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft, BarChart3, Bell, ChevronDown, CheckCheck, Home, ListTodo, Megaphone, Menu,
  MessageSquare, MousePointer2, Pause, Play, Search, Send, Settings, Smartphone, Sparkles,
  Tablet, Laptop, Users,
} from "lucide-react";

type ModeKey = "desktop" | "tablet" | "phone";
const MODES: { key: ModeKey; label: string; width: number; icon: typeof Laptop; title: string; detail: string }[] = [
  { key: "desktop", label: "Laptop", width: 1280, icon: Laptop, title: "Everything side by side", detail: "Chats, the conversation and the customer's AI brief, all at once." },
  { key: "tablet", label: "Tablet", width: 820, icon: Tablet, title: "List and chat together", detail: "The menu folds to icons so the conversation keeps its room." },
  { key: "phone", label: "Phone", width: 390, icon: Smartphone, title: "One screen, tabs at your thumb", detail: "Reply, take over from the AI and check payments on the go." },
];
const VIEW_H = 760;              // the miniature's own height, in its CSS px
const FULL = MODES[0].width;

// One loop: hold on each size, then "drag" the frame to the next.
type Segment = { kind: "hold"; ms: number; w: number; mode: ModeKey } | { kind: "move"; ms: number; from: number; to: number; mode: ModeKey };
const TIMELINE: Segment[] = [
  { kind: "hold", ms: 2600, w: 1280, mode: "desktop" },
  { kind: "move", ms: 1500, from: 1280, to: 820, mode: "tablet" },
  { kind: "hold", ms: 2400, w: 820, mode: "tablet" },
  { kind: "move", ms: 1500, from: 820, to: 390, mode: "phone" },
  { kind: "hold", ms: 3200, w: 390, mode: "phone" },
  { kind: "move", ms: 1800, from: 390, to: 1280, mode: "desktop" },
];
const LOOP_MS = TIMELINE.reduce((n, s) => n + s.ms, 0);
const RESUME_AFTER_MS = 6000;    // a chosen size stays put this long before the loop carries on
const PICK_MS = 900;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function atClock(clock: number): { w: number; mode: ModeKey; moving: boolean } {
  let t = ((clock % LOOP_MS) + LOOP_MS) % LOOP_MS;
  for (const s of TIMELINE) {
    if (t < s.ms) {
      if (s.kind === "hold") return { w: s.w, mode: s.mode, moving: false };
      return { w: s.from + (s.to - s.from) * ease(t / s.ms), mode: s.mode, moving: true };
    }
    t -= s.ms;
  }
  return { w: FULL, mode: "desktop", moving: false };
}
const holdStart = (mode: ModeKey) => {
  let t = 0;
  for (const s of TIMELINE) { if (s.kind === "hold" && s.mode === mode) return t; t += s.ms; }
  return 0;
};

/**
 * How far the miniature is scaled. On a wide page the scale is fixed, so the
 * frame visibly narrows. On a narrow page (the visitor's own phone) a fixed
 * scale would leave the phone frame unreadably small, so the scale grows a
 * little as the frame narrows — it still clearly shrinks, to about half.
 */
export function showcaseScale(stage: number, w: number): number {
  const give = stage < 700 ? 0.55 : 0;
  // Capped so the laptop frame never towers over the page.
  return Math.min(0.86, stage / (w + give * (FULL - w)));
}

export function ResponsiveShowcase() {
  const stageRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const deviceRef = useRef<HTMLSpanElement>(null);
  const [stageW, setStageW] = useState(1100);
  const [mode, setMode] = useState<ModeKey>("desktop");
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  const live = useRef({
    clock: 0, w: FULL, last: 0, visible: true, paused: false, reduced: false, stageW: 1100,
    pick: null as null | { from: number; to: number; start: number; until: number; mode: ModeKey },
    mode: "desktop" as ModeKey,
  });

  // Paint one frame: CSS variables only, so React never re-renders 60x a second.
  const paint = useCallback((w: number, moving: boolean) => {
    const el = stageRef.current;
    if (!el) return;
    const s = showcaseScale(live.current.stageW, w);
    el.style.setProperty("--rs-w", `${w.toFixed(1)}px`);
    el.style.setProperty("--rs-s", s.toFixed(4));
    el.style.setProperty("--rs-fw", `${(w * s).toFixed(1)}px`);
    el.style.setProperty("--rs-fh", `${(VIEW_H * s).toFixed(1)}px`);
    // Corners round off as the frame becomes a phone.
    const phoneness = Math.min(1, Math.max(0, (900 - w) / (900 - 390)));
    el.style.setProperty("--rs-radius", `${(10 + phoneness * 34) * s}px`);
    el.dataset.moving = moving ? "true" : "false";
    if (readoutRef.current) readoutRef.current.textContent = String(Math.round(w));
    // Named by the width it is right now, at the same steps the layout changes.
    if (deviceRef.current) deviceRef.current.textContent = w >= 1000 ? "Laptop" : w >= 600 ? "Tablet" : "Phone";
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { live.current.reduced = mq.matches; setReduced(mq.matches); };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // Leave room on the right for the drag handle and the cursor.
      const w = Math.max(240, entry.contentRect.width - 32);
      live.current.stageW = w;
      setStageW(w);
      paint(live.current.w, false);
    });
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => { live.current.visible = entry.isIntersecting; }, { threshold: 0.15 });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, [paint]);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const L = live.current;
      const dt = L.last ? Math.min(64, now - L.last) : 0;
      L.last = now;
      let w = L.w, moving = false, m = L.mode;
      if (L.pick) {
        const p = Math.min(1, (now - L.pick.start) / PICK_MS);
        w = L.reduced ? L.pick.to : L.pick.from + (L.pick.to - L.pick.from) * ease(p);
        moving = p < 1 && !L.reduced;
        m = L.pick.mode;
        if (now > L.pick.until && !L.paused && !L.reduced) { L.clock = holdStart(L.pick.mode); L.pick = null; }
      } else if (!L.paused && !L.reduced && L.visible) {
        L.clock += dt;
        const at = atClock(L.clock);
        w = at.w; moving = at.moving; m = at.mode;
      }
      if (w !== L.w || moving) { L.w = w; paint(w, moving); }
      else if (stageRef.current?.dataset.moving === "true") paint(w, false);
      if (m !== L.mode) { L.mode = m; setMode(m); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  const choose = (key: ModeKey) => {
    const L = live.current;
    const target = MODES.find(x => x.key === key)!.width;
    const now = performance.now();
    L.pick = { from: L.w, to: target, start: now, until: now + RESUME_AFTER_MS, mode: key };
    L.mode = key;
    setMode(key);
  };

  const togglePause = () => {
    const L = live.current;
    L.paused = !L.paused;
    setPaused(L.paused);
    if (!L.paused && L.pick) { L.clock = holdStart(L.pick.mode); L.pick = null; }
  };

  const phoneScale = showcaseScale(stageW, MODES[2].width);
  const stageH = VIEW_H * Math.max(showcaseScale(stageW, FULL), phoneScale);
  const s0 = showcaseScale(stageW, FULL);

  return (
    <div className="rs-showcase">
      <div className="rs-devbar" aria-hidden="true">
        <span className="rs-devbar-label">Dimensions: Responsive <ChevronDown className="h-3 w-3" /></span>
        <span className="rs-devbar-size"><span ref={readoutRef}>1280</span><span className="rs-devbar-x">px wide</span></span>
        <span ref={deviceRef} className="rs-devbar-mode">Laptop</span>
      </div>

      {/* The breakpoints, marked where each device's edges fall. Wide pages only:
          on a narrow page the scale changes with the width, so marks would lie. */}
      {stageW >= 700 && (
        <div className="rs-ruler" aria-hidden="true">
          {MODES.map(x => (
            <span key={x.key} className={`rs-ruler-mark ${mode === x.key ? "is-active" : ""}`} style={{ width: x.width * s0 }}>
              <span>{x.width}</span>
            </span>
          ))}
        </div>
      )}

      <div ref={stageRef} className="rs-stage" style={{ height: stageH } as CSSProperties} data-moving="false">
        <div className="rs-frame">
          <div className="rs-viewport" aria-hidden="true">
            <MiniPortal />
          </div>
          <span className="rs-handle" aria-hidden="true"><span /></span>
          <MousePointer2 className="rs-cursor" aria-hidden="true" />
        </div>
      </div>
      <p className="sr-only">
        An animation of the Talko AI Live Chat inbox resizing from a laptop to a tablet to a phone. On a laptop it shows the
        chat list, the conversation and the customer&apos;s details side by side; on a tablet the list and the conversation;
        on a phone one conversation with tabs along the bottom.
      </p>

      <div className="rs-controls">
        <div className="rs-modes" role="group" aria-label="Show the inbox on">
          {MODES.map(x => {
            const Icon = x.icon;
            return (
              <button key={x.key} type="button" onClick={() => choose(x.key)} aria-pressed={mode === x.key} className={`rs-mode ${mode === x.key ? "is-active" : ""}`}>
                <span className="rs-mode-head"><Icon className="h-4 w-4" aria-hidden="true" /> {x.label}<span className="rs-mode-px">{x.width}px</span></span>
                <span className="rs-mode-title">{x.title}</span>
                <span className="rs-mode-detail">{x.detail}</span>
              </button>
            );
          })}
        </div>
        {!reduced && (
          <button type="button" onClick={togglePause} className="rs-pause" aria-label={paused ? "Play the animation" : "Pause the animation"}>
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
            {paused ? "Play" : "Pause"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── The miniature portal (Live Chat), laid out at the device's own width ──────

const CHATS = [
  { name: "Ananya Rao", initials: "AR", channel: "whatsapp", text: "Yes please, and can I pay by UPI?", time: "now", unread: 2, tag: null as null | { text: string; tone: "amber" | "red" | "blue" } },
  { name: "Rahul Mehta", initials: "RM", channel: "instagram", text: "GUIDE", time: "2m", unread: 0, tag: { text: "AI replied", tone: "blue" as const } },
  { name: "Fatima Sheikh", initials: "FS", channel: "web", text: "Do you ship to Pune?", time: "5m", unread: 1, tag: { text: "Waiting 5m", tone: "amber" as const } },
  { name: "Kabir Singh", initials: "KS", channel: "messenger", text: "Can I talk to someone?", time: "12m", unread: 1, tag: { text: "Needs a person", tone: "red" as const } },
  { name: "Meera Iyer", initials: "MI", channel: "whatsapp", text: "Got the joining details, thanks!", time: "1h", unread: 0, tag: null },
  { name: "Arjun Nair", initials: "AN", channel: "instagram", text: "Is the Sunday batch full?", time: "2h", unread: 0, tag: null },
];

function ChannelMark({ channel }: { channel: string }) {
  if (channel === "web") return <span className="rs-ch rs-ch-web" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="rs-ch" src={`/brand/logos/${channel}.svg`} alt="" width={14} height={14} />;
}

function MiniPortal() {
  return (
    <div className="rs-app">
      <div className="rs-chrome">
        <span className="rs-dots"><i /><i /><i /></span>
        <span className="rs-url">app.thetalko.in/admin?tab=livechat</span>
      </div>
      <div className="rs-status">
        <span>9:41</span>
        <span className="rs-status-icons"><i /><i /><i /></span>
      </div>

      <div className="rs-body">
        <aside className="rs-side">
          <div className="rs-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/talko_favicon.svg" alt="" width={26} height={26} />
            <span>Talko AI</span>
          </div>
          {[
            { icon: Home, label: "Home" },
            { icon: MessageSquare, label: "Live Chat", active: true, badge: 3 },
            { icon: ListTodo, label: "Today" },
            { icon: Users, label: "Contacts" },
            { icon: Megaphone, label: "Broadcast" },
            { icon: BarChart3, label: "Analytics" },
            { icon: Settings, label: "Settings" },
          ].map(n => {
            const Icon = n.icon;
            return (
              <span key={n.label} className={`rs-nav ${n.active ? "is-active" : ""}`}>
                <Icon className="rs-nav-icon" />
                <span className="rs-nav-label">{n.label}</span>
                {n.badge ? <span className="rs-nav-badge">{n.badge}</span> : null}
              </span>
            );
          })}
        </aside>

        <div className="rs-main">
          <header className="rs-top">
            <span className="rs-top-title">Live Chat</span>
            <span className="rs-top-search"><Search className="h-[14px] w-[14px]" /> Search chats, people, orders</span>
            <span className="rs-top-right"><Bell className="h-4 w-4" /><span className="rs-me">PS</span></span>
          </header>

          <div className="rs-panes">
            <section className="rs-list">
              <div className="rs-seg"><span className="is-active">Chats</span><span>Comments</span></div>
              <div className="rs-chips">
                <span className="is-active">All</span><span>Waiting <b>3</b></span><span>Mine</span><span>Needs a person</span>
              </div>
              {CHATS.map((c, i) => (
                <div key={c.name} className={`rs-row ${i === 0 ? "is-active" : ""}`}>
                  <span className="rs-av">{c.initials}<ChannelMark channel={c.channel} /></span>
                  <span className="rs-row-main">
                    <span className="rs-row-top"><b>{c.name}</b><span>{c.time}</span></span>
                    <span className="rs-row-text">{c.text}</span>
                    {c.tag && <span className={`rs-tag rs-tag-${c.tag.tone}`}>{c.tag.text}</span>}
                  </span>
                  {c.unread ? <span className="rs-unread">{c.unread}</span> : null}
                </div>
              ))}
            </section>

            <section className="rs-chat">
              <div className="rs-chat-head">
                <ArrowLeft className="rs-back h-5 w-5" />
                <span className="rs-av rs-av-sm">AR<ChannelMark channel="whatsapp" /></span>
                <span className="rs-chat-who"><b>Ananya Rao</b><span>WhatsApp · +91 98•••• 4521</span></span>
                <span className="rs-ai-pill"><Sparkles className="h-3 w-3" /> AI replying</span>
                <span className="rs-takeover">Take over</span>
              </div>
              <div className="rs-msgs">
                <span className="rs-day">Today</span>
                <div className="rs-msg rs-in">Hi! Is the weekend yoga batch still open?<span className="rs-time">10:02</span></div>
                <div className="rs-msg rs-out"><span className="rs-by"><Sparkles className="h-3 w-3" /> AI</span>Yes — Saturday 8 AM has 4 seats left. Shall I hold one for you?<span className="rs-time">10:02 <CheckCheck className="h-3 w-3" /></span></div>
                <div className="rs-msg rs-in">Yes please, and can I pay by UPI?<span className="rs-time">10:03</span></div>
                <div className="rs-msg rs-out rs-pay">
                  <span className="rs-by"><Sparkles className="h-3 w-3" /> AI</span>
                  Done, your seat is held. Here&apos;s your pay link:
                  <span className="rs-paycard"><span><b>Weekend batch</b><span>Saturday 8 AM · 1 seat</span></span><b>₹2,499</b></span>
                  <span className="rs-paybtn">Pay with UPI</span>
                  <span className="rs-time">10:03 <CheckCheck className="h-3 w-3" /></span>
                </div>
                <span className="rs-event">Paid ₹2,499 · 10:05</span>
              </div>
              <div className="rs-compose">
                <span className="rs-input">Type a reply…</span>
                <span className="rs-send"><Send className="h-4 w-4" /></span>
              </div>
            </section>

            <aside className="rs-details">
              <span className="rs-av rs-av-lg">AR</span>
              <b className="rs-d-name">Ananya Rao</b>
              <span className="rs-d-sub">Bengaluru · via WhatsApp</span>
              <span className="rs-d-tags"><span className="rs-tag rs-tag-green">Paid</span><span className="rs-tag rs-tag-blue">Weekend batch</span></span>
              <div className="rs-brief">
                <span className="rs-brief-head"><Sparkles className="h-3.5 w-3.5" /> AI brief</span>
                Ready to buy, asked to pay by UPI and paid ₹2,499. Send the joining details for Saturday.
              </div>
              <div className="rs-d-section"><span>Next step</span><b>Send joining details</b></div>
              <div className="rs-d-section"><span>Lead</span><b>Hot · 92/100</b></div>
            </aside>
          </div>
        </div>
      </div>

      <nav className="rs-tabbar">
        <span><Home className="h-5 w-5" />Home</span>
        <span className="is-active"><MessageSquare className="h-5 w-5" />Inbox<i>3</i></span>
        <span><ListTodo className="h-5 w-5" />Today</span>
        <span><Users className="h-5 w-5" />Contacts</span>
        <span><Menu className="h-5 w-5" />More</span>
      </nav>
    </div>
  );
}
