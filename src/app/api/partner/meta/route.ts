import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { getPartnerMetaApp, savePartnerMetaApp, partnerMetaSetup } from "@/lib/partner-meta";

export const dynamic = "force-dynamic";

// GET — the partner's own Meta app as Talko has it (never the secrets), and
// what to allow in it. Switching it on and its webhooks stay with Talko.
export async function GET() {
  return withPartner(async ({ partner }) => {
    return NextResponse.json({ app: await getPartnerMetaApp(partner.id), setup: partnerMetaSetup(partner) });
  });
}

// PUT { appId, appSecret, igAppId, igAppSecret, fbConfigId } — enter the app's
// credentials (checked with Meta, stored encrypted). Owners only.
export async function PUT(req: Request) {
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<Record<string, string>>(req);
    const r = await savePartnerMetaApp(partner.id, body ?? {}, user.email);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ appName: r.appName, app: await getPartnerMetaApp(partner.id) });
  }, { ownerOnly: true });
}
