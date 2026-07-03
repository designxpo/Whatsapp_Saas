import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdsPageId, createLeadForm } from "@/lib/ads";

export const dynamic = "force-dynamic";

// POST — create a Meta Instant Form on the tenant's Page, so a lead form can be
// built without leaving the portal. Admin-only.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const pageId = await getAdsPageId(tid);
  if (!pageId) return NextResponse.json({ error: "Set your Facebook Page ID first (Meta Ads → settings)" }, { status: 400 });

  let body: { name?: string; fields?: string[]; privacyUrl?: string; privacyLinkText?: string; thankYouTitle?: string; thankYouBody?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.name?.trim()) return NextResponse.json({ error: "Give the form a name" }, { status: 400 });
  if (!/^https?:\/\/\S+/i.test((body.privacyUrl ?? "").trim())) return NextResponse.json({ error: "Add a valid privacy policy URL (https://…)" }, { status: 400 });

  const allowed = new Set(["FULL_NAME", "FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE", "CITY", "STATE", "COUNTRY", "ZIP", "JOB_TITLE", "COMPANY_NAME"]);
  const fields = (Array.isArray(body.fields) ? body.fields.filter(f => allowed.has(f)) : []);

  const r = await createLeadForm(pageId, {
    name: body.name.trim(),
    fields: fields.length ? fields : ["FULL_NAME", "EMAIL", "PHONE"],
    privacyUrl: body.privacyUrl!.trim(),
    privacyLinkText: body.privacyLinkText,
    thankYouTitle: body.thankYouTitle,
    thankYouBody: body.thankYouBody,
  });
  if (!r.ok) return NextResponse.json({ error: `Couldn't create the form: ${r.error}` }, { status: 502 });
  return NextResponse.json({ success: true, id: r.id });
}
