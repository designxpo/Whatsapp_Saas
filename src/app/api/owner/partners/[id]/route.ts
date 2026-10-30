import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import {
  getPartner, updatePartner, setPartnerStatus, partnerWorkspaces, listPartnerAudit,
  isPartnerSchemaMissing, PARTNER_SCHEMA_HINT, type PartnerInput, type PartnerStatus,
} from "@/lib/partners";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — one partner, its workspaces and its audit trail. Owner only.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  try {
    const partner = await getPartner(id);
    if (!partner) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    const [workspaces, audit] = await Promise.all([partnerWorkspaces(id), listPartnerAudit(id)]);
    return NextResponse.json({ partner, workspaces, audit });
  } catch (err) {
    if (isPartnerSchemaMissing(err)) return NextResponse.json({ error: PARTNER_SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH — { status } changes the status; any other fields edit the partner.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  const { id } = await params;
  let body: PartnerInput & { status?: PartnerStatus };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const actor = (await currentUser())?.email ?? "owner";
    const { status, ...fields } = body;
    const r = status !== undefined && !Object.keys(fields).length
      ? await setPartnerStatus(id, status, actor)
      : await updatePartner(id, fields, actor);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ partner: r.partner });
  } catch (err) {
    if (isPartnerSchemaMissing(err)) return NextResponse.json({ error: PARTNER_SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
