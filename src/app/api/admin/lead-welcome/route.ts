import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId } from "@/lib/auth";
import { getLeadWelcome, setLeadWelcome, type LeadWelcome } from "@/lib/leadwelcome";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// GET — the workspace's landing-page → WhatsApp welcome automation config.
export async function GET() {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ config: await getLeadWelcome(tid) });
}

// POST — save the config. Admins only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: Partial<LeadWelcome>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.enabled && (!body.templateName?.trim() || !body.flowId?.trim())) {
    return NextResponse.json({ error: "Pick an approved template and a flow before turning this on." }, { status: 400 });
  }
  const config = await setLeadWelcome(body, tid);
  logActivity(await currentUser(), "leadwelcome.save", config.enabled ? `on · ${config.templateName}` : "off");
  return NextResponse.json({ config });
}
