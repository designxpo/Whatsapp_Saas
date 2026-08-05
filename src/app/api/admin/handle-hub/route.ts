import { NextResponse } from "next/server";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import {
  listEntryPoints, createEntryPoint, updateEntryPoint, deleteEntryPoint,
  listSources, createSource, deleteSource,
  trackedLink, qrDataUrl, type HandleEntryPoint,
} from "@/lib/handlehub";

export const dynamic = "force-dynamic";

// GET — every entry point (WhatsApp number) with its sources, each carrying a
// tracked link + QR.
export async function GET() {
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [entryPoints, sources] = await Promise.all([listEntryPoints(tid), listSources(tid)]);
  const withEntryPoints = await Promise.all(entryPoints.map(async ep => {
    const own = sources.filter(s => s.entryPointId === ep.id);
    const withLinks = await Promise.all(own.map(async s => {
      const link = trackedLink(ep, s);
      return { ...s, link, qr: link ? await qrDataUrl(link).catch(() => null) : null };
    }));
    return { ...ep, sources: withLinks };
  }));
  return NextResponse.json({ entryPoints: withEntryPoints });
}

// POST — create/update an entry point ({ entryPoint: {...} }) OR create a
// source ({ source: { entryPointId, label, kind } }).
export async function POST(req: Request) {
  let body: { entryPoint?: Partial<HandleEntryPoint> & { id?: string }; source?: { entryPointId?: string; label?: string; kind?: string } };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

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
    const entryPointId = (body.source.entryPointId ?? "").trim();
    const label = (body.source.label ?? "").trim();
    if (!entryPointId) return NextResponse.json({ error: "Pick which WhatsApp number this tracked link should use." }, { status: 400 });
    if (!label) return NextResponse.json({ error: "Add a name for this source (e.g. \"Instagram bio\")." }, { status: 400 });
    try {
      const entryPoints = await listEntryPoints(tid);
      const ep = entryPoints.find(e => e.id === entryPointId);
      if (!ep) return NextResponse.json({ error: "That WhatsApp number no longer exists." }, { status: 404 });
      const source = await createSource(tid, { entryPointId, label, kind: body.source.kind });
      const link = trackedLink(ep, source);
      return NextResponse.json({ success: true, source: { ...source, link, qr: link ? await qrDataUrl(link).catch(() => null) : null } });
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
