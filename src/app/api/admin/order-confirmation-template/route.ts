import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { createTemplate, fetchTemplates } from "@/lib/whatsapp";
import { credsFor, explicitDefaultChannel, type ChannelCreds } from "@/lib/channels";
import { ORDER_CONFIRM_TEMPLATE, ORDER_CONFIRM_LANG, ORDER_CONFIRM_BODY, ORDER_CONFIRM_EXAMPLES } from "@/lib/commerce";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Resolve the WABA this tenant may act on (its default channel; platform
// workspace may use env creds). Mirrors /api/admin/templates.
async function resolveChannel(tid: string): Promise<{ channel?: ChannelCreds; error?: string; status?: number }> {
  const def = await explicitDefaultChannel(tid);
  if (def) { const channel = await credsFor(def, tid); if (channel) return { channel }; }
  if (tid !== DEFAULT_TENANT_ID) return { error: "Connect a WhatsApp number first (Setup → WhatsApp).", status: 400 };
  return {};   // platform workspace: env single-number mode
}

// GET — current status of the order-confirmation template on this WABA.
// { state: "none" | "PENDING" | "APPROVED" | "REJECTED" | ..., reason? }
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const r = await resolveChannel(tid);
    if (r.error) return NextResponse.json({ state: "none", notice: r.error });
    const found = (await fetchTemplates(r.channel)).find(t => t.name === ORDER_CONFIRM_TEMPLATE);
    return NextResponse.json({ state: found?.status ?? "none", reason: found?.rejected_reason ?? null });
  } catch (err) {
    return NextResponse.json({ state: "none", notice: `Could not read templates: ${errorMessage(err)}` });
  }
}

// POST — create + submit the canonical order-confirmation template for approval.
export async function POST() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const r = await resolveChannel(tid);
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.status ?? 400 });

    const res = await createTemplate({
      name: ORDER_CONFIRM_TEMPLATE,
      language: ORDER_CONFIRM_LANG,
      category: "UTILITY",              // transactional → high approval rate, no marketing limits
      headerType: "NONE",
      bodyText: ORDER_CONFIRM_BODY,
      exampleValues: ORDER_CONFIRM_EXAMPLES,
    }, r.channel);

    // Idempotent from the operator's view: "already exists" is success, not error.
    if (res.error) {
      if (/already exists|existing template/i.test(res.error)) return NextResponse.json({ success: true, status: "PENDING", note: "Template already submitted." });
      return NextResponse.json({ error: res.error }, { status: 502 });
    }
    logActivity(await currentUser(), "template.create", `${ORDER_CONFIRM_TEMPLATE} (${res.status ?? "PENDING"})`);
    return NextResponse.json({ success: true, status: res.status ?? "PENDING" });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
