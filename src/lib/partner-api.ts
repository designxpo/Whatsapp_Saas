// Shared plumbing for the partner dashboard's API routes: who is calling, and
// the one error shape the dashboard reads. Every route goes through
// withPartner, so none can forget the session check.
import { NextResponse } from "next/server";
import { currentPartner, type PartnerContext } from "./partner-portal";
import { isPartnerSchemaMissing } from "./partners";
import { errorMessage } from "./errors";

export async function withPartner(
  fn: (ctx: PartnerContext) => Promise<NextResponse>,
  opts: { ownerOnly?: boolean } = {},
): Promise<NextResponse> {
  try {
    const ctx = await currentPartner();
    if (!ctx) return NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
    if (opts.ownerOnly && ctx.user.role !== "owner") return NextResponse.json({ error: "Only an owner of this partner account can do that." }, { status: 403 });
    return await fn(ctx);
  } catch (err) {
    if (isPartnerSchemaMissing(err)) return NextResponse.json({ error: "The partner dashboard isn't set up yet. Contact Talko." }, { status: 503 });
    console.error("[partner-api]", errorMessage(err));
    return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}
