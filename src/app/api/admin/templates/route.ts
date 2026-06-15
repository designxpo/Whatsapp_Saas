import { NextResponse } from "next/server";
import { fetchTemplates, createTemplate, deleteTemplate, type CreateTemplateInput, type TemplateButton } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { setTemplateMeta, siteUrl, type TrackedUrl } from "@/lib/links";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET ?channelId=… — templates live on the WABA, so each channel can differ.
export async function GET(req: Request) {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channel = await credsFor(new URL(req.url).searchParams.get("channelId"), tid);
    return NextResponse.json({ templates: await fetchTemplates(channel) });
  } catch (err) {
    // Degrade gracefully — missing/invalid Meta creds shouldn't 500 the UI.
    // Return an empty list plus a notice so the Broadcast tab still renders.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ templates: [], notice: `Could not load templates: ${message}` });
  }
}

// POST — create + submit a template to Meta for approval.
// Body: { name, language, category, bodyText, footerText?, exampleValues?,
//         headerType?, headerText?, headerExample?, headerHandle?,   ← media headers
//         buttons?, carouselCards?,                                   ← CTAs / carousel
//         clickTracking? }   ← wrap URL buttons in {SITE}/r/<code> tracked links
export async function POST(req: Request) {
  let body: CreateTemplateInput & { clickTracking?: boolean; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim() || !body.bodyText?.trim()) return NextResponse.json({ error: "name and bodyText are required" }, { status: 400 });

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const channel = await credsFor(body.channelId, tid);
  const name = body.name.trim().toLowerCase();
  let buttons: TemplateButton[] | undefined = body.buttons;

  // Click tracking — rewrite each URL button to a dynamic tracked link. The
  // original targets are stored in wa_template_meta; sendCampaign mints a
  // unique /r/<code> per recipient and passes it as the button's URL suffix.
  const trackedUrls: TrackedUrl[] = [];
  if (body.clickTracking && buttons?.length) {
    const site = siteUrl();
    buttons = buttons.map((b, i) => {
      if (b.type !== "URL" || !b.url.trim() || /\{\{1\}\}/.test(b.url)) return b;
      trackedUrls.push({ index: i, url: b.url.trim() });
      return { ...b, url: `${site}/r/{{1}}`, example: `${site}/r/sample01` };
    });
    if (trackedUrls.length) {
      // Store config BEFORE submitting — if this fails (migration 0011 not
      // applied), better to reject now than approve a template whose sends
      // would point at codes nobody can mint.
      try { await setTemplateMeta(name, { clickTracking: true, trackedUrls }, tid); }
      catch (err) {
        return NextResponse.json({ error: `Click tracking needs migration 0011 (wa_template_meta): ${err instanceof Error ? err.message : err}` }, { status: 500 });
      }
    }
  }

  const r = await createTemplate({
    name,
    language: body.language?.trim() || "en_US",
    category: body.category ?? "MARKETING",
    headerType: body.headerType ?? "NONE",
    headerText: body.headerText,
    headerExample: body.headerExample,
    headerHandle: body.headerHandle,
    bodyText: body.bodyText,
    footerText: body.footerText,
    exampleValues: body.exampleValues,
    buttons,
    carouselCards: body.carouselCards,
  }, channel);
  if (r.error) {
    // Roll back the meta row so a failed submission doesn't leave tracking armed.
    if (trackedUrls.length) await setTemplateMeta(name, { clickTracking: false, trackedUrls: [] }, tid).catch(() => undefined);
    return NextResponse.json({ error: r.error }, { status: 502 });
  }
  logActivity(await currentUser(), "template.create", `${name} (${r.status ?? "PENDING"})`);
  return NextResponse.json({ success: true, id: r.id, status: r.status, clickTracking: trackedUrls.length > 0 });
}

// DELETE — remove a template by name. Body: { name, channelId? }
export async function DELETE(req: Request) {
  let body: { name?: string; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const r = await deleteTemplate(body.name.trim(), await credsFor(body.channelId, tid));
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), "template.delete", body.name.trim());
  return NextResponse.json({ success: true });
}
