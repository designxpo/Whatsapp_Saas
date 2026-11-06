"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Globe2, MessageCircle, Pause, Play, Sparkles } from "lucide-react";
import { arcPoints, earthVector, GLOBE_TILT, isVisible, shortestTurn, toRad, toView, type Vec3 } from "./globe-math";

const EXAMPLES: { city: string; channel: string; location: [number, number]; message: string; reply: string; workflow: string }[] = [
  { city: "Mumbai", channel: "WhatsApp", location: [19.076, 72.8777], message: "Can you help me choose the right course?", reply: "Of course. What would you like to learn?", workflow: "A course enquiry becomes a guided conversation." },
  { city: "London", channel: "Website chat", location: [51.5074, -0.1278], message: "Which plan would suit a small team?", reply: "Happy to help. Which channels does your team use?", workflow: "A website visit becomes a useful sales enquiry." },
  { city: "New York", channel: "Instagram", location: [40.7128, -74.006], message: "GUIDE", reply: "Here’s the guide you asked for. What are you working on?", workflow: "A comment starts a resource-delivery conversation." },
  { city: "Singapore", channel: "Messenger", location: [1.3521, 103.8198], message: "I’d like to speak with someone about a demo.", reply: "I can pass that to the team. What would you like to explore?", workflow: "A product question reaches the team with context." },
];

// The real Earth: NASA's Blue Marble satellite mosaic (public domain),
// wrapped onto a sphere by a small WebGL shader. City dots and arcs are drawn
// on a 2D canvas above it with the same projection (globe-math.ts).
const TEXTURE = "/marketing/earth-blue-marble.jpg";
const RADIUS = 0.86; // of half the canvas; the rest is the atmosphere glow
const SPIN = 0.00009; // radians per millisecond, west to east
const HOLD_MS = 6000; // how long a chosen city stays in front before the spin resumes

const VERTEX = `attribute vec2 aPos; varying vec2 vPos; void main() { vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FRAGMENT = `precision highp float;
uniform sampler2D uTex; uniform float uRot; uniform float uTilt; uniform float uPx; uniform float uRadius;
varying vec2 vPos;
void main() {
  vec2 p = vPos / uRadius;
  float r = length(p);
  float halo = r > 1.0 ? exp(-(r - 1.0) * 22.0) * 0.5 : 0.0;
  vec4 outside = vec4(vec3(0.52, 0.76, 1.0) * halo, halo);
  if (r > 1.0 + uPx) { gl_FragColor = outside; return; }
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = vec3(p, z);
  float ct = cos(uTilt), st = sin(uTilt);
  vec3 e = vec3(n.x, n.y * ct + n.z * st, -n.y * st + n.z * ct);
  float rx = e.x * cos(uRot) + e.z * sin(uRot);
  float rz = -e.x * sin(uRot) + e.z * cos(uRot);
  float lon = atan(rx, rz);
  float lat = asin(clamp(e.y, -1.0, 1.0));
  vec3 base = texture2D(uTex, vec2(fract((lon + 3.14159265) / 6.28318531), 0.5 - lat / 3.14159265)).rgb;
  vec3 light = normalize(vec3(-0.45, 0.38, 0.81));
  float diffuse = max(dot(n, light), 0.0);
  vec3 col = base * (0.38 + 0.82 * diffuse);
  float ocean = smoothstep(0.02, 0.12, base.b - max(base.r, base.g));
  col += pow(max(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0), 48.0) * ocean * 0.3;
  col = mix(col, vec3(0.5, 0.76, 1.0), pow(1.0 - z, 2.4) * 0.6);
  float a = 1.0 - smoothstep(1.0 - uPx, 1.0 + uPx, r);
  gl_FragColor = vec4(col * a, a) + outside * (1.0 - a);
}`;

function earthRenderer(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) return null;
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  // No mipmaps: they would draw a seam where the map's edges meet.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const [uRot, uTilt, uPx, uRadius] = [u("uRot"), u("uTilt"), u("uPx"), u("uRadius")];
  gl.uniform1i(u("uTex"), 0);
  return (rot: number) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uRot, rot); gl.uniform1f(uTilt, GLOBE_TILT);
    gl.uniform1f(uPx, 2 / (canvas.width * RADIUS)); gl.uniform1f(uRadius, RADIUS);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}

// The business (Mumbai, the first example) linked to customers around the
// world: the four example cities, plus more places a customer could write from.
const MORE_CUSTOMERS: [number, number][] = [
  [25.2048, 55.2708], [24.7136, 46.6753], [30.0444, 31.2357], [-1.2921, 36.8219], [6.5244, 3.3792],
  [-26.2041, 28.0473], [52.52, 13.405], [35.6762, 139.6503], [-6.2088, 106.8456], [-33.8688, 151.2093],
  [-23.5505, -46.6333], [43.6532, -79.3832], [34.0522, -118.2437], [19.4326, -99.1332],
];
const CITY_VECTORS = EXAMPLES.map(example => earthVector(example.location[0], example.location[1]));
const HUB = CITY_VECTORS[0];
const LINKS = [
  ...CITY_VECTORS.slice(1).map(to => ({ points: arcPoints(HUB, to), featured: true })),
  ...MORE_CUSTOMERS.map(([lat, lon]) => ({ points: arcPoints(HUB, earthVector(lat, lon)), featured: false })),
];
const CUSTOMER_DOTS = MORE_CUSTOMERS.map(([lat, lon]) => earthVector(lat, lon));
const PULSE_MS = 3200; // one message crossing a line

/** Lines, travelling message pulses (`clock` ms; null = no motion) and city dots. */
function drawOverlay(canvas: HTMLCanvasElement, rot: number, active: number, clock: number | null) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width, half = size / 2, r = half * RADIUS, scale = size / 600;
  const screen = (v: Vec3) => [half + v[0] * r, half - v[1] * r] as const;
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = "round";
  LINKS.forEach((link, index) => {
    const view = link.points.map(point => toView(point, rot));
    ctx.lineWidth = (link.featured ? 1.6 : 1) * scale;
    for (let i = 1; i < view.length; i++) {
      if (!isVisible(view[i - 1]) || !isVisible(view[i])) continue;
      const [x0, y0] = screen(view[i - 1]), [x1, y1] = screen(view[i]);
      const glow = Math.sin((Math.PI * i) / view.length);
      ctx.strokeStyle = link.featured ? `rgba(120, 205, 255, ${0.35 + 0.5 * glow})` : `rgba(170, 220, 255, ${0.18 + 0.3 * glow})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    if (clock === null) return;
    // A message travelling the line: out to the customer on even lines, back to the business on odd ones.
    const phase = (clock / PULSE_MS + index * 0.37) % 1;
    const at = view[Math.round((index % 2 ? 1 - phase : phase) * (view.length - 1))];
    if (!isVisible(at)) return;
    const [x, y] = screen(at), fade = Math.sin(Math.PI * phase);
    ctx.fillStyle = `rgba(56, 209, 255, ${0.25 * fade})`;
    ctx.beginPath(); ctx.arc(x, y, 6 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(235, 250, 255, ${fade})`;
    ctx.beginPath(); ctx.arc(x, y, 2.2 * scale, 0, Math.PI * 2); ctx.fill();
  });
  for (const city of CUSTOMER_DOTS) {
    const v = toView(city, rot);
    if (v[2] <= 0.04) continue;
    const [x, y] = screen(v);
    ctx.globalAlpha = Math.min(1, v[2] * 4) * 0.85;
    ctx.fillStyle = "#d8efff";
    ctx.beginPath(); ctx.arc(x, y, 2.4 * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  CITY_VECTORS.forEach((city, index) => {
    const v = toView(city, rot);
    if (v[2] <= 0.04) return;
    const [x, y] = screen(v), on = index === active, fade = Math.min(1, v[2] * 4);
    ctx.globalAlpha = fade;
    if (on) {
      ctx.fillStyle = "rgba(56, 209, 255, 0.28)";
      ctx.beginPath(); ctx.arc(x, y, 11 * scale, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = on ? "#38d1ff" : "#ffffff";
    ctx.strokeStyle = "rgba(6, 40, 80, 0.8)";
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath(); ctx.arc(x, y, (on ? 5 : 3.5) * scale, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (index === 0) {
      // The hub is the business using Talko AI.
      const label = "Your business";
      ctx.font = `600 ${11 * scale}px ui-sans-serif, system-ui, sans-serif`;
      const w = ctx.measureText(label).width + 14 * scale, h = 20 * scale, lx = x + 10 * scale, ly = y - h - 6 * scale;
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.beginPath(); ctx.roundRect(lx, ly, w, h, h / 2); ctx.fill();
      ctx.fillStyle = "#0b4f8a";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + 7 * scale, ly + h / 2);
    }
    ctx.globalAlpha = 1;
  });
}

function ConversationGlobe({ active, paused, reduced }: { active: number; paused: boolean; reduced: boolean }) {
  const earth = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const state = useRef({ active, paused: paused || reduced, reduced, target: null as number | null });
  const wake = useRef<() => void>(() => {});
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const firstActive = useRef(true);

  useEffect(() => {
    state.current.active = active;
    if (firstActive.current) { firstActive.current = false; return; }
    state.current.target = toRad(EXAMPLES[active].location[1]); // turn the chosen city to the front
    wake.current();
  }, [active]);
  useEffect(() => { state.current.paused = paused || reduced; state.current.reduced = reduced; wake.current(); }, [paused, reduced]);

  useEffect(() => {
    const wrapper = container.current, glCanvas = earth.current, dots = overlay.current;
    if (!wrapper || !glCanvas || !dots) return;
    let disposed = false, visible = false, loading = false, frame = 0, last = 0;
    let rot = toRad(EXAMPLES[0].location[1]) + 0.35;
    let render: ((rot: number) => void) | null = null;
    let clock = 0, holdUntil = 0; // message pulses; a chosen city stays in front until holdUntil
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const paint = () => { if (!render) return; render(rot); drawOverlay(dots, rot, state.current.active, state.current.reduced ? null : clock); };
    const fit = () => {
      const px = Math.max(1, Math.round(wrapper.clientWidth * dpr));
      for (const c of [glCanvas, dots]) { if (c.width !== px) { c.width = px; c.height = px; } }
      paint();
    };
    const moving = () => state.current.target !== null || !state.current.paused;
    const tick = (time: number) => {
      frame = 0;
      if (disposed || !visible || document.hidden || !render) { last = 0; return; }
      const dt = last ? Math.min(time - last, 60) : 0;
      last = time;
      const { target } = state.current;
      if (target !== null) {
        const turn = shortestTurn(rot, target);
        if (state.current.reduced || Math.abs(turn) < 0.002) { rot = target; state.current.target = null; holdUntil = time + HOLD_MS; }
        else rot += turn * Math.min(1, dt * 0.005);
      } else if (!state.current.paused && time >= holdUntil) rot -= dt * SPIN; // the facing longitude falls as Earth turns east
      if (!state.current.paused) clock += dt;
      paint();
      if (moving()) frame = requestAnimationFrame(tick); else last = 0;
    };
    const reconcile = () => {
      paint();
      if (!frame && visible && !document.hidden && render && moving()) frame = requestAnimationFrame(tick);
    };
    wake.current = reconcile;
    const initialise = async () => {
      if (loading || render || disposed) return;
      loading = true;
      try {
        const image = new window.Image();
        image.src = TEXTURE;
        await image.decode();
        if (disposed) return;
        render = earthRenderer(glCanvas, image);
        if (!render) return; // no WebGL: the still photo of the globe stays
        fit(); setReady(true); reconcile();
      } catch { render = null; }
    };
    const lost = (event: Event) => { event.preventDefault(); render = null; setReady(false); };
    glCanvas.addEventListener("webglcontextlost", lost);
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (entries[0].isIntersecting || entries[0].intersectionRatio > 0) setNear(true);
      if (visible) void initialise();
      reconcile();
    }, { rootMargin: "300px 0px" });
    observer.observe(wrapper);
    const resize = new ResizeObserver(fit);
    resize.observe(wrapper);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect();
      glCanvas.removeEventListener("webglcontextlost", lost);
      document.removeEventListener("visibilitychange", reconcile); wake.current = () => {};
    };
  }, []);

  return <div ref={container} className={`marketing-global-sphere${ready ? " is-ready" : ""}`} aria-hidden="true">
    <div className="marketing-global-fallback" style={near ? { backgroundImage: `url(${TEXTURE})` } : undefined} />
    <canvas ref={earth} className="marketing-global-canvas" />
    <canvas ref={overlay} className="marketing-global-canvas marketing-global-dots" />
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
        <div className="marketing-global-controls">
          <div className="marketing-global-city-picker" role="group" aria-label="Explore example conversations by city">
            {EXAMPLES.map((item, index) => <button type="button" key={item.city} aria-pressed={active === index} onClick={() => setActive(index)}><span />{item.city}</button>)}
          </div>
          <button type="button" className="marketing-globe-pause" disabled={reduced} aria-pressed={paused || reduced}
            aria-label={reduced ? "Globe rotation paused for reduced motion" : paused ? "Resume globe rotation" : "Pause globe rotation"}
            onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</button>
        </div>
        <div className="marketing-global-demo" aria-live="polite" aria-atomic="true">
          <div className="marketing-global-demo-heading"><span className="marketing-global-channel-icon"><MessageCircle size={18} aria-hidden="true" /></span><div><strong>{example.city}</strong><span>{example.channel}</span></div><span className="marketing-global-example-label">EXAMPLE</span></div>
          <p className="marketing-global-message">{example.message}</p>
          <div className="marketing-global-reply"><Sparkles size={13} aria-hidden="true" /><p>{example.reply}</p></div>
          <p className="marketing-global-workflow">{example.workflow}</p>
        </div>
        <p className="marketing-global-disclaimer">Illustrative journeys, not live customer activity. Earth imagery: NASA Blue Marble.</p>
      </div>
    </div>
  </section>;
}
