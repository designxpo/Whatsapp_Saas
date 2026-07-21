import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { POSTS } from "../_content/site";

export const metadata: Metadata = {
  title: "WhatsApp & Instagram Automation Blog — Talko AI",
  description: "Playbooks, product updates and compliance guides for automating WhatsApp, Instagram, Messenger and website chat.",
  openGraph: {
    title: "WhatsApp & Instagram Automation Blog — Talko AI",
    description: "Playbooks, product updates and compliance guides for automating WhatsApp, Instagram, Messenger and website chat.",
  },
};

export default function BlogPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Blog" title="Discover our latest articles"
            subtitle="Playbooks, product updates and compliance guides to help you get more from every conversation." />
        </Container>
      </section>

      <Container className="py-12">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {POSTS.map(p => (
            <Link key={p.slug} href={`/blog/${p.slug}`}
              className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_12px_-6px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_12px_30px_-12px_rgba(24,119,242,0.3)]">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-[#0783fd]/10 px-2.5 py-1 font-bold text-[#0783fd]">{p.category}</span>
                <span>{p.readTime}</span>
              </div>
              <h3 className="mt-4 text-lg font-bold leading-snug text-slate-900 group-hover:text-[#0783fd]">{p.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-500">{p.excerpt}</p>
              <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                <span>{p.date}</span>
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          ))}
        </div>
      </Container>

      <CtaBand />
    </>
  );
}
