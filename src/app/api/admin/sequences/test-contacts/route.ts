import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { listConversations } from "@/lib/store";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const WINDOW_MS = 24 * 60 * 60 * 1000;

// GET ?platform=whatsapp|instagram — this tenant's recent contacts on that
// platform, so the test picker only offers VALID recipients (a real WhatsApp
// number, or an Instagram IGSID — you can't message IG by @handle). withinWindow
// flags who can receive a plain text/media step right now (24h rule).
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const platform = new URL(req.url).searchParams.get("platform") === "instagram" ? "instagram" : "whatsapp";
  try {
    const convs = await listConversations({ limit: 200, tenantId: tid });
    const contacts = convs
      .filter(c => c.platform === platform && !c.isComment && c.phone)
      .slice(0, 50)
      .map(c => ({
        phone: c.phone,
        name: c.name || c.phone,
        lastInboundAt: c.lastInboundAt,
        withinWindow: !!c.lastInboundAt && Date.now() - new Date(c.lastInboundAt).getTime() < WINDOW_MS,
      }));
    return NextResponse.json({ contacts });
  } catch (err) {
    return NextResponse.json({ contacts: [], error: errorMessage(err) });
  }
}
