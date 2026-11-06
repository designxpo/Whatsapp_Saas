import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { saveWorkSettings } from "@/lib/work-settings";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST { replyTargetMinutes?, alertEmails?, alertHours?, unpaidReminder? } — admins only:
// these decide who gets emailed and whether customers get a payment reminder.
export async function POST(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (ctx.v.user.role !== "admin") return NextResponse.json({ error: "Only an admin can change these settings." }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const settings = await saveWorkSettings(ctx.v.tenantId, body);
    logActivity({ email: ctx.v.user.email, name: ctx.v.user.name, tenantId: ctx.v.tenantId }, "today.settings",
      `reply target ${settings.replyTargetMinutes} min · alert emails ${settings.alertEmails ? "on" : "off"} · unpaid reminder ${settings.unpaidReminder.enabled ? "on" : "off"}`);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
