import { NextResponse } from "next/server";
import { withPartner, readJson } from "@/lib/partner-api";
import { partnerWorkspaceUsage, setPartnerWorkspacePlan, setPartnerWorkspacePaused } from "@/lib/partner-portal";

export const dynamic = "force-dynamic";

// GET — one of this partner's workspaces, with its usage against plan limits.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPartner(async ({ partner }) => {
    const r = await partnerWorkspaceUsage(partner, id);
    return r ? NextResponse.json(r) : NextResponse.json({ error: "That workspace isn't one of yours." }, { status: 404 });
  });
}

// PATCH { plan } or { paused } — change a workspace's plan, or pause / resume it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withPartner(async ({ partner, user }) => {
    const body = await readJson<{ plan?: string; paused?: boolean }>(req);
    if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const r = typeof body.paused === "boolean"
      ? await setPartnerWorkspacePaused(partner, id, body.paused, user.email)
      : typeof body.plan === "string"
        ? await setPartnerWorkspacePlan(partner, id, body.plan, user.email)
        : { error: "Nothing to change." };
    return r.error ? NextResponse.json({ error: r.error }, { status: 400 }) : NextResponse.json({ ok: true });
  });
}
