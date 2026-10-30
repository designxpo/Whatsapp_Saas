import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { partnerWorkspaces } from "@/lib/partners";
import { createPartnerWorkspace } from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

// GET — this partner's customer workspaces.
export async function GET() {
  return withPartner(async ({ partner }) => NextResponse.json({ workspaces: await partnerWorkspaces(partner.id) }));
}

// POST { company, ownerName, ownerEmail, ownerPhone?, plan } — create a customer
// workspace and email its owner a link to set a password.
export async function POST(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<Record<string, unknown>>(req);
    if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const r = await createPartnerWorkspace(partner, body, user.email);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ tenantId: r.tenantId });
  });
}
