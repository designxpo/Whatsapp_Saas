import { NextResponse } from "next/server";
import { setSetting } from "@/lib/store";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// Where the nightly content pipeline files its research.
//
// The gap report was only ever a GitHub Actions artifact, which meant seeing
// what competitors are writing about took five clicks and a JSON download —
// enough friction that nobody looks, and the research half of the pipeline
// becomes invisible work. This gives it somewhere the Owner Console can read.
//
// Stored in wa_settings rather than a new table on purpose: it is one small
// document, overwritten nightly, with no history worth querying — and a new
// table means a migration, which on this project means a human pasting SQL
// into Supabase before the feature works at all.
//
// Auth is CRON_SECRET, the same bearer the rest of the cron surface uses.

const KEY = "content_pipeline_report";
/** Keep the payload small — this is a settings row, not a data warehouse. */
const MAX_GAPS = 25;

export interface ContentGapRow {
  topic: string; label: string; covered: string[]; examples: string[];
  score: number; penalties: { reason: string; points: number }[];
}
export interface ContentReport {
  ranAt: string;
  crawled: { competitor: string; pages: number }[];
  gaps: ContentGapRow[];
  /** What the pipeline did with the top gap, so the console can say so. */
  outcome: "dry-run" | "pr-opened" | "failed";
  prUrl?: string | null;
  error?: string | null;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as Partial<ContentReport>;
    if (!Array.isArray(body.gaps)) return NextResponse.json({ error: "gaps[] required" }, { status: 400 });
    const report: ContentReport = {
      ranAt: body.ranAt || new Date().toISOString(),
      crawled: Array.isArray(body.crawled) ? body.crawled : [],
      gaps: body.gaps.slice(0, MAX_GAPS) as ContentGapRow[],
      outcome: body.outcome === "pr-opened" || body.outcome === "failed" ? body.outcome : "dry-run",
      prUrl: body.prUrl ?? null,
      error: body.error ?? null,
    };
    await setSetting(KEY, JSON.stringify(report));
    return NextResponse.json({ ok: true, gaps: report.gaps.length });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
