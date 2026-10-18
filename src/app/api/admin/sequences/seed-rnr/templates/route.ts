// Submit the RNR templates to Meta for approval.
//
// Nine templates, transcribed once in rnrseed.ts and submitted from the same
// definition the sequence steps are built from — so an approved template and
// the step that sends it can never disagree about its name, its language or
// how many variables it has.
//
// ── Why this is its own route, and a POST ──────────────────────────────────
//
// Submitting is outward-facing and slow to undo: the template goes into
// Meta's review queue under the business's name, and deleting it afterwards
// removes every language version. So it is never a side effect of seeding
// the sequence — somebody has to ask for it.
//
// GET  — what exists on this number already, and what would be submitted.
// POST — submit the ones that are not there yet.
//
// ── Already-submitted is not an error ──────────────────────────────────────
//
// Meta refuses a duplicate name outright, so re-running this after adding a
// tenth template must not fail on the nine that are already up. Existing
// names are skipped and reported as skipped.

import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, isPlatformOwner } from "@/lib/auth";
import { rnrTemplates, templateDrafts, validateButtons, type RnrSeedOptions } from "@/lib/rnrseed";
import { createTemplate, fetchTemplates } from "@/lib/whatsapp";
import { credsFor, listChannels } from "@/lib/channels";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";
import { currentTenantId } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { getChannel as tenantChannel } from "@/lib/channels";

export const dynamic = "force-dynamic";
export const maxDuration = 60;        // nine sequential Graph calls

interface Existing { name: string; status: string; language: string }

async function onMeta(channelId: string, tenantId: string): Promise<Existing[]> {
  const creds = await credsFor(channelId, tenantId);
  const list = await fetchTemplates(creds ?? undefined);
  return (list ?? []).map(t => ({
    name: String((t as { name?: unknown }).name ?? ""),
    status: String((t as { status?: unknown }).status ?? ""),
    language: String((t as { language?: unknown }).language ?? ""),
  }));
}

const opts = (channelId: string, phase?: string | null): RnrSeedOptions & { phase: string } => ({
  channelId, includeHeld: true, phase: (phase ?? "all").toLowerCase(),
});

/** Which templates this call is about. Held ones are still submittable. */
function chosen(o: RnrSeedOptions & { phase: string }) {
  const all = rnrTemplates(o);
  if (o.phase === "drip") return all.filter(t => t.phase === "drip");
  if (o.phase === "calling") return all.filter(t => t.phase === "calling");
  return all;
}

export async function GET(req: Request) {
  // AnalytixLabs's own RNR campaign: their template names and course lists. Not a
  // tenant feature, so only the platform owner can reach it.
  if (!(await isPlatformOwner())) return new Response("Not found", { status: 404 });
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const url = new URL(req.url);
  const channelId = (url.searchParams.get("channelId") ?? "").trim();
  if (!channelId) return NextResponse.json({ error: "channelId is required — templates live on one account." }, { status: 400 });

  try {
    const o = opts(channelId, url.searchParams.get("phase"));
    const list = chosen(o);
    const have = new Map((await onMeta(channelId, tenantId)).map(t => [t.name, t]));
    return NextResponse.json({
      problems: validateButtons(list),
      templates: list.map(t => ({
        id: t.id, name: t.templateName, phase: t.phase, hold: t.hold,
        variables: t.params.length, buttons: t.buttons,
        onMeta: have.get(t.templateName)?.status ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // AnalytixLabs's own RNR campaign: their template names and course lists. Not a
  // tenant feature, so only the platform owner can reach it.
  if (!(await isPlatformOwner())) return new Response("Not found", { status: 404 });
  const tenantId = await currentTenantId();
  if (!tenantId) return new Response("Unauthorized", { status: 401 });
  const gate = await guardFeature(tenantId, "sequences"); if (gate) return gate;
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const channelId = String(body.channelId ?? "").trim();
  if (!channelId) return NextResponse.json({ error: "channelId is required — templates live on one account." }, { status: 400 });

  const o = opts(channelId, typeof body.phase === "string" ? body.phase : null);
  const list = chosen(o);

  // Validate BEFORE submitting anything. A rejection arrives by email days
  // later, and a button Meta silently truncates is a step whose taps route
  // to nothing forever — both are much cheaper to catch here.
  const problems = validateButtons(list);
  if (problems.length) return NextResponse.json({ error: problems.join(" · "), problems }, { status: 400 });

  try {
    const channel = (await listChannels(tenantId)).find(c => c.id === channelId);
    if (!channel) return NextResponse.json({ error: "That number is not connected." }, { status: 400 });
    const creds = (await credsFor(channelId, tenantId)) ?? undefined;

    const have = new Map((await onMeta(channelId, tenantId)).map(t => [t.name, t]));
    const drafts = templateDrafts(list);

    const results: { name: string; outcome: "submitted" | "exists" | "failed"; status?: string; error?: string }[] = [];
    for (const d of drafts) {
      const already = have.get(d.name);
      if (already) { results.push({ name: d.name, outcome: "exists", status: already.status }); continue; }
      const r = await createTemplate(d, creds);
      if (r.error) results.push({ name: d.name, outcome: "failed", error: r.error });
      else results.push({ name: d.name, outcome: "submitted", status: r.status ?? "PENDING" });
    }

    const submitted = results.filter(r => r.outcome === "submitted").length;
    logActivity(await currentUser(), "templates.rnr-submit", `${submitted} submitted on ${channel.name ?? channelId}`);

    return NextResponse.json({
      success: results.every(r => r.outcome !== "failed"),
      submitted,
      skipped: results.filter(r => r.outcome === "exists").length,
      failed: results.filter(r => r.outcome === "failed").length,
      results,
      note: "Approval is Meta's, not ours. Marketing templates are usually reviewed within minutes but may take up to 24 hours; a rejection arrives by email.",
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
