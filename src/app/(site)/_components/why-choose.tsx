"use client";

// "Why teams choose Talko AI" — a real product screen on a multi-colour gradient
// stage, with subtle scroll parallax. Layers (backdrop, frame, pill, blobs) move
// at different rates for depth. Parallax is fully disabled under reduced-motion.
import { useRef } from "react";
import Image from "next/image";
import { Bot, Check, Sparkles } from "lucide-react";
import { Container, SectionTitle, TONES } from "./ui";
import { useParallax } from "./motion";
import { WHY } from "../_content/site";

// translate3d alone GPU-promotes these layers for the brief time they scroll;
// a permanent will-change on 7 layers would keep that many compositor layers
// resident for the whole page (memory cost on low-end devices) for no gain.
const shift = (p: number, strength: number) => ({ transform: `translate3d(0, ${(p * strength).toFixed(1)}px, 0)` });

export function WhyChoose() {
  const ref = useRef<HTMLDivElement>(null);
  const p = useParallax(ref);

  return (
    <Container className="py-16">
      <section
        ref={ref}
        className="relative overflow-hidden rounded-[28px] px-5 py-14 sm:px-10
                   bg-[radial-gradient(120%_120%_at_0%_0%,#F3F0FF_0%,#FFFFFF_42%,#EAF5FF_100%)]
                   ring-1 ring-slate-100"
      >
        {/* Drifting colour blobs — the parallax background layer. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div style={shift(p, 110)} className="absolute -left-16 top-4 h-64 w-64 rounded-full bg-[#7c5cff]/20 blur-3xl" />
          <div style={shift(p, -90)} className="absolute -right-10 top-24 h-72 w-72 rounded-full bg-[#34d399]/20 blur-3xl" />
          <div style={shift(p, 64)} className="absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-[#F6B26B]/20 blur-3xl" />
        </div>

        <div className="relative">
          <SectionTitle title="Why teams choose Talko AI" subtitle="Talko AI learns your business and works the way your customers already chat." />
        </div>

        <div className="relative mt-12 grid items-center gap-10 lg:grid-cols-2">
          {/* LEFT — real product screen on an aurora gradient, with parallax. */}
          <div className="relative">
            {/* Aurora gradient backdrop (sits behind, drifts opposite the frame). */}
            <div aria-hidden style={shift(p, -70)}
              className="absolute -inset-5 -z-10 rotate-2 rounded-[34px] opacity-70 blur-2xl
                         bg-[linear-gradient(135deg,#0783fd_0%,#6f8cff_38%,#a06bff_66%,#34d399_100%)]" />

            <div style={shift(p, 40)} className="lg:-rotate-[1.2deg]">
              <div className="overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_30px_70px_-30px_rgba(124,92,255,0.35),0_10px_28px_-14px_rgba(0,0,0,0.12)]">
                <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <span className="flex gap-1.5">{["#f87171", "#fbbf24", "#34d399"].map(c => <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />)}</span>
                  <span className="mx-auto max-w-[60%] truncate rounded-md border border-slate-200 bg-white px-3 py-1 text-center text-[11px] font-medium text-slate-400">app.talko.ai / live-chat</span>
                </div>
                <div className="relative aspect-[1600/910] w-full bg-white">
                  <Image src="/tour/inbox.png" alt="Talko AI unified inbox answering a customer from the knowledge base" fill sizes="(min-width: 1024px) 560px, 100vw" className="object-contain" />
                </div>
              </div>
            </div>

            {/* Floating accent pill — foreground layer, drifts most. */}
            <div aria-hidden style={shift(p, -96)}
              className="absolute -bottom-4 left-4 flex items-center gap-2 rounded-full border border-slate-100 bg-white/95 px-3.5 py-2 shadow-[0_16px_40px_-18px_rgba(7,131,253,0.5)] backdrop-blur sm:left-8">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#0783fd] to-[#7c5cff] text-white"><Bot className="h-4 w-4" /></span>
              <span className="text-[12px] font-bold text-slate-900">AI replied in 2s</span>
              <span className="text-[11px] font-semibold text-[#2f9e6e]">· brand voice</span>
            </div>
          </div>

          {/* RIGHT — benefit cards, spread across colour families. */}
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#7c5cff]/20 bg-[#7c5cff]/5 px-3 py-1 text-xs font-semibold text-[#7c5cff]">
              <Sparkles className="h-3.5 w-3.5" /> Built for outcomes
            </span>
            <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">
              Why <span className="bg-gradient-to-r from-[#0783fd] to-[#7c5cff] bg-clip-text text-transparent">Talko AI</span>?
            </h3>
            <p className="mt-2 text-sm text-slate-500">Reply faster, capture every lead, and run conversations at scale without growing your team.</p>
            <div className="mt-6 space-y-4">
              {WHY.map(b => {
                const tone = TONES[b.tone];
                return (
                  <div key={b.title} className={`rounded-2xl ${tone.bg} p-5 ring-1 ${tone.ring} transition-transform hover:-translate-y-0.5`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}><Check className="h-4 w-4" /></span>
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-900">{b.title}</h4>
                        <p className="mt-1 text-sm leading-relaxed text-slate-600">{b.body}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </Container>
  );
}
