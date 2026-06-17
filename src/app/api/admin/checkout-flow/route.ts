import { NextResponse } from "next/server";
import { requireRoleAdmin, currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { buildCheckoutFlowJson, createWaForm, publishWaForm } from "@/lib/waforms";
import { credsFor, getDefaultChannel } from "@/lib/channels";
import { getTenantSetting, setTenantSetting } from "@/lib/store";
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

  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const channel = (await credsFor(body.channelId, tid)) ?? (await getDefaultChannel(tid)) ?? undefined;
  // One checkout flow per number is enough, so reuse it: Meta rejects duplicate
  // flow NAMES within a WABA, so a fixed "Checkout" fails on the 2nd click.
  // Reuse the stored id (tenant-scoped via getTenantSetting) when present;
  // otherwise create with a unique name.
  // Key bumped (_pub) so any previously-cached unpublished/broken draft id is
  // ignored; we now only ever store a successfully-published flow under it.
  const key = `checkout_flow_pub:${body.channelId ?? "default"}`;
  try {
    const existing = await getTenantSetting<string>(tid, key, "");
    if (existing) return NextResponse.json({ success: true, id: existing, published: true, reused: true });
    // Use a clean name ("Checkout"). Meta rejects duplicate flow names within a
    // WABA, so only on a real name collision do we add a short, readable suffix
    // ("Checkout 2", "Checkout 3", …) — never random gibberish.
    const base = body.name?.trim() || "Checkout";
    let created: Awaited<ReturnType<typeof createWaForm>> = { error: "not attempted" };
    for (let i = 1; i <= 6; i++) {
      const name = i === 1 ? base : `${base} ${i}`;
      created = await createWaForm(name, buildCheckoutFlowJson(), channel ?? undefined);
      if (!created.error || !/name|exist|taken|duplicate|already/i.test(created.error)) break;
    }
    if (created.error) return NextResponse.json({ error: created.error }, { status: 502 });
    if (!created.id) return NextResponse.json({ error: "Flow not created" }, { status: 502 });
    const pub = await publishWaForm(created.id, channel ?? undefined);
    // Only remember a flow that actually PUBLISHED — caching an unpublished
    // draft would reuse a broken flow forever. A failed publish recreates next time.
    if (pub.success) await setTenantSetting(tid, key, created.id).catch(e => console.error("[checkout] persist id failed:", e));
    logActivity(await currentUser(), "checkout.create", created.id);
    return NextResponse.json({ success: true, id: created.id, published: pub.success, validationErrors: created.validationErrors ?? [], publishError: pub.error });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
