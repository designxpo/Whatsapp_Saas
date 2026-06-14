import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser } from "@/lib/auth";
import { buildCheckoutFlowJson, createWaForm, publishWaForm } from "@/lib/waforms";
import { credsFor, getDefaultChannel } from "@/lib/channels";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — generate, upload and publish a multi-screen in-chat checkout flow.
// Returns the WhatsApp Flow id, usable in a flow's "WhatsApp form" node or sent
// directly. The order is created from the open cart when the form is submitted.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let body: { name?: string; channelId?: string | null };
  try { body = await req.json().catch(() => ({})); } catch { body = {}; }

  const channel = (await credsFor(body.channelId)) ?? (await getDefaultChannel()) ?? undefined;
  try {
    const created = await createWaForm((body.name?.trim() || "Checkout"), buildCheckoutFlowJson(), channel ?? undefined);
    if (created.error) return NextResponse.json({ error: created.error }, { status: 502 });
    if (!created.id) return NextResponse.json({ error: "Flow not created" }, { status: 502 });
    const pub = await publishWaForm(created.id, channel ?? undefined);
    logActivity(await currentUser(), "checkout.create", created.id);
    return NextResponse.json({ success: true, id: created.id, published: pub.success, validationErrors: created.validationErrors ?? [], publishError: pub.error });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
