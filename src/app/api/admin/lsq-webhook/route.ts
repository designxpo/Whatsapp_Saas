import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireRoleAdmin, currentUser, currentTenantId } from "@/lib/auth";
import { getTenantSecret, setTenantSecret } from "@/lib/store";
import { logActivity } from "@/lib/team";

export const dynamic = "force-dynamic";

// Inbound LeadSquared webhook credentials for THIS workspace: the URL to paste
// into LSQ Automations and the shared secret. GET mints the secret on first
// call (idempotent afterwards); POST { rotate: true } regenerates it — any LSQ
// automation still using the old one starts getting 401s until updated.
// Keep the settings key in sync with /api/webhooks/leadsquared.
const LSQ_WEBHOOK_SECRET_KEY = "lsq_webhook_secret";

function baseUrl(req: Request): string {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return env || new URL(req.url).origin;
}

async function payload(req: Request, tid: string) {
  // Encrypted at rest like every other integration secret (setTenantSecret).
  const secret = (await getTenantSecret(tid, LSQ_WEBHOOK_SECRET_KEY).catch(() => null)) ?? "";
  return {
    url: `${baseUrl(req)}/api/webhooks/leadsquared?t=${tid}`,
    secret,
    header: "x-lsq-secret",
  };
}

export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let out = await payload(req, tid);
  if (!out.secret) {
    await setTenantSecret(tid, LSQ_WEBHOOK_SECRET_KEY, randomBytes(24).toString("hex"));
    logActivity(await currentUser(), "lsq.webhook", "inbound secret minted");
    out = await payload(req, tid);
  }
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { rotate?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.rotate) return NextResponse.json({ error: "Nothing to do — POST { rotate: true }" }, { status: 400 });
  await setTenantSecret(tid, LSQ_WEBHOOK_SECRET_KEY, randomBytes(24).toString("hex"));
  logActivity(await currentUser(), "lsq.webhook", "inbound secret rotated");
  return NextResponse.json(await payload(req, tid));
}
