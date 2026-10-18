import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import { getStagePoll, setStagePoll, runStagePoll } from "@/lib/stagepoll";
import { logActivity } from "@/lib/team";
import { currentTenantId } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getChannel as tenantChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

// The stage poll asks LeadSquared which leads reached the hand-off stage,
// because LeadSquared has no API for creating the Automation that would
// otherwise tell us. This is its on/off switch.
//
// Admin-only on BOTH verbs, unlike the stage-drip map beside it. Reading the
// map tells you how the system is wired; reading this tells you how far
// through the CRM the sweep has got and when it last ran, and switching it on
// starts sending marketing templates to real people. That is an owner's
// decision, not a lead's.

export async function GET() {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  return NextResponse.json({ poll: await getStagePoll(tenantId) });
}

// POST { enabled?, stage?, maxPerRun?, burstAlarm?, resetWatermark?, runNow? }
export async function POST(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: {
    enabled?: boolean; mode?: "observe" | "apply"; stage?: string;
    maxPerRun?: number; burstAlarm?: number; resetWatermark?: boolean; runNow?: boolean;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const patch: Parameters<typeof setStagePoll>[0] = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.stage === "string") patch.stage = body.stage.trim();
  // Only the exact word switches it on. getStagePoll() refuses anything else
  // too, but saying it here means a typo never even reaches the settings row.
  if (body.mode === "apply" || body.mode === "observe") patch.mode = body.mode;
  if (Number(body.maxPerRun) > 0) patch.maxPerRun = Math.min(500, Math.floor(Number(body.maxPerRun)));
  if (Number(body.burstAlarm) > 0) patch.burstAlarm = Math.min(5000, Math.floor(Number(body.burstAlarm)));

  // Clearing the watermark re-seeds on the next pass: the current population
  // of the stage is treated as already-seen and nobody is enrolled for it.
  // That is the SAFE reset, and the only one offered — a reset that replayed
  // history would mean messaging everyone already parked on the stage.
  if (body.resetWatermark) patch.watermark = null;

  // Changing the stage invalidates the watermark, because it was measured
  // against a different population. Re-seed rather than carry it over, or
  // switching stages would enrol everyone who ever moved onto the new one.
  if (patch.stage !== undefined && patch.stage !== (await getStagePoll(tenantId)).stage) patch.watermark = null;

  const poll = await setStagePoll(patch, tenantId);
  logActivity(await currentUser(), "stagepoll.save", `${poll.enabled ? "on" : "off"}${poll.stage ? ` · ${poll.stage}` : ""}`);

  // runNow is for proving the wiring without waiting for the cron. It is the
  // same pass the cron runs, rails and all.
  const run = body.runNow ? await runStagePoll(undefined, tenantId) : undefined;
  return NextResponse.json({ poll: await getStagePoll(tenantId), ...(run ? { run } : {}) });
}
