"use client";

// Content — what the nightly pipeline found, and what it drafted.
//
// The research half used to live only in a GitHub Actions artifact: five
// clicks and a JSON download to see what competitors are writing about. That
// is enough friction that nobody looks, which makes half the pipeline
// invisible. Reviewing the draft itself stays in the PR, where a diff and
// line comments beat anything built here — merging IS publishing.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileText, Play, RefreshCw, Search } from "lucide-react";
import { Panel, Badge, EmptyState, Spinner, MetricTile, ago, type Tone } from "../_ui";

type Gap = {
  topic: string; label: string; covered: string[]; examples: string[];
  score: number; penalties: { reason: string; points: number }[];
};
type Report = {
  ranAt: string; crawled: { competitor: string; pages: number }[]; gaps: Gap[];
  outcome: "dry-run" | "pr-opened" | "failed"; prUrl?: string | null; error?: string | null;
};
type Pr = { number: number; title: string; url: string; draft: boolean; createdAt: string };
type Data = { report: Report | null; prs: Pr[]; githubConfigured: boolean; canTrigger: boolean; workflowUrl: string };

const OUTCOME: Record<string, { tone: Tone; label: string }> = {
  "dry-run": { tone: "info", label: "Research only" },
  "pr-opened": { tone: "ok", label: "Draft opened" },
  failed: { tone: "bad", label: "Failed" },
};

export default function ContentPage() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "dry" | "full">("");
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/owner/content");
      const j = await r.json();
      if (!r.ok || j.error) { setErr(j.error || "Couldn't load the content report."); return; }
      setErr(null); setD(j);
    } catch { setErr("Couldn't reach the server."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "full"); setNote(null);
    try {
      const r = await fetch("/api/owner/content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      const j = await r.json();
      setNote(r.ok && !j.error
        ? `Started. A crawl takes 15–30 minutes${dryRun ? "" : ", and drafting adds a few more"} — this page won't update until it files its report.`
        : j.error || "Couldn't start the run.");
    } catch { setNote("Couldn't reach the server."); }
    finally { setBusy(""); }
  }

  if (!d && !err) return <Spinner />;
  const report = d?.report ?? null;
  const pages = report?.crawled.reduce((n, c) => n + c.pages, 0) ?? 0;
  const clean = report?.gaps.filter(g => !g.penalties.length).length ?? 0;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-brand-dark">Content</h1>
          <p className="text-sm text-ink-600">
            What competitors publish that we don&apos;t, ranked — and the drafts the nightly pipeline opened from it.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={() => run(true)} disabled={!d?.canTrigger || !!busy}
            className="px-3 py-2 rounded-control border border-line text-xs font-bold text-ink-900 hover:bg-canvas disabled:opacity-50 inline-flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> {busy === "dry" ? "Starting…" : "Research only"}
          </button>
          <button onClick={() => run(false)} disabled={!d?.canTrigger || !!busy}
            className="px-3 py-2 rounded-control bg-brand-700 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
            <Play className="w-3.5 h-3.5" /> {busy === "full" ? "Starting…" : "Run and draft"}
          </button>
        </div>
      </header>

      {err && <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-sm text-red-700">{err}</div>}
      {note && <div className="bg-brand-50 border border-brand-100 rounded-card px-4 py-3 text-[13px] text-brand-800">{note}</div>}

      {d && !d.githubConfigured && (
        // Two separate things break without a token, and the difference
        // matters: the buttons above are inert, AND an empty PR list below
        // would otherwise read as "no drafts waiting" rather than "unknown".
        <div className="bg-amber-50 border border-amber-200 rounded-card px-4 py-3 text-[12px] text-amber-900 space-y-1">
          <p className="font-bold">GITHUB_TOKEN isn&apos;t set — runs can&apos;t be started from here, and open drafts can&apos;t be listed.</p>
          <p>
            Add a token with <code className="font-mono">actions:write</code> and <code className="font-mono">pull_requests:read</code>.
            The nightly schedule still runs regardless; this only affects the controls on this page.
          </p>
        </div>
      )}

      {!report ? (
        <Panel>
          <EmptyState icon={<FileText className="w-5 h-5" />} title="No research filed yet"
            body="The pipeline posts its report here at the end of each run. Start one with Research only — it crawls and ranks without writing anything." />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile label="Gaps found" value={report.gaps.length} sub={`${clean} with no penalty`} />
            <MetricTile label="Pages crawled" value={pages} sub={`${report.crawled.length} competitors`} />
            <MetricTile label="Open drafts" value={d?.githubConfigured ? d.prs.length : "—"} tone={d?.prs.length ? "ok" : undefined} />
            <MetricTile label="Last run" value={ago(report.ranAt)} sub={OUTCOME[report.outcome]?.label} />
          </div>

          {report.error && (
            <div className="bg-red-50 border border-red-200 rounded-card px-4 py-3 text-[13px] text-red-700">
              Last run reported: {report.error}
            </div>
          )}

          {!!d?.prs.length && (
            <Panel title="Drafts waiting for review" dense>
              <div className="divide-y divide-line">
                {d.prs.map(pr => (
                  <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 px-4 py-2.5 hover:bg-canvas">
                    <span className="flex-1 text-[13px] font-semibold text-ink-900 truncate">{pr.title}</span>
                    {pr.draft && <Badge tone="warn">checks failed</Badge>}
                    <span className="text-[11px] text-ink-400">{ago(pr.createdAt)}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-ink-400" />
                  </a>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Topic gaps" dense
            action={<a href={d?.workflowUrl} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Run history <ExternalLink className="w-3 h-3" /></a>}>
            {/* The honesty note belongs next to the numbers, not in a footnote.
                Someone reading a ranked list assumes volume data sits behind it. */}
            <p className="px-4 pt-3 text-[11px] leading-relaxed text-ink-400">
              Ranked by how many competitors cover each topic, corrected for format and relevance.
              This is a <b>proxy for demand, not search volume</b> — real volume needs a paid keyword API.
            </p>
            <div className="divide-y divide-line">
              {report.gaps.map(g => (
                <div key={g.topic} className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className={`shrink-0 tnum rounded-control px-1.5 py-0.5 text-[11px] font-bold ${g.penalties.length ? "bg-canvas text-ink-400" : "bg-brand-50 text-brand-700"}`}>
                      {g.score}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-ink-900">{g.label}</p>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {/* max() because the crawl list can be shorter than a
                            topic's coverage on a partial report — "4 of 3
                            competitors" reads as a broken page, not as data. */}
                        {g.covered.length} of {Math.max(report.crawled.length, g.covered.length)} competitors — {g.covered.join(", ")}
                      </p>
                      {g.penalties.map(p => (
                        <p key={p.reason} className="mt-1 text-[11px] text-amber-700">↳ {p.reason} ({p.points})</p>
                      ))}
                    </div>
                    {!!g.examples.length && (
                      <a href={g.examples[0]} target="_blank" rel="noreferrer" title="Open a competitor's page on this topic"
                        className="shrink-0 text-ink-400 hover:text-brand-700"><ExternalLink className="w-3.5 h-3.5" /></a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <button onClick={() => void load()} className="text-xs font-semibold text-ink-600 hover:text-brand-700 inline-flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </>
      )}
    </div>
  );
}
