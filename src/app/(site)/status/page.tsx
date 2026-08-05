import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleAlert, CircleX, CircleDashed } from "lucide-react";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { JsonLd } from "../_components/json-ld";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { KeyTakeaway, PageFaq, SourceList } from "../_components/seo";
import { webPageSchema } from "../_content/schema";
import { STATUS_SEO } from "../_content/pageseo";
import { getPublicStatus, OPERATIONAL_MAX_MIN, type PublicStatusLevel } from "@/lib/publicstatus";
import { INCIDENTS } from "../_content/incidents";

const PATH = "/status";
const TITLE = "Talko AI System Status — Live Engine Health & Incidents";
const DESCRIPTION = "Live status of Talko AI's background automation engine — message delivery, AI replies, and every connected channel.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
};

export const dynamic = "force-dynamic";

const LEVEL_META: Record<PublicStatusLevel, { label: string; icon: typeof CircleCheck; badge: string; dot: string }> = {
  operational: { label: "All systems operational", icon: CircleCheck, badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  degraded: { label: "Delayed — running behind", icon: CircleAlert, badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  down: { label: "Background engine appears down", icon: CircleX, badge: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  unknown: { label: "Status unavailable", icon: CircleDashed, badge: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-400" },
};

const SUBSYSTEMS = [
  "WhatsApp, Instagram & Messenger message delivery",
  "AI auto-replies",
  "YouTube comment automation",
  "Google Business Profile review replies",
  "Broadcasts & drip sequences",
];

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

// How to interpret each badge, in the engine's own numbers rather than vague
// adjectives. The operational window is imported from publicstatus.ts, so this
// table can't describe a threshold the page no longer uses.
const READING: { label: string; body: string }[] = [
  { label: "Operational", body: `The engine completed a pass within the last ${OPERATIONAL_MAX_MIN} minutes. Queued work is being processed on schedule.` },
  { label: "Delayed", body: `The last completed pass was more than ${OPERATIONAL_MAX_MIN} minutes but less than an hour ago. Nothing is lost — automated replies, broadcasts and comment responses are running behind and will catch up in order.` },
  { label: "Down", body: "No completed pass for over an hour. Automated work is queuing and not being processed; we treat this as an incident and post one below." },
  { label: "Unknown", body: "No heartbeat has been recorded at all, so there is nothing to measure yet. This is what a brand-new deployment shows before its first pass." },
];

export default async function StatusPage() {
  const status = await getPublicStatus();
  const meta = LEVEL_META[status.level];
  const Icon = meta.icon;
  const subsystemLabel = status.level === "operational" ? "Operational" : status.level === "degraded" ? "Delayed" : status.level === "down" ? "Down" : "Unknown";

  return (
    <>
      <JsonLd data={webPageSchema({ path: PATH, name: TITLE, description: DESCRIPTION, updated: STATUS_SEO.updated, published: STATUS_SEO.published })} />

      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-16 pb-4">
          <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Status", href: PATH }]} />
          <SectionTitle level={1} eyebrow="Status" title="Talko AI system status — live engine health and incidents"
            subtitle="A live look at the engine behind every automated reply, broadcast and channel." />
          <KeyTakeaway updated={STATUS_SEO.updated}>
            <p>
              <strong className="font-semibold text-slate-900">This page reports one thing, measured directly: whether the background engine that runs every automated action has checked in recently.</strong>{" "}
              That engine wakes every five minutes, and records a heartbeat each time it finishes a pass. A pass completed within
              the last {OPERATIONAL_MAX_MIN} minutes reads as operational; longer than that is delayed; over an hour is down.
            </p>
            <p>
              It is for customers checking whether a delay is on our side or theirs. If this page says operational but your messages are
              not sending, the cause is almost always channel-side — an expired Meta token, an unapproved template, or a send outside
              WhatsApp&apos;s 24-hour customer service window. The{" "}
              <Link href="/guides/troubleshooting" className="font-semibold text-[#0783fd] hover:underline">troubleshooting guide</Link> covers those by symptom.
            </p>
          </KeyTakeaway>
        </Container>
      </section>

      <Container className="pt-12 pb-8">
        <div className="mx-auto max-w-2xl">
          <h2 id="current" className="scroll-mt-24 text-lg font-extrabold text-slate-900">Current status</h2>
          <div className={`mt-4 flex items-center gap-3 rounded-2xl border p-6 ${meta.badge}`}>
            <Icon className="h-7 w-7 shrink-0" />
            <div>
              <p className="text-lg font-extrabold">{meta.label}</p>
              <p className="text-xs opacity-80">
                {status.lastHeartbeatAt
                  ? `Background engine last ran ${status.heartbeatAgeMinutes} minute${status.heartbeatAgeMinutes === 1 ? "" : "s"} ago, at ${formatTimestamp(status.lastHeartbeatAt)}.`
                  : "No heartbeat has been recorded yet."}
              </p>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-slate-400">
            Every automated feature below runs on the same background engine, checked every few minutes — so they share one status rather than
            being monitored independently. This page checks that engine&apos;s own heartbeat directly; it isn&apos;t a marketing claim.
          </p>

          <h2 id="subsystems" className="mt-14 scroll-mt-24 text-lg font-extrabold text-slate-900">What this status covers</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            These five are jobs run by the same worker, which is why they share a single state rather than reporting independently.
          </p>
          <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {SUBSYSTEMS.map(s => (
              <li key={s} className="flex flex-col gap-1.5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-sm font-medium text-slate-700">{s}</span>
                <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} /> {subsystemLabel}
                </span>
              </li>
            ))}
          </ul>

          <h2 id="how-to-read" className="mt-14 scroll-mt-24 text-lg font-extrabold text-slate-900">How to read this page</h2>
          <dl className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {READING.map(r => (
              <div key={r.label} className="px-6 py-4">
                <dt><h3 className="text-sm font-bold text-slate-900">{r.label}</h3></dt>
                <dd className="mt-1 text-sm leading-relaxed text-slate-500">{r.body}</dd>
              </div>
            ))}
          </dl>

          <h2 id="incidents" className="mt-14 scroll-mt-24 text-lg font-extrabold text-slate-900">Incident history</h2>
          {INCIDENTS.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No incidents reported. We post here as soon as something customer-visible breaks.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {INCIDENTS.map(inc => (
                <div key={`${inc.date}-${inc.title}`} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-900">{inc.title}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${inc.resolved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {inc.resolved ? "Resolved" : "Ongoing"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{inc.date}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{inc.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Container>

      <Container className="py-16">
        <PageFaq items={STATUS_SEO.faqs} path={PATH} title="Questions about platform status" />
        <SourceList items={STATUS_SEO.sources} className="mt-14" />
      </Container>

      <CtaBand />
    </>
  );
}
