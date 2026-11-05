"use client";

import Link from "next/link";
import { track } from "@/lib/analytics";

export function BlogLeadCta({ slug, title, text, label }: {
  slug: string; title: string; text: string; label: string;
}) {
  return <aside className="rounded-2xl border border-[#0783fd]/20 bg-[#0783fd]/5 p-6" aria-label="Discuss this workflow">
    <h2 className="text-xl font-bold text-slate-900">{title}</h2>
    <p className="mt-3 leading-relaxed text-slate-600">{text}</p>
    <Link href={`/contact?blog=${encodeURIComponent(slug)}`}
      onClick={() => track("blog_cta_click", { article: slug, campaign: "2026-11-global-blog" })}
      className="marketing-button marketing-button-primary mt-5">{label}</Link>
  </aside>;
}
