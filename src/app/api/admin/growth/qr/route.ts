import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listGrowthTools } from "@/lib/growth";

export const dynamic = "force-dynamic";

// GET /api/admin/growth/qr?slug=<slug> — a scannable QR (PNG) for the tool's
// public /g/<slug> link. Tenant-scoped. Used by the "QR" button in the Growth tab.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") || "").trim().toLowerCase();
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const tool = (await listGrowthTools(tid)).find(t => t.slug === slug);
  if (!tool) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const target = `${url.origin}/g/${tool.slug}`;
  const png = await QRCode.toBuffer(target, { width: 600, margin: 2, errorCorrectionLevel: "M" });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="qr-${tool.slug}.png"`,
    },
  });
}
