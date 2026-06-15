import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getAdsAccountId, getAdsPageId, listCustomAudiences, listPixels, listLeadForms } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET — assets the create wizard needs: custom audiences, pixels, lead forms.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  const [accountId, pageId] = await Promise.all([getAdsAccountId(tid), getAdsPageId(tid)]);
  if (!accountId) return NextResponse.json({ audiences: [], pixels: [], leadForms: [] });
  const [audiences, pixels, leadForms] = await Promise.all([
    listCustomAudiences(accountId).catch(() => []),
    listPixels(accountId).catch(() => []),
    pageId ? listLeadForms(pageId).catch(() => []) : Promise.resolve([]),
  ]);
  return NextResponse.json({ audiences, pixels, leadForms });
}
