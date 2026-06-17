import { NextResponse } from "next/server";
import { crmAuthorized } from "@/lib/crm";
import { fetchTemplates } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";

export const dynamic = "force-dynamic";

// GET — approved templates for the CRM panel's template gallery. Token-gated
// (default tenant, matching the rest of the CRM panel surface).
export async function GET(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const channel = await credsFor(new URL(req.url).searchParams.get("channelId"));
    const all = await fetchTemplates(channel);
    const templates = all.filter(t => t.status === "APPROVED");
    return NextResponse.json({ templates });
  } catch (err) {
    return NextResponse.json({ templates: [], notice: `Could not load templates: ${err instanceof Error ? err.message : String(err)}` });
  }
}
