import { NextResponse } from "next/server";
import { requireAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { sendTemplateTest } from "@/lib/whatsapp";
import { credsFor } from "@/lib/channels";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// POST { phone, name?, templateName, languageCode?, variables?, headerImageUrl?, channelId? }
// Sends one template message to any number — no campaign, contact, or queue row.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { phone?: string; name?: string; templateName?: string; languageCode?: string; variables?: string[]; headerImageUrl?: string | null; channelId?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const phone = (body.phone ?? "").replace(/\D/g, "");
  if (phone.length < 10) return NextResponse.json({ error: "Enter a valid number with country code, e.g. 919876543210" }, { status: 400 });
  if (!body.templateName?.trim()) return NextResponse.json({ error: "Pick a template first" }, { status: 400 });

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const r = await sendTemplateTest({
    phone,
    name: body.name,
    templateName: body.templateName.trim(),
    languageCode: body.languageCode?.trim() || "en_US",
    variables: Array.isArray(body.variables) ? body.variables : [],
    headerImageUrl: body.headerImageUrl ?? null,
    channel: await credsFor(body.channelId, tid),
    tenantId: tid,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
  logActivity(await currentUser(), "broadcast.test", `${body.templateName} → ${phone}`);
  return NextResponse.json({ success: true, id: r.id });
}
