// Build the RNR drip from the message library, in one call.
//
// Five steps, three audience rules, a send window, a daily cap and an
// enrolment guard. Only one of those five can be set from the sequence
// editor today, so hand-building this journey would silently produce a
// different one — every step going to everybody, at any hour, as often as
// the delays allowed.
//
// GET  — what WOULD be built, what is held back, and what is still missing.
//        Changes nothing.
// POST — build it.

import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import {
  rnrSteps, heldSteps, buildSteps, validateButtons, templateDrafts,
  rnrSequenceSettings, type RnrSeedOptions,
} from "@/lib/rnrseed";
import {
  listSequences, createSequence, updateSequence, setSequenceSteps, getSequenceSteps,
} from "@/lib/sequences";
import { db } from "@/lib/supabase";
import { listChannels } from "@/lib/channels";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";
import { currentTenantId } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getChannel as tenantChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";

const SEQUENCE_NAME = "RNR follow-up";

function readOptions(body: Record<string, unknown>): RnrSeedOptions {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    channelId: String(body.channelId ?? "").trim(),
    courseAttr: typeof body.courseAttr === "string" && body.courseAttr.trim() ? body.courseAttr.trim() : undefined,
    cityAttr: typeof body.cityAttr === "string" && body.cityAttr.trim() ? body.cityAttr.trim() : undefined,
    sendStartHour: num(body.sendStartHour),
    sendEndHour: num(body.sendEndHour),
    includeHeld: body.includeHeld === true,
  };
}

/**
 * What still has to happen before this journey can send anything.
 *
 * Returned rather than assumed, because every one of these fails quietly:
 * an unapproved template is a send error buried in last_error, an unpinned
 * channel sends from the env default, and a missing response field means the
 * CRM workflow never fires.
 */
function outstanding(): string[] {
  const out: string[] = [];
  // Held steps are reported separately as `held`, with the same reason. They
  // were listed here too, so the screen printed each one twice under two
  // headings — which reads as two problems and makes the list look longer
  // than it is. One of them says "not included", which is the accurate one.
  if (!(process.env.LSQ_RNR_RESPONSE_FIELD ?? "").trim()) {
    out.push("LSQ_RNR_RESPONSE_FIELD is not set, so a tap writes no CRM field and the notify-the-owner workflow cannot fire.");
  }
  return out;
}

/**
 * The CRM fields the three gated steps match on.
 *
 * This used to be a warning that said they "default to course and city", and
 * it was simply untrue: the defaults are "Product Name" and "city", checked
 * against the live contacts when the drip was built. It therefore told you
 * the journey was about to match nobody while the rule printed directly
 * above it read "Product Name is ...".
 *
 * A warning that fires when nothing is wrong is worse than no warning. It is
 * a statement of fact now, shown once, and a reader can check it against the
 * rules on the same screen.
 */
function matchingOn(o: RnrSeedOptions): { course: string; city: string } {
  return { course: o.courseAttr?.trim() || "Product Name", city: o.cityAttr?.trim() || "city" };
}

export async function GET(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const url = new URL(req.url);
  const o = readOptions({
    channelId: url.searchParams.get("channelId") ?? "",
    courseAttr: url.searchParams.get("courseAttr") ?? undefined,
    cityAttr: url.searchParams.get("cityAttr") ?? undefined,
  });
  const steps = rnrSteps(o);
  const existing = (await listSequences(tenantId).catch(() => [])).find(s => s.name === SEQUENCE_NAME);
  return NextResponse.json({
    exists: !!existing,
    sequenceId: existing?.id ?? null,
    settings: rnrSequenceSettings(o),
    steps: steps.map(s => ({
      id: s.id, day: s.day, template: s.templateName, params: s.params,
      buttons: s.buttons, audience: s.audience, note: s.note ?? null,
    })),
    held: heldSteps(o).map(s => ({ id: s.id, template: s.templateName, reason: s.hold })),
    templates: templateDrafts(steps),
    problems: validateButtons(steps),
    todo: outstanding(),
    matchingOn: matchingOn(o),
  });
}

export async function POST(req: Request) {
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const o = readOptions(body);
  if (!o.channelId) {
    return NextResponse.json({ error: "Pick the number these go out from — an unpinned journey sends from the env default." }, { status: 400 });
  }

  const steps = rnrSteps(o);
  if (!steps.length) return NextResponse.json({ error: "Every drip step is on hold — there is nothing to seed." }, { status: 400 });

  // A label the router does not know, a body Meta will reject, or a variable
  // with no sample: each is a step that fails long after anybody is watching.
  const problems = validateButtons(steps);
  if (problems.length) return NextResponse.json({ error: problems.join(" · "), problems }, { status: 400 });

  try {
    const channel = (await listChannels(tenantId)).find(c => c.id === o.channelId);
    if (!channel) return NextResponse.json({ error: "That number is not connected." }, { status: 400 });

    const settings = rnrSequenceSettings(o);
    const existing = (await listSequences(tenantId)).find(s => s.name === SEQUENCE_NAME);

    // ── Never MOVE a lead who is part-way through ─────────────────────────
    //
    // Enrolments track their position by step INDEX. Re-seeding rewrites the
    // steps, so a lead sitting on index 3 would silently jump to whatever
    // now occupies it — a different message on a different day.
    //
    // But that is only true when the running order actually changes. The
    // commonest re-seed by far adds a course name to an audience list and
    // moves nothing: same templates, same indexes, same days, a wider
    // audience. Refusing that one is not caution, it is a refusal to apply
    // the fix — and the way round it is `force`, which also waves through
    // the renumbering this guard exists to prevent.
    //
    // So compare the running order instead of assuming it changed. A lead
    // can only be moved by a step list that differs, and when it differs we
    // say exactly how.
    if (existing && !body.force) {
      const { data: active } = await db().from("wa_sequence_enrollments")
        .select("id").eq("sequence_id", existing.id).eq("status", "active").limit(1);
      if ((active ?? []).length) {
        const current = await getSequenceSteps(existing.id, tenantId);
        const order = (xs: { templateName?: string; delayMinutes?: number }[]) =>
          JSON.stringify(xs.map(x => [x.templateName ?? "", x.delayMinutes ?? 0]));
        const before = order(current.map(c => ({
          templateName: (c.action as { templateName?: string })?.templateName,
          delayMinutes: c.delayMinutes,
        })));
        const after = order(buildSteps(steps).map(b => ({
          templateName: (b.action as { templateName?: string })?.templateName,
          delayMinutes: b.delayMinutes,
        })));
        if (before !== after) {
          return NextResponse.json({
            error: "Leads are part-way through this journey, and this rebuild changes the running order — they would move to a different message on a different day. Stop the enrolments first, or send force: true if that is what you want.",
          }, { status: 409 });
        }
      }
    }

    const id = existing?.id ?? (await createSequence(settings, tenantId)).id;
    if (existing) await updateSequence(id, settings, tenantId);
    await setSequenceSteps(id, buildSteps(steps), tenantId);

    // setSequenceSteps degrades when 0103 is not applied: the steps save but
    // the audience rules do not, which would send R+2, R+10 and R+15 to
    // everybody — including an unverified salary claim. Read them back and
    // say so rather than reporting success.
    const saved = await getSequenceSteps(id, tenantId);
    const wanted = steps.filter(s => s.audience).length;
    const kept = saved.filter(s => s.audience).length;

    logActivity(await currentUser(), "sequences.seed-rnr", `${steps.length} steps on ${channel.name ?? o.channelId}`);

    return NextResponse.json({
      success: true,
      id,
      created: !existing,
      steps: saved.length,
      audienceRules: kept,
      ...(wanted > kept
        ? { warning: `Migration 0103 is not applied: ${wanted - kept} audience rule(s) were NOT saved, so those steps will go to EVERY enrolled lead. Apply 0103 and re-seed before enrolling anybody.` }
        : {}),
      held: heldSteps(o).map(s => ({ id: s.id, template: s.templateName, reason: s.hold })),
      todo: outstanding(),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
