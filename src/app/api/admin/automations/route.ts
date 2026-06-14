import { NextResponse } from "next/server";
import { listAutomations, createCampaign, disableAutomation, type AutoTrigger } from "@/lib/store";

export const dynamic = "force-dynamic";

const TRIGGERS: AutoTrigger[] = ["contact_added", "tag_added", "api_event"];

export async function GET() {
  return NextResponse.json({ automations: await listAutomations() });
}

// POST — create an automation, or disable one ({ id, enabled:false }).
export async function POST(req: Request) {
  let body: {
    id?: string; enabled?: boolean; name?: string; trigger?: string; triggerKey?: string | null;
    templateName?: string; languageCode?: string; variables?: string[]; headerImageUrl?: string | null;
    delayValue?: number; delayUnit?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.id && body.enabled === false) {
    await disableAutomation(body.id);
    return NextResponse.json({ success: true, disabled: true });
  }

  const trigger = body.trigger as AutoTrigger;
  if (!TRIGGERS.includes(trigger)) return NextResponse.json({ error: "Invalid trigger" }, { status: 400 });
  if (!body.templateName?.trim()) return NextResponse.json({ error: "templateName required" }, { status: 400 });
  const delayUnit = (["minutes", "hours", "days"].includes(body.delayUnit ?? "") ? body.delayUnit : "minutes") as "minutes" | "hours" | "days";

  const campaign = await createCampaign({
    name: body.name ?? null,
    templateName: body.templateName.trim(),
    languageCode: body.languageCode?.trim() || "en_US",
    variables: Array.isArray(body.variables) ? body.variables : [],
    headerImageUrl: body.headerImageUrl ?? null,
    status: "draft",
    autoSendEnabled: true,
    autoSendTrigger: trigger,
    triggerKey: body.triggerKey?.trim() || null,
    delayValue: typeof body.delayValue === "number" ? body.delayValue : 0,
    delayUnit,
  });
  return NextResponse.json({ success: true, campaign });
}
