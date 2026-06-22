import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { getTenantSetting, getTenantSecret, setTenantSetting, setTenantSecret } from "@/lib/store";
import { LSQ_KEYS, verifyLsq, getLsqSyncError, clearLsqSyncError } from "@/lib/leadsquared";
import { guardFeature } from "@/lib/feature-guard";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const mask = (s: string | null) => (s && s.length > 6 ? `${s.slice(0, 3)}…${s.slice(-2)}` : s ? "••••" : null);

// GET — this tenant's LeadSquared config (never returns the raw keys).
export async function GET() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const accessKey = await getTenantSecret(tid, LSQ_KEYS.accessKey);
    const secretSet = !!(await getTenantSecret(tid, LSQ_KEYS.secretKey));
    return NextResponse.json({
      configured: !!accessKey && secretSet,
      accessKeyHint: mask(accessKey),
      secretKeySet: secretSet,
      host: await getTenantSetting<string | null>(tid, LSQ_KEYS.host, null),
      activityCode: await getTenantSetting<string | null>(tid, LSQ_KEYS.activityCode, null),
      taskCategory: await getTenantSetting<string | null>(tid, LSQ_KEYS.taskCategory, null),
      igHandleField: await getTenantSetting<string | null>(tid, LSQ_KEYS.igHandleField, null),
      autoCreate: /^(1|true|yes|on)$/i.test((await getTenantSetting<string | null>(tid, LSQ_KEYS.autoCreate, null)) ?? ""),
      lastSyncError: await getLsqSyncError(tid),
    });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — save this tenant's keys (blank accessKey/secretKey keeps the stored
// ones, like the channel token). Verifies live and returns the result.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  { const gate = await guardFeature(tid, "crm"); if (gate) return gate; }
  let b: { accessKey?: string; secretKey?: string; host?: string; activityCode?: string; taskCategory?: string; igHandleField?: string; autoCreate?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const host = (b.host ?? "").trim();
  const activityCode = (b.activityCode ?? "").trim();
  if (!host || !activityCode) return NextResponse.json({ error: "API host and Activity code are required." }, { status: 400 });

  try {
    if (b.accessKey?.trim()) await setTenantSecret(tid, LSQ_KEYS.accessKey, b.accessKey.trim());
    if (b.secretKey?.trim()) await setTenantSecret(tid, LSQ_KEYS.secretKey, b.secretKey.trim());
    await setTenantSetting(tid, LSQ_KEYS.host, host);
    await setTenantSetting(tid, LSQ_KEYS.activityCode, activityCode);
    await setTenantSetting(tid, LSQ_KEYS.taskCategory, (b.taskCategory ?? "").trim() || null);
    await setTenantSetting(tid, LSQ_KEYS.igHandleField, (b.igHandleField ?? "").trim() || null);
    await setTenantSetting(tid, LSQ_KEYS.autoCreate, b.autoCreate ? "true" : "false");
    await clearLsqSyncError(tid);   // re-saving keys is the recovery action — reset the visible sync error

    const verify = await verifyLsq(tid);
    return NextResponse.json({ success: true, verify });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE — disconnect this tenant's CRM (clears the stored keys).
export async function DELETE() {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await setTenantSecret(tid, LSQ_KEYS.accessKey, "");
    await setTenantSecret(tid, LSQ_KEYS.secretKey, "");
    await setTenantSetting(tid, LSQ_KEYS.host, null);
    await setTenantSetting(tid, LSQ_KEYS.activityCode, null);
    await clearLsqSyncError(tid);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
