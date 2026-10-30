import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { getPartner } from "@/lib/partners";
import { setPortalDomain, removePortalDomain, recheckPortalDomain, setEmailDomain, removeEmailDomain, recheckEmailDomain, vercelConfigured } from "@/lib/partner-domains";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const HINT = "Partner domains aren't set up in the database yet. Apply migration 20261030200000_partner_domains.sql in Supabase, then reload.";

async function owner(id: string) {
  if (!(await isPlatformOwner())) return { res: NextResponse.json({ error: "Owner only" }, { status: 403 }) };
  const p = await getPartner(id);
  if (!p) return { res: NextResponse.json({ error: "Partner not found" }, { status: 404 }) };
  return { p, actor: (await currentUser())?.email ?? "owner" };
}
const fail = (err: unknown) => /custom_domain|domain_status|email_domain/.test(errorMessage(err))
  ? NextResponse.json({ error: HINT }, { status: 503 }) : NextResponse.json({ error: errorMessage(err) }, { status: 500 });

// GET — the partner's portal and sending domains, with the DNS records to add.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await owner((await params).id);
    if ("res" in g) return g.res;
    return NextResponse.json({
      portal: { domain: g.p.customDomain, status: g.p.domainStatus, detail: g.p.domainDetail },
      email: { name: g.p.emailDomain?.name ?? null, status: g.p.emailDomain?.status ?? null, records: g.p.emailDomain?.records ?? [] },
      vercel: vercelConfigured(), resend: !!process.env.RESEND_API_KEY,
    });
  } catch (err) { return fail(err); }
}

// POST { kind: "portal" | "email", domain } adds; { kind, recheck: true } re-checks.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await owner((await params).id);
    if ("res" in g) return g.res;
    const b = await req.json().catch(() => ({})) as { kind?: string; domain?: string; recheck?: boolean };
    if (b.recheck) { await (b.kind === "email" ? recheckEmailDomain(g.p.id) : recheckPortalDomain(g.p.id)); return NextResponse.json({ ok: true }); }
    const r = b.kind === "email" ? await setEmailDomain(g.p.id, b.domain ?? "", g.actor) : await setPortalDomain(g.p.id, b.domain ?? "", g.actor);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}

// DELETE { kind } — remove the portal or sending domain.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await owner((await params).id);
    if ("res" in g) return g.res;
    const b = await req.json().catch(() => ({})) as { kind?: string };
    const r = b.kind === "email" ? await removeEmailDomain(g.p.id, g.actor) : await removePortalDomain(g.p.id, g.actor);
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}
