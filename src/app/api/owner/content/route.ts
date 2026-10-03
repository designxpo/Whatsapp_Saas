import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { getSetting } from "@/lib/store";
import { errorMessage } from "@/lib/errors";
import type { ContentReport } from "../../cron/content-report/route";

export const dynamic = "force-dynamic";

const KEY = "content_pipeline_report";
const REPO = process.env.GITHUB_REPO || "designxpo/Whatsapp_Saas";
const WORKFLOW = "content-pipeline.yml";

// GET — the latest gap report, plus any content PRs still waiting to be read.
//
// The PR list is live from GitHub rather than stored, because its whole value
// is being current: a report saying "PR open" that was merged this morning is
// worse than no report. It needs GITHUB_TOKEN; without one the page says so
// instead of quietly showing an empty list, which would read as "no drafts".
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    const raw = await getSetting<string>(KEY, "");
    const report: ContentReport | null = raw ? JSON.parse(raw) : null;
    const token = process.env.GITHUB_TOKEN;

    let prs: { number: number; title: string; url: string; draft: boolean; createdAt: string }[] = [];
    if (token) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/pulls?state=open&per_page=20`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (r?.ok) {
        const list = (await r.json()) as { number: number; title: string; html_url: string; draft: boolean; created_at: string; head: { ref: string } }[];
        prs = list
          .filter(p => p.head?.ref?.startsWith("content/"))
          .map(p => ({ number: p.number, title: p.title, url: p.html_url, draft: !!p.draft, createdAt: p.created_at }));
      }
    }
    return NextResponse.json({
      report,
      prs,
      // Both are separately absent-able, and the page explains each.
      githubConfigured: !!token,
      canTrigger: !!token,
      workflowUrl: `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`,
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — fire the workflow. `dryRun` does research only and writes nothing.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN is not set — the console cannot start a run." }, { status: 400 });
  try {
    const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { dry_run: dryRun ? "true" : "false" } }),
      signal: AbortSignal.timeout(15_000),
    });
    // 204 is the success case for workflow_dispatch — it returns no body.
    if (r.status !== 204) {
      return NextResponse.json({ error: `GitHub returned ${r.status}: ${(await r.text()).slice(0, 200)}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, dryRun: !!dryRun });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
