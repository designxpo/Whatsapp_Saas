"use client";

import { useEffect, useRef, useState } from "react";
import type { Globe, Marker } from "cobe";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Globe2, MessageCircle, Pause, Play, Sparkles } from "lucide-react";

const EXAMPLES: { city: string; channel: string; location: [number, number]; message: string; reply: string; workflow: string }[] = [
  { city: "Mumbai", channel: "WhatsApp", location: [19.076, 72.8777], message: "Can you help me choose the right course?", reply: "Of course. What would you like to learn?", workflow: "A course enquiry becomes a guided conversation." },
  { city: "London", channel: "Website chat", location: [51.5074, -0.1278], message: "Which plan would suit a small team?", reply: "Happy to help. Which channels does your team use?", workflow: "A website visit becomes a useful sales enquiry." },
  { city: "New York", channel: "Instagram", location: [40.7128, -74.006], message: "GUIDE", reply: "Here’s the guide you asked for. What are you working on?", workflow: "A comment starts a resource-delivery conversation." },
  { city: "Singapore", channel: "Messenger", location: [1.3521, 103.8198], message: "I’d like to speak with someone about a demo.", reply: "I can pass that to the team. What would you like to explore?", workflow: "A product question reaches the team with context." },
];

function markers(active: number): Marker[] {
  return EXAMPLES.map((example, index) => ({ location: example.location, size: active === index ? 0.075 : 0.035,
    color: active === index ? [0.15, 0.85, 1] : [0.35, 0.55, 0.9] }));
}

function ConversationGlobe({ active, paused, reduced }: { active: number; paused: boolean; reduced: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Globe | null>(null);
  const selected = useRef(active);
  const pause = useRef(paused);
  const sync = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);

  useEffect(() => { selected.current = active; instance.current?.update({ markers: markers(active) }); }, [active]);
  useEffect(() => { pause.current = paused || reduced; sync.current(); }, [paused, reduced]);

  useEffect(() => {
    const element = canvas.current;
    const wrapper = container.current;
    if (!element || !wrapper) return;
    let disposed = false;
    let visible = false;
    let loading = false;
    let frame = 0;
    let last = 0;
    let phi = 2.8;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const size = () => Math.max(1, wrapper.clientWidth);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const stop = () => { cancelAnimationFrame(frame); frame = 0; last = 0; element.dataset.motion = "paused"; };
    const canRun = () => !disposed && visible && !document.hidden && !pause.current && !preference.matches && !!instance.current;
    const tick = (time: number) => {
      frame = 0;
      if (!canRun()) { stop(); return; }
      if (!last || time - last >= 32) {
        phi += last ? Math.min(time - last, 60) * 0.0001 : 0;
        last = time;
        instance.current?.update({ phi });
      }
      frame = requestAnimationFrame(tick);
    };
    const reconcile = () => {
      if (canRun() && !frame) { element.dataset.motion = "rotating"; frame = requestAnimationFrame(tick); }
      else if (!canRun()) stop();
    };
    sync.current = reconcile;
    const initialise = async () => {
      if (loading || instance.current || disposed) return;
      loading = true;
      try {
        const { default: createGlobe } = await import("cobe");
        if (disposed) return;
        // COBE returns a no-op instance when WebGL is unavailable. Detect that
        // case explicitly so the static globe remains visible.
        const context = { alpha: true, antialias: true };
        if (!element.getContext("webgl2", context) && !element.getContext("webgl", context)) return;
        const width = size();
        instance.current = createGlobe(element, {
          width, height: width, devicePixelRatio: dpr,
          phi, theta: 0.18, dark: 1, diffuse: 1.1, mapSamples: window.innerWidth <= 640 ? 16000 : 28000,
          mapBrightness: 5.5, mapBaseBrightness: 0.015,
          baseColor: [0.035, 0.10, 0.20], markerColor: [0.1, 0.8, 1], glowColor: [0.7, 0.85, 1],
          markers: markers(selected.current),
          arcs: EXAMPLES.slice(1).map(example => ({ from: EXAMPLES[0].location, to: example.location })),
          arcColor: [0.15, 0.6, 1], arcWidth: 0.5, arcHeight: 0.22, markerElevation: 0.02,
          context,
        });
        setReady(true); reconcile();
      } catch { if (!disposed) setReady(false); }
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) void initialise();
      reconcile();
    }, { threshold: 0.05 });
    observer.observe(wrapper);
    const resize = new ResizeObserver(() => { const width = size(); instance.current?.update({ width, height: width }); });
    resize.observe(wrapper);
    document.addEventListener("visibilitychange", reconcile);
    preference.addEventListener("change", reconcile);
    return () => {
      disposed = true; stop(); observer.disconnect(); resize.disconnect();
      document.removeEventListener("visibilitychange", reconcile); preference.removeEventListener("change", reconcile);
      instance.current?.destroy(); instance.current = null; sync.current = () => {};
    };
  }, []);

  return <div ref={container} className={`marketing-global-sphere${ready ? " is-ready" : ""}`} aria-hidden="true">
    <Image className="marketing-global-fallback" src="/marketing/globe-fallback.svg" width={800} height={800} alt="" />
    <canvas ref={canvas} className="marketing-global-canvas" />
  </div>;
}

export function GlobalConversations() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    change(); query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const example = EXAMPLES[active];

  return <section className="marketing-global-section" id="connected-world" aria-labelledby="global-conversations-heading">
    <div className="marketing-container marketing-global-layout">
      <div className="marketing-global-copy">
        <p className="marketing-eyebrow"><Globe2 size={14} aria-hidden="true" /> A MORE CONNECTED WORLD</p>
        <h2 id="global-conversations-heading">Your next customer<br />could be <span>anywhere.</span></h2>
        <p className="marketing-global-description">Different cities. Different time zones. The same thoughtful conversation. Bring your channels, AI and team together, so every enquiry has somewhere to go.</p>
        <div className="marketing-global-actions"><Link href="/features" className="marketing-button marketing-button-primary">Explore the platform <ArrowUpRight size={16} aria-hidden="true" /></Link><Link href="/contact">Talk to our team <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        <div className="marketing-global-stats"><div><strong>6</strong><span>customer touchpoints</span></div><div><strong>1</strong><span>connected workspace</span></div></div>
        <p className="marketing-global-channels">WhatsApp · Instagram · Messenger · YouTube<br />Google Reviews · Website chat</p>
      </div>
      <div className="marketing-global-visual">
        <ConversationGlobe active={active} paused={paused} reduced={reduced} />
        <div className="marketing-global-demo" aria-live="polite" aria-atomic="true">
          <div className="marketing-global-demo-heading"><span className="marketing-global-channel-icon"><MessageCircle size={18} aria-hidden="true" /></span><div><strong>{example.city}</strong><span>{example.channel}</span></div><span className="marketing-global-example-label">EXAMPLE</span></div>
          <p className="marketing-global-message">{example.message}</p>
          <div className="marketing-global-reply"><Sparkles size={13} aria-hidden="true" /><p>{example.reply}</p></div>
          <p className="marketing-global-workflow">{example.workflow}</p>
        </div>
        <button type="button" className="marketing-globe-pause" disabled={reduced} aria-pressed={paused || reduced}
          aria-label={reduced ? "Globe rotation paused for reduced motion" : paused ? "Resume globe rotation" : "Pause globe rotation"}
          onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>
        <div className="marketing-global-city-picker" role="group" aria-label="Explore example conversations by city">
          {EXAMPLES.map((item, index) => <button type="button" key={item.city} aria-pressed={active === index} onClick={() => setActive(index)}><span />{item.city}</button>)}
        </div>
        <p className="marketing-global-disclaimer">Illustrative journeys, not live customer activity.</p>
      </div>
    </div>
  </section>;
}
