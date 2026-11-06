"use client";

import { useEffect, useState } from "react";

export type ArticleSection = { id: string; title: string };

export function ArticleNavigator({ sections }: { sections: ArticleSection[] }) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const article = document.getElementById("article-reading-region");
      if (!article) return;
      const bounds = article.getBoundingClientRect();
      const distance = Math.max(1, bounds.height - window.innerHeight + 120);
      setProgress(Math.round(Math.max(0, Math.min(100, (120 - bounds.top) / distance * 100))));
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
  const links = <ol className="space-y-1.5">{sections.map(section => <li key={section.id}>
    <a href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined} className={`block rounded-lg border-l-2 px-3 py-2 text-sm leading-relaxed ${active === section.id ? "border-[#026cd4] bg-blue-50 font-semibold text-[#026cd4]" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-[#026cd4]"}`}>{section.title}</a>
  </li>)}</ol>;
  return <aside aria-label="Reading guide" className="rounded-2xl border border-slate-200 bg-white p-4 lg:sticky lg:top-28 lg:self-start lg:p-5">
    <a href="#article-content" className="text-xs font-bold uppercase tracking-wide text-[#026cd4]">Read the article</a>
    <div className="mt-3 flex justify-between text-xs text-slate-500"><span>Page position</span><span>{progress}%</span></div>
    <div role="progressbar" aria-label="Article scroll position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-gradient-to-r from-[#0783fd] to-violet-500" style={{ width: `${progress}%` }} /></div>
    <details className="mt-4 lg:hidden"><summary className="min-h-8 cursor-pointer text-sm font-bold text-slate-800">In this article</summary><nav aria-label="Article contents" className="mt-3">{links}</nav></details>
    <div className="mt-5 hidden lg:block"><p className="mb-3 text-sm font-bold text-slate-900">In this article</p><nav aria-label="Article contents" className="max-h-[55vh] overflow-y-auto">{links}</nav></div>
  </aside>;
}
