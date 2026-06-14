import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getAdsAccountId, getAdsPageId, listCustomAudiences, listPixels, listLeadForms } from "@/lib/ads";

export const dynamic = "force-dynamic";

// GET — assets the create wizard needs: custom audiences, pixels, lead forms.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [accountId, pageId] = await Promise.all([getAdsAccountId(), getAdsPageId()]);
  if (!accountId) return NextResponse.json({ audiences: [], pixels: [], leadForms: [] });
  const [audiences, pixels, leadForms] = await Promise.all([
    listCustomAudiences(accountId).catch(() => []),
    listPixels(accountId).catch(() => []),
    pageId ? listLeadForms(pageId).catch(() => []) : Promise.resolve([]),
  ]);
  return NextResponse.json({ audiences, pixels, leadForms });
}
