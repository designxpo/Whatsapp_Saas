import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { planAdCampaign, type AdGoal } from "@/lib/adplanner";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GOALS: AdGoal[] = ["WHATSAPP", "MESSENGER", "WEBSITE"];

// POST — draft a complete campaign plan from a short brief. Does NOT publish;
// the client reviews the returned plan, then the existing /api/admin/meta/create
// route launches it on approval.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  let b: { goal?: string; websiteUrl?: string; product?: string; budgetTotal?: number; days?: number; currency?: string; countries?: string[]; audienceNote?: string; businessName?: string; variants?: number; creativeFormat?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const goal = (GOALS.includes(b.goal as AdGoal) ? b.goal : "WHATSAPP") as AdGoal;
  if (!b.product?.trim()) return NextResponse.json({ error: "Tell the AI what you're advertising." }, { status: 400 });
  if (!(Number(b.budgetTotal) > 0)) return NextResponse.json({ error: "Enter a total budget." }, { status: 400 });
  if (!(Number(b.days) > 0)) return NextResponse.json({ error: "Enter how many days to run." }, { status: 400 });
  if (goal === "WEBSITE" && !b.websiteUrl?.trim()) return NextResponse.json({ error: "Add the website URL to send people to." }, { status: 400 });

  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const plan = await planAdCampaign({
      goal,
      websiteUrl: b.websiteUrl?.trim(),
      product: b.product.trim(),
      budgetTotal: Number(b.budgetTotal),
      days: Number(b.days),
      currency: (b.currency || "INR").toUpperCase(),
      countries: Array.isArray(b.countries) && b.countries.length ? b.countries.map(c => String(c).toUpperCase()) : ["IN"],
      audienceNote: b.audienceNote?.trim() || undefined,
      businessName: b.businessName?.trim() || undefined,
      variants: Number(b.variants) || 1,
      creativeFormat: b.creativeFormat as "single" | "carousel" | "video" | undefined,
    }, tid);
    return NextResponse.json({ success: true, plan });
  } catch (err) {
    if (err instanceof AiKeyMissingError) return NextResponse.json({ error: "Add your AI key first (AI Hub) so the assistant can draft the campaign." }, { status: 400 });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
