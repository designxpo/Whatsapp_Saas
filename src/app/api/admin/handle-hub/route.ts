import { NextResponse } from "next/server";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import {
  listEntryPoints, createEntryPoint, updateEntryPoint, deleteEntryPoint,
  listSources, createSource, updateSource, deleteSource,
  shortUrl, ensureShortSlug, setShortSlug, trackedLink, starterMessage, bridgeUrl, qrDataUrl, type HandleEntryPoint,
} from "@/lib/handlehub";

export const dynamic = "force-dynamic";

// GET — every entry point (WhatsApp number) with its sources, each carrying a
// tracked link + QR.
export async function GET(req: Request) {
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [entryPoints, sources] = await Promise.all([listEntryPoints(tid), listSources(tid)]);
  const withEntryPoints = await Promise.all(entryPoints.map(async ep => {
    const own = sources.filter(s => s.entryPointId === ep.id);
    const withLinks = await Promise.all(own.map(async s => {
      const waLink = trackedLink(ep, s);
      const slug = s.shortSlug || await ensureShortSlug(s.id, tid);
      const origin = new URL(req.url).origin;
      const link = slug ? shortUrl(origin, slug) : waLink;
      // `link` is the short /s/ URL (what a bio, poster or QR carries). Beside it:
      //   waLink   the direct wa.me link, long because the invisible ref code
      //            percent-encodes to nine bytes a character;
      //   bridge   the on-our-domain /chat URL for ad platforms that reject an
      //            off-domain destination (Google Ads final URLs);
      //   starter  the raw prefilled text, for Google Ads Message assets, which
      //            take a number and a message and no URL at all.
      return { ...s, link, waLink, bridge: bridgeUrl(origin, s), starter: starterMessage(ep, s),
               qr: link ? await qrDataUrl(link).catch(() => null) : null };
    }));
    return { ...ep, sources: withLinks };
  }));
  return NextResponse.json({ entryPoints: withEntryPoints });
}

// POST — create/update an entry point ({ entryPoint: {...} }) OR create/update
// a source ({ source: { id?, entryPointId, label, kind, message } }).
export async function POST(req: Request) {
  let body: { shortLink?: { id: string; slug: string }; entryPoint?: Partial<HandleEntryPoint> & { id?: string }; source?: { id?: string; entryPointId?: string; label?: string; kind?: string; message?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  if (body.shortLink) {
    if (!(await listSources(tid)).some(s => s.id === body.shortLink!.id)) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    try { return NextResponse.json({ slug: await setShortSlug(body.shortLink.id, body.shortLink.slug, tid) }); }
    catch (err) { return NextResponse.json({ error: String(err) }, { status: 400 }); }
  }
  if (body.entryPoint) {
    const { id, ...fields } = body.entryPoint;
    try {
      if (id) await updateEntryPoint(id, tid, fields);
      else await createEntryPoint(tid, { number: fields.number ?? "", label: fields.label, handle: fields.handle, greeting: fields.greeting });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  }

  if (body.source) {
    // Editing an existing source keeps its ref code — that code is already live
    // inside ads and links we cannot reach out and change.
    if (body.source.id) {
      if (!(await listSources(tid)).some(s => s.id === body.source!.id)) return NextResponse.json({ error: "Source not found" }, { status: 404 });
      try { await updateSource(body.source.id, tid, { label: body.source.label, kind: body.source.kind, message: body.source.message }); }
      catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status: 400 }); }
      return NextResponse.json({ success: true });
    }
    const entryPointId = (body.source.entryPointId ?? "").trim();
    const label = (body.source.label ?? "").trim();
    if (!entryPointId) return NextResponse.json({ error: "Pick which WhatsApp number this tracked link should use." }, { status: 400 });
    if (!label) return NextResponse.json({ error: "Add a name for this source (e.g. \"Instagram bio\")." }, { status: 400 });
    try {
      const entryPoints = await listEntryPoints(tid);
      const ep = entryPoints.find(e => e.id === entryPointId);
      if (!ep) return NextResponse.json({ error: "That WhatsApp number no longer exists." }, { status: 404 });
      const source = await createSource(tid, { entryPointId, label, kind: body.source.kind, message: body.source.message });
      const waLink = trackedLink(ep, source);
      const origin = new URL(req.url).origin;
      const slug = source.shortSlug ?? await ensureShortSlug(source.id, tid);
      const link = slug ? shortUrl(origin, slug) : waLink;
      return NextResponse.json({ success: true, source: { ...source, shortSlug: slug, link, waLink,
        bridge: bridgeUrl(origin, source), starter: starterMessage(ep, source),
        qr: link ? await qrDataUrl(link).catch(() => null) : null } });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Could not create source" }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
}

// DELETE ?entryPointId=... — remove a whole entry point (cascades its sources).
// DELETE ?sourceId=...     — remove a single source.
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const entryPointId = searchParams.get("entryPointId");
  const sourceId = searchParams.get("sourceId");
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  if (entryPointId) await deleteEntryPoint(entryPointId, tid);
  else if (sourceId) await deleteSource(sourceId, tid);
  else return NextResponse.json({ error: "Missing entryPointId or sourceId" }, { status: 400 });
  return NextResponse.json({ success: true });
}
