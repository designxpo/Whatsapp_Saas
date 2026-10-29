import { NextResponse } from "next/server";
import { fetchTemplates, createTemplate, editTemplate, deleteTemplate, EDITABLE_TEMPLATE_STATUSES, type CreateTemplateInput, type TemplateButton } from "@/lib/whatsapp";
import { credsFor, explicitDefaultChannel, type ChannelCreds } from "@/lib/channels";
import { setTemplateMeta, getTrackedUrls, siteUrl, trackingOrigin, type TrackedUrl } from "@/lib/links";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// Resolve which WABA this request may act on — LOUDLY. A channelId that doesn't
// resolve within the tenant is a 404 (never a fall-through to the platform env
// WABA: reading it leaks platform template metadata, and POST/DELETE would
// create/delete templates on the platform's own WABA). No channelId = the
// tenant's default channel; only the platform workspace (default tenant) may
// run on env creds with no channels connected.
async function tenantChannel(tid: string, channelId: string | null | undefined): Promise<{ channel?: ChannelCreds; error?: string; status?: number }> {
  if (channelId) {
    const channel = await credsFor(channelId, tid);
    if (!channel) return { error: "Number not found in this workspace", status: 404 };
    return { channel };
  }
  const def = await explicitDefaultChannel(tid);
  if (def) {
    const channel = await credsFor(def, tid);
    if (channel) return { channel };
  }
  if (tid !== DEFAULT_TENANT_ID) return { error: "No WhatsApp number connected", status: 400 };
  return {};  // platform workspace: env single-number mode
}

// GET ?channelId=… — templates live on the WABA, so each channel can differ.
export async function GET(req: Request) {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const r = await tenantChannel(tid, new URL(req.url).searchParams.get("channelId"));
    if (r.error) return NextResponse.json({ templates: [], notice: r.error });   // graceful — the UI still renders
    return NextResponse.json({ templates: await fetchTemplates(r.channel) });
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
  const resolved = await tenantChannel(tid, body.channelId);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: resolved.status ?? 400 });
  const channel = resolved.channel;
  const name = body.name.trim().toLowerCase();
  let buttons: TemplateButton[] | undefined = body.buttons;

  // Click tracking — rewrite each URL button to a dynamic tracked link. The
  // original targets are stored in wa_template_meta; sendCampaign mints a
  // unique /r/<code> per recipient and passes it as the button's URL suffix.
  const trackedUrls: TrackedUrl[] = [];
  if (body.clickTracking && buttons?.length) {
    // Meta approves the button URL once and it can't be edited afterwards, so a
    // dead origin would permanently ship a broken link to every recipient.
    // Prefer the configured site URL, fall back to the host this request came
    // from, and only refuse when neither is a real public address.
    const reqOrigin = (() => {
      const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
      return host ? `${req.headers.get("x-forwarded-proto") || "https"}://${host}` : null;
    })();
    const site = trackingOrigin(reqOrigin);
    if (!site) {
      return NextResponse.json({ error: `Click tracking can't be enabled: no real public URL available (NEXT_PUBLIC_SITE_URL is "${siteUrl()}"). Meta bakes the tracked link into the approved template permanently, so set NEXT_PUBLIC_SITE_URL to your live domain, then resubmit.` }, { status: 400 });
    }
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

// A link button that already carries a tracked /r/{{1}} link (click tracking
// was on when it was created).
const isTrackedLink = (b: TemplateButton) => b.type === "URL" && /\/r\/\{\{1\}\}$/.test(b.url.trim());

// PATCH — edit an existing template in place. Body: { id, channelId?,
// category?, bodyText, footerText?, exampleValues?, header…, buttons?,
// carouselCards? } — the same fields as POST, minus name and language, which
// Meta never lets change.
//
// The template is looked up on the workspace's own WABA rather than trusted
// from the request: its name, language and status come from Meta, so an edit
// can't rename anything or reach a template on another account.
export async function PATCH(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: Omit<CreateTemplateInput, "name" | "language" | "category"> & { id?: string; channelId?: string | null; category?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id || !/^\d+$/.test(body.id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!body.bodyText?.trim()) return NextResponse.json({ error: "bodyText is required" }, { status: 400 });

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const resolved = await tenantChannel(tid, body.channelId);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: resolved.status ?? 400 });
  const channel = resolved.channel;

  let current;
  try {
    current = (await fetchTemplates(channel)).find(t => t.id === body.id);
  } catch (err) {
    return NextResponse.json({ error: `Could not load templates: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
  if (!current) return NextResponse.json({ error: "That template isn't on this number's WhatsApp account any more — refresh the list." }, { status: 404 });
  if (!EDITABLE_TEMPLATE_STATUSES.includes(current.status)) {
    return NextResponse.json({ error: `Meta only allows editing an approved, rejected or paused template. This one is ${current.status.toLowerCase()} — wait for Meta's decision.` }, { status: 409 });
  }

  // Click tracking maps each tracked button by its POSITION to the real URL.
  // Moving, adding or removing a tracked button would send every click to the
  // wrong page, so an edit must leave them where they are.
  const tracked = await getTrackedUrls(current.name, tid);
  const trackedNow = (body.buttons ?? []).flatMap((b, i) => (isTrackedLink(b) ? [i] : []));
  if (tracked.length && tracked.map(t => t.index).join(",") !== trackedNow.join(",")) {
    return NextResponse.json({ error: "This template has click-tracked link buttons. Keep them in the same place, or duplicate the template to change them." }, { status: 400 });
  }

  // Category can change only while the template is not approved (Meta's rule).
  const category = body.category && body.category !== current.category && current.status !== "APPROVED" ? body.category : undefined;
  const r = await editTemplate(current.id!, {
    ...body,
    name: current.name, language: current.language,
    category: current.category as CreateTemplateInput["category"],
  }, { category }, channel);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), "template.edit", `${current.name} (${current.language}, was ${current.status})`);
  return NextResponse.json({ success: true, name: current.name, wasStatus: current.status });
}

// DELETE — remove a template by name. Body: { name, channelId? }
export async function DELETE(req: Request) {
  let body: { name?: string; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const resolved = await tenantChannel(tid, body.channelId);
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: resolved.status ?? 400 });
  const r = await deleteTemplate(body.name.trim(), resolved.channel);
  if (!r.success) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), "template.delete", body.name.trim());
  return NextResponse.json({ success: true });
}
