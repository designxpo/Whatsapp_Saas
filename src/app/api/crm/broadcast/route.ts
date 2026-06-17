export const maxDuration = 300;
import { NextResponse } from "next/server";
import { crmAuthorized } from "@/lib/crm";
import { runBroadcast, BroadcastError } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

// POST { templateName, languageCode?, variables?, headerImageUrl?, recipients:[{phone,name?}] }
// Broadcast an approved template to a list of leads (e.g. a LeadSquared SmartView
// segment). Token-gated (default tenant); reuses the broadcast engine.
export async function POST(req: Request) {
  if (!crmAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { templateName?: string; languageCode?: string; variables?: string[]; headerImageUrl?: string | null; recipients?: { phone?: string; name?: string }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 }); }

  if (!body.templateName?.trim()) return NextResponse.json({ success: false, error: "templateName required" }, { status: 400 });
  const recipients = (body.recipients ?? []).filter(r => (r.phone ?? "").replace(/\D/g, "").length >= 10);
  if (recipients.length === 0) return NextResponse.json({ success: false, error: "recipients (with valid phones) required" }, { status: 400 });

  try {
    const result = await runBroadcast({
      mode: "recipients",
      recipients,
      templateName: body.templateName.trim(),
      languageCode: body.languageCode?.trim() || "en_US",
      variables: Array.isArray(body.variables) ? body.variables : [],
      headerImageUrl: body.headerImageUrl ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BroadcastError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 });
  }
}
