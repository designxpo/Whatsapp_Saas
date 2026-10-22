import { NextResponse } from "next/server";
import { currentUser, currentTenantId, requireAdmin, requireRoleAdmin } from "@/lib/auth";
import { getDigestConfig, setDigestConfig, digestRecipients, sendDigestNow, DIGEST_TZ, LAST_DAY_KEY } from "@/lib/dailydigest";
import { isUnsubscribed } from "@/lib/emailprefs";
import { getTenantSetting } from "@/lib/store";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a send-now waits on the AI read and the mail provider

// Every read and write is scoped to the CALLER's workspace — the digest emails
// its admins, so it must never be configurable or sendable across workspaces.

async function status(tenantId: string) {
  const { data } = await db().from("tenants").select("owner_email").eq("id", tenantId).maybeSingle();
  const [cfg, recipients, unsubscribed, lastDay] = await Promise.all([
    getDigestConfig(tenantId),
    digestRecipients(tenantId, (data as { owner_email?: string | null } | null)?.owner_email ?? null),
    isUnsubscribed(tenantId, "daily_digest"),
    getTenantSetting<string | null>(tenantId, LAST_DAY_KEY, null),
  ]);
  return {
    ...cfg, recipients, unsubscribed, lastDay, timezone: DIGEST_TZ(),
    mailProblem: process.env.RESEND_API_KEY ? null : "RESEND_API_KEY is not set, so no email can be delivered.",
  };
}

// GET — this workspace's config, who it goes to, and whether email can send at all.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = await currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await status(tenantId)); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}

// POST { enabled?, hour? } → save config
// POST { sendNow: true }   → send to the recipients now (does not count as today's digest)
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = await currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { enabled?: boolean; hour?: number; sendNow?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (body.sendNow) {
      const r = await sendDigestNow(tenantId);
      logActivity(await currentUser(), "settings.daily_digest.send_now", `sent to ${r.sent}${r.reason ? ` — ${r.reason}` : ""}`);
      return NextResponse.json({ ...r, status: await status(tenantId) });
    }
    const cfg = await setDigestConfig(tenantId, { enabled: body.enabled, hour: body.hour });
    logActivity(await currentUser(), "settings.daily_digest", `${cfg.enabled ? "on" : "off"} · ${cfg.hour}:00`);
    return NextResponse.json(await status(tenantId));
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
