export const maxDuration = 15;
import { NextResponse } from "next/server";
import { apiKeyTenant } from "@/lib/apiauth";
import { issueOtp, otpPepper, OTP_EXPIRY_MINUTES } from "@/lib/otp";

export const dynamic = "force-dynamic";

// POST { phone, area?, channelId? } — generate a fresh 4-digit code and deliver
// it as a Meta AUTHENTICATION template. `area` routes to that area's number
// (Settings → OTP service); omit it to use the default number. `channelId` pins
// a specific number directly. The code is never echoed back; your backend
// verifies it later via /api/otp/verify.
// Auth: header `Authorization: Bearer ak_live_…` (your tenant's API key). The
// tenant is resolved from the key, so codes are isolated per tenant.
export async function POST(req: Request) {
  if (!otpPepper()) return NextResponse.json({ error: "OTP service not configured (OTP_HASH_SECRET unset)" }, { status: 503 });
  const tenantId = await apiKeyTenant(req);
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { phone?: string; area?: string; channelId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const r = await issueOtp(tenantId, body.phone, { area: body.area, channelId: body.channelId });
  if (r.error) {
    return NextResponse.json(
      { error: r.error, ...(r.retryAfterSeconds ? { retryAfterSeconds: r.retryAfterSeconds } : {}) },
      { status: r.status ?? 500, ...(r.retryAfterSeconds ? { headers: { "Retry-After": String(r.retryAfterSeconds) } } : {}) },
    );
  }
  return NextResponse.json({ success: true, expiresInMinutes: OTP_EXPIRY_MINUTES });
}
