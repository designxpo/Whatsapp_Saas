import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getPartner } from "@/lib/partners";
import { getPartnerMetaApp, savePartnerMetaApp, setPartnerMetaActive, subscribePartnerWebhooks, checkPartnerMetaApp, partnerWebhookUrl, partnerVerifyToken, partnerMetaSetup } from "@/lib/partner-meta";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const HINT = "Partner Meta apps aren't set up in the database yet. Apply migration 20261030220000_partner_meta_apps.sql in Supabase, then reload.";
const fail = (err: unknown) => /meta_app/.test(errorMessage(err)) ? NextResponse.json({ error: HINT }, { status: 503 }) : NextResponse.json({ error: errorMessage(err) }, { status: 500 });

async function owner(id: string) {
  if (!(await isPlatformOwner())) return { res: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  const p = await getPartner(id);
  if (!p) return { res: NextResponse.json({ error: "Partner not found" }, { status: 404 }) };
  return { p, actor: (await currentUser())?.email ?? "owner" };
}

// GET — the partner's Meta app (never its secrets), and the addresses the
// partner must allow in its Meta app.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await owner((await params).id);
    if ("res" in g) return g.res;
    return NextResponse.json({
      app: await getPartnerMetaApp(g.p.id),
      setup: {
        ...partnerMetaSetup(g.p),
        webhooks: { instagram: partnerWebhookUrl(g.p.id, "instagram"), messenger: partnerWebhookUrl(g.p.id, "messenger") },
        verifyToken: await partnerVerifyToken(g.p.id),
        adminCheck: !!process.env.TALKO_META_ADMIN_ID,
      },
    });
  } catch (err) { return fail(err); }
}

// POST { appId, appSecret, igAppId, igAppSecret, fbConfigId } saves;
// { active } switches it on/off; { subscribe: true } sets up its webhooks;
// { check: true } re-checks it now.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await owner((await params).id);
    if ("res" in g) return g.res;
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof b.active === "boolean") {
      const r = await setPartnerMetaActive(g.p.id, b.active, g.actor);
      return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ app: await getPartnerMetaApp(g.p.id) });
    }
    if (b.subscribe) return NextResponse.json(await subscribePartnerWebhooks(g.p.id, g.actor));
    if (b.check) return NextResponse.json({ app: await checkPartnerMetaApp(g.p.id) });
    const r = await savePartnerMetaApp(g.p.id, b as never, g.actor);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ appName: r.appName, app: await getPartnerMetaApp(g.p.id) });
  } catch (err) { return fail(err); }
}
