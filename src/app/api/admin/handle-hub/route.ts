import { NextResponse } from "next/server";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import {
  getHandleHubConfig, setHandleHubConfig, listSources, createSource, deleteSource,
  trackedLink, qrDataUrl, type HandleHubConfig,
} from "@/lib/handlehub";

export const dynamic = "force-dynamic";

// GET — the Handle Hub view: config + every source with its tracked link + QR.
export async function GET() {
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const cfg = await getHandleHubConfig(tid);
  const sources = await listSources(tid);
  const withLinks = await Promise.all(sources.map(async s => {
    const link = trackedLink(cfg, s);
    return { ...s, link, qr: link ? await qrDataUrl(link).catch(() => null) : null };
  }));
  return NextResponse.json({ config: cfg, sources: withLinks });
}

// POST — save config ({ config: {...} }) OR create a source ({ label, kind }).
export async function POST(req: Request) {
  let body: { config?: Partial<HandleHubConfig>; label?: string; kind?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;

  if (body.config) {
    await setHandleHubConfig(tid, body.config);
    return NextResponse.json({ success: true, config: await getHandleHubConfig(tid) });
  }

  const label = (body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "Add a name for this source (e.g. \"Instagram bio\")." }, { status: 400 });
  const cfg = await getHandleHubConfig(tid);
  const source = await createSource(tid, { label, kind: body.kind });
  const link = trackedLink(cfg, source);
  return NextResponse.json({ success: true, source: { ...source, link, qr: link ? await qrDataUrl(link).catch(() => null) : null } });
}

// DELETE ?id=... — remove a source.
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  await deleteSource(id, tid);
  return NextResponse.json({ success: true });
}
