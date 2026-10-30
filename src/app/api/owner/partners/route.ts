import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { listPartners, createPartner, isPartnerSchemaMissing, PARTNER_SCHEMA_HINT, PARTNER_DEFAULTS, type PartnerInput } from "@/lib/partners";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — every partner with its workspace count, plus the default prices the
// New partner form starts from. Owner only.
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json({ partners: await listPartners(), defaults: PARTNER_DEFAULTS }); }
  catch (err) {
    if (isPartnerSchemaMissing(err)) return NextResponse.json({ partners: [], defaults: PARTNER_DEFAULTS, setupNeeded: PARTNER_SCHEMA_HINT });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — create a partner.
export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: PartnerInput;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const actor = (await currentUser())?.email ?? "owner";
    const r = await createPartner(body, actor);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ partner: r.partner });
  } catch (err) {
    if (isPartnerSchemaMissing(err)) return NextResponse.json({ error: PARTNER_SCHEMA_HINT }, { status: 503 });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
