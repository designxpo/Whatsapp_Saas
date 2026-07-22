// n8n-style horizontal agent canvas. Shows what ONE automation actually looks
// like in the builder: a trigger → an AI Agent (with model / memory / knowledge /
// tools hanging beneath it) → a router that fans to channel actions on each
// branch. Light theme, brand blue, dotted backdrop, animated dashed connectors.
// Server-safe (Reveal is the only client piece). Connector geometry is computed
// from fixed node heights so every line meets its node — nothing "breaks".

import {
  Zap, Bot, Sparkles, History, BookOpen, ShoppingBag, Split, UserPlus, Bell,
  MessageSquare, Repeat, type LucideIcon,
} from "lucide-react";
import { SectionTitle, GRADIENTS } from "./ui";
import { Reveal } from "./motion";
import { AGENT_CANVAS, type CanvasNode } from "../_content/site";

const ICONS: Record<string, LucideIcon> = {
  zap: Zap, bot: Bot, sparkles: Sparkles, history: History, book: BookOpen,
  shopping: ShoppingBag, split: Split, user: UserPlus, bell: Bell,
  message: MessageSquare, repeat: Repeat,
};
function Ico({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const I = ICONS[name] ?? Bot;
  return <I className={className} />;
}

// Geometry (px) — connectors are drawn from these, so they always align.
const NODE_H = 64;          // every node is this tall (content vertically centred)
const NODE_GAP = 10;        // gap between two nodes in a branch
const BRANCH_GAP = 34;      // gap between the two branches
const TOP_PAD = 4;          // pt-1 on the spine nodes
const GROUP_H = 2 * NODE_H + NODE_GAP;                 // a 2-node branch's height
const LEAD_Y = GROUP_H / 2;                            // lead branch centre
const OTHER_Y = GROUP_H + BRANCH_GAP + GROUP_H / 2;    // other branch centre
const BLOCK_H = 2 * GROUP_H + BRANCH_GAP;              // full branches block height
const ROUTER_Y = TOP_PAD + NODE_H / 2;                 // router output centre
const SPLIT_W = 64;

// A draggable-looking node card (with the connector dots n8n shows). Titles wrap
// rather than truncate; the fixed height keeps the branch connectors aligned.
function Node({ node, dots = "x", className = "w-48" }: { node: CanvasNode; dots?: "x" | "in" | "out" | "io"; className?: string }) {
  const showIn = dots === "in" || dots === "io";
  const showOut = dots === "out" || dots === "io";
  return (
    <div
      className={`relative flex shrink-0 items-center rounded-2xl border bg-white p-3 shadow-[0_12px_30px_-16px_rgba(7,131,253,0.45)] ${node.accent ? "border-[#0783fd] ring-1 ring-[#0783fd]/20" : "border-slate-200"} ${className}`}
      style={{ minHeight: NODE_H }}
    >
      {showIn && <span aria-hidden className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      {showOut && <span aria-hidden className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-[#0783fd] bg-white" />}
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${node.accent ? `${GRADIENTS.brand} text-white animate-pulsesoft` : "bg-[#0783fd]/10 text-[#0783fd]"}`}>
          <Ico name={node.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-bold leading-tight text-slate-900">{node.title}</div>
          {node.sub && <div className="text-[10.5px] leading-tight text-slate-500">{node.sub}</div>}
        </div>
      </div>
    </div>
  );
}

// Animated dashed horizontal connector between the spine stages.
function Wire({ width = 44 }: { width?: number }) {
  return (
    <svg width={width} height="24" viewBox={`0 0 ${width} 24`} className="shrink-0 overflow-visible" style={{ marginTop: ROUTER_Y - 12 }}>
      <line x1="0" y1="12" x2={width - 8} y2="12" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
      <path d={`M${width - 8} 7 L${width} 12 L${width - 8} 17 Z`} fill="#0783fd" fillOpacity="0.7" />
    </svg>
  );
}

// A branch: a vertical bus that joins the router fan to each stacked action node.
function BranchGroup({ nodes }: { nodes: CanvasNode[] }) {
  const multi = nodes.length > 1;
  return (
    <div className="relative flex flex-col" style={{ gap: NODE_GAP }}>
      {multi && <span aria-hidden className="absolute left-0 w-px bg-[#0783fd]/40" style={{ top: NODE_H / 2, bottom: NODE_H / 2 }} />}
      {nodes.map(n => (
        <div key={n.id} className="flex items-center" style={{ minHeight: NODE_H }}>
          <span aria-hidden className="h-px w-3 shrink-0 bg-[#0783fd]/40" />
          <Node node={n} dots="in" />
        </div>
      ))}
    </div>
  );
}

export function AgentCanvas() {
  const c = AGENT_CANVAS;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-8">
      <SectionTitle
        eyebrow="Build it visually"
        title="One canvas. Every conversation, automated."
        subtitle="Trigger → AI agent → the right outcome. No code, no engineers."
      />
      <Reveal className="relative mt-12">
        {/* Dotted canvas backdrop, like the builder. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] [background-image:radial-gradient(rgba(7,131,253,0.13)_1px,transparent_1px)] [background-size:20px_20px] [mask-image:radial-gradient(circle_at_center,black,transparent_85%)]" />
        <div className="relative overflow-x-auto rounded-[28px] border border-slate-200/70 bg-white/40 px-5 py-9 backdrop-blur-sm">
          <div className="mx-auto flex w-max items-start gap-0">
            {/* Trigger */}
            <div style={{ paddingTop: TOP_PAD }}><Node node={c.trigger} dots="out" /></div>
            <Wire />

            {/* Agent. Column is constrained to the node width so the spine wires
                meet the node edges (no gap); the model/memory/tool nodes float
                below it, centred, without widening the horizontal spacing. */}
            <div className="relative w-48 shrink-0" style={{ paddingTop: TOP_PAD }}>
              <Node node={c.agent} dots="io" className="w-48" />
              <div className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top: TOP_PAD + 64 }}>
                <svg width="2" height="22" viewBox="0 0 2 22" className="overflow-visible"><line x1="1" y1="0" x2="1" y2="22" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.5" className="animate-dash" /></svg>
                <div aria-hidden className="relative h-5 w-[360px]">
                  <span className="absolute top-0 h-px bg-[#0783fd]/40" style={{ left: "12.5%", right: "12.5%" }} />
                  {[12.5, 37.5, 62.5, 87.5].map(x => <span key={x} className="absolute top-0 h-5 w-px bg-[#0783fd]/40" style={{ left: `${x}%` }} />)}
                </div>
                <div className="grid w-[360px] grid-cols-4 gap-2">
                  {c.attachments.map(a => (
                    <div key={a.id} className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-2 text-center">
                      <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-lg bg-[#0783fd]/10 text-[#0783fd]"><Ico name={a.icon} className="h-3 w-3" /></span>
                      <div className="mt-1 text-[10px] font-bold leading-tight text-slate-800">{a.title}</div>
                      <div className="text-[9px] leading-tight text-slate-400">{a.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <Wire />
            {/* Router */}
            <div style={{ paddingTop: TOP_PAD }}><Node node={c.router} dots="io" /></div>

            {/* Router fan → branches. SVG splits the router output to each branch
                centre; labels sit on the paths. */}
            <div className="relative shrink-0" style={{ width: SPLIT_W, height: BLOCK_H }}>
              <svg width={SPLIT_W} height={BLOCK_H} className="overflow-visible">
                <path d={`M0 ${ROUTER_Y} C 34 ${ROUTER_Y} 30 ${LEAD_Y} ${SPLIT_W} ${LEAD_Y}`} fill="none" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
                <path d={`M0 ${ROUTER_Y} C 34 ${ROUTER_Y} 30 ${OTHER_Y} ${SPLIT_W} ${OTHER_Y}`} fill="none" stroke="#0783fd" strokeWidth="2" strokeOpacity="0.55" className="animate-dash" />
                <path d={`M${SPLIT_W - 8} ${LEAD_Y - 5} L${SPLIT_W} ${LEAD_Y} L${SPLIT_W - 8} ${LEAD_Y + 5} Z`} fill="#0783fd" fillOpacity="0.7" />
                <path d={`M${SPLIT_W - 8} ${OTHER_Y - 5} L${SPLIT_W} ${OTHER_Y} L${SPLIT_W - 8} ${OTHER_Y + 5} Z`} fill="#0783fd" fillOpacity="0.7" />
              </svg>
              <span className="absolute rounded-full bg-[#0783fd]/10 px-2 py-0.5 text-[10px] font-bold text-[#0783fd]" style={{ left: 22, top: LEAD_Y - 24 }}>lead</span>
              <span className="absolute rounded-full bg-[#0783fd]/10 px-2 py-0.5 text-[10px] font-bold text-[#0783fd]" style={{ left: 20, top: OTHER_Y - 24 }}>other</span>
            </div>

            <div className="flex flex-col" style={{ gap: BRANCH_GAP }}>
              <BranchGroup nodes={c.branches.yes} />
              <BranchGroup nodes={c.branches.no} />
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">A real Talko AI automation — triggers, an AI agent, and channel actions, all no-code.</p>
      </Reveal>
    </div>
  );
}
