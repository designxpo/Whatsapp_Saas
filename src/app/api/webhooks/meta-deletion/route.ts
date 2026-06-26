import { NextResponse } from "next/server";
import { verifySignedRequest } from "@/lib/apiauth";
import { recordDeletionRequest } from "@/lib/metadeletion";

export const dynamic = "force-dynamic";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://whatsapp-saas-navy.vercel.app").replace(/\/$/, "");

// Meta Data Deletion Request callback (shared across WhatsApp / Instagram /
// Messenger under the one Tech Provider app). Meta POSTs a `signed_request`
// (HMAC-SHA256 signed by the app secret) when a user removes the app or requests
// deletion. We verify it, record the request, and return the { url,
// confirmation_code } JSON Meta requires so the user can track status.
// Docs: developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
async function readSignedRequest(req: Request): Promise<string> {
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const j = await req.json();
      return String((j as { signed_request?: string }).signed_request ?? "");
    }
    const form = await req.formData();
    return String(form.get("signed_request") ?? "");
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const signed = await readSignedRequest(req);
  const payload = verifySignedRequest(signed, process.env.META_APP_SECRET);
  if (!payload) return NextResponse.json({ error: "Invalid signed_request" }, { status: 400 });

  const metaUserId = String(payload.user_id ?? "unknown");
  const code = await recordDeletionRequest(metaUserId);

  return NextResponse.json({
    url: `${SITE_URL}/legal/data-deletion?code=${encodeURIComponent(code)}`,
    confirmation_code: code,
  });
}

// Meta only ever POSTs; a GET is handy for a manual reachability check.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "meta-deletion", method: "POST signed_request" });
}
