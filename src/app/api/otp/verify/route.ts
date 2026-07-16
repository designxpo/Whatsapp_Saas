export const maxDuration = 15;
import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { verifyOtp, otpPepper } from "@/lib/otp";

export const dynamic = "force-dynamic";

// POST { phone, code } — check a code the user typed on your site. Codes are
// single-use; 5 wrong guesses invalidate the active code.
// Always 200 with { valid: boolean, reason? } so integrators branch on `valid`.
// Auth: header `Authorization: Bearer ak_live_…` (your tenant's API key).
export async function POST(req: Request) {
  if (!otpPepper()) return NextResponse.json({ error: "OTP service not configured (OTP_HASH_SECRET unset)" }, { status: 503 });
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { phone?: string; code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone || !body.code) return NextResponse.json({ error: "phone and code required" }, { status: 400 });

  return NextResponse.json(await verifyOtp(tenantId, body.phone, body.code));
}
