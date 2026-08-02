import type { Metadata } from "next";
import { CircleCheck, CircleAlert, CircleX, CircleDashed } from "lucide-react";
import { Container, Glow, SectionTitle } from "../_components/ui";
import { CtaBand } from "../_components/sections";
import { getPublicStatus, type PublicStatusLevel } from "@/lib/publicstatus";
import { INCIDENTS } from "../_content/incidents";

export const metadata: Metadata = {
  title: "System Status — Talko AI",
  description: "Live status of Talko AI's background automation engine — message delivery, AI replies, and every connected channel.",
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

export default async function StatusPage() {
  const status = await getPublicStatus();
  const meta = LEVEL_META[status.level];
  const Icon = meta.icon;

  return (
    <>
      <section className="relative overflow-hidden">
        <Glow className="left-1/2 top-[-160px] -translate-x-1/2" />
        <Container className="relative pt-20 pb-4">
          <SectionTitle level={1} eyebrow="Status" title="Talko AI system status"
            subtitle="A live look at the engine behind every automated reply, broadcast and channel." />
        </Container>
      </section>

      <Container className="py-8">
        <div className="mx-auto max-w-2xl">
          <div className={`flex items-center gap-3 rounded-2xl border p-6 ${meta.badge}`}>
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

          <div className="mt-8 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {SUBSYSTEMS.map(s => (
              <div key={s} className="flex flex-col gap-1.5 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="text-sm font-medium text-slate-700">{s}</span>
                <span className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} /> {status.level === "operational" ? "Operational" : status.level === "degraded" ? "Delayed" : status.level === "down" ? "Down" : "Unknown"}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-14">
            <h2 className="text-lg font-extrabold text-slate-900">Incident history</h2>
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
        </div>
      </Container>

      <CtaBand />
    </>
  );
}
