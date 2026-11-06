"use client";

import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";

export type ArticleSection = { id: string; title: string };

export function ArticleNavigator({ sections }: { sections: ArticleSection[] }) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  // Phones: a slim bar pinned to the bottom while the article is on screen.
  const [inArticle, setInArticle] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const article = document.getElementById("article-reading-region");
      if (!article) return;
      const bounds = article.getBoundingClientRect();
      const distance = Math.max(1, bounds.height - window.innerHeight + 120);
      setProgress(Math.round(Math.max(0, Math.min(100, (120 - bounds.top) / distance * 100))));
      setInArticle(bounds.top < window.innerHeight * 0.7 && bounds.bottom > window.innerHeight * 0.3);
      const passed = sections.filter(section => {
        const heading = document.getElementById(section.id);
        return heading && heading.getBoundingClientRect().top <= 170;
      });
      setActive(passed.at(-1)?.id ?? sections[0]?.id ?? "");
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [sections]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  const showBar = inArticle || menuOpen;
  const links = <ol className="space-y-1.5">{sections.map(section => <li key={section.id}>
    <a href={`#${section.id}`} onClick={() => setMenuOpen(false)} aria-current={active === section.id ? "location" : undefined} className={`block rounded-lg border-l-2 px-3 py-2 text-sm leading-relaxed ${active === section.id ? "border-[#026cd4] bg-blue-50 font-semibold text-[#026cd4]" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-[#026cd4]"}`}>{section.title}</a>
  </li>)}</ol>;
  const activeTitle = sections.find(section => section.id === active)?.title ?? "Reading";
  return <>
    <aside aria-label="Reading guide" className="hidden rounded-2xl border border-slate-200 bg-white p-5 lg:sticky lg:top-28 lg:block lg:self-start">
      <a href="#article-content" className="text-xs font-bold uppercase tracking-wide text-[#026cd4]">Read the article</a>
      <div className="mt-3 flex justify-between text-xs text-slate-500"><span>Page position</span><span>{progress}%</span></div>
      <div role="progressbar" aria-label="Article scroll position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-gradient-to-r from-[#0783fd] to-violet-500" style={{ width: `${progress}%` }} /></div>
      <div className="mt-5"><p className="mb-3 text-sm font-bold text-slate-900">In this article</p><nav aria-label="Article contents" className="max-h-[55vh] overflow-y-auto">{links}</nav></div>
    </aside>
    <div aria-label="Reading progress" role="region" className={`fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 transition duration-200 motion-reduce:transition-none lg:hidden ${showBar ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}>
      {menuOpen && sections.length > 0 && <nav id="article-contents-sheet" aria-label="Article contents" className="mb-2 max-h-[55vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">{links}</nav>}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur">
        {sections.length > 0
          ? <button type="button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-controls="article-contents-sheet" className="flex min-h-11 w-full items-center gap-3 px-4 text-left">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{activeTitle}</span>
              <span className="text-xs tabular-nums text-slate-500">{progress}%</span>
              <ChevronUp size={16} aria-hidden="true" className={`shrink-0 text-slate-500 transition-transform motion-reduce:transition-none ${menuOpen ? "" : "rotate-180"}`} />
            </button>
          : <div className="flex min-h-11 items-center justify-between px-4 text-xs"><span className="font-semibold text-slate-800">Reading</span><span className="tabular-nums text-slate-500">{progress}%</span></div>}
        <div role="progressbar" aria-label="Article scroll position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="absolute inset-x-0 bottom-0 h-[3px] bg-slate-100"><div className="h-full bg-gradient-to-r from-[#0783fd] to-violet-500" style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  </>;
}
