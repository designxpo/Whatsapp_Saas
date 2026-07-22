import { NextResponse } from "next/server";
import { getWelcomeSetting, getAwaySetting, setWelcomeSetting, setAwaySetting, isAiEnabled, setAiEnabled, getFlowNudge, setFlowNudge, getFlowReminders, setFlowReminders, type WelcomeSetting, type AwaySetting, type FlowNudgeSetting, type FlowRemindersSetting } from "@/lib/messaging-settings";
import { currentUser, currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — messaging settings (AI master switch + welcome + away/working hours),
// scoped to the signed-in tenant so each business sees ONLY its own config.
export async function GET() {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [welcome, away, aiEnabled, flowNudge, flowReminders] = await Promise.all([getWelcomeSetting(tid), getAwaySetting(tid), isAiEnabled(tid), getFlowNudge(tid), getFlowReminders(tid)]);
    return NextResponse.json({ welcome, away, ai: { enabled: aiEnabled }, flowNudge, flowReminders });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — save settings. Body: { ai?: { enabled }, welcome?: {...}, away?: {...}, flowNudge?: {...} }
export async function POST(req: Request) {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { ai?: { enabled?: boolean }; welcome?: Partial<WelcomeSetting>; away?: Partial<AwaySetting>; flowNudge?: Partial<FlowNudgeSetting>; flowReminders?: Partial<FlowRemindersSetting> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    // Tenant-wide AI switch — a deliberate human action (logged below), never automated.
    if (body.ai && typeof body.ai.enabled === "boolean") {
      // The tenant-wide AI kill switch is an admin-only control.
      if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Only admins can toggle the AI switch" }, { status: 403 });
      await setAiEnabled(body.ai.enabled, tid);
    }
    if (body.welcome) {
      const current = await getWelcomeSetting(tid);
      await setWelcomeSetting(tid, { ...current, ...body.welcome, text: (body.welcome.text ?? current.text).slice(0, 1024) });
    }
    if (body.away) {
      const current = await getAwaySetting(tid);
      const merged = { ...current, ...body.away, text: (body.away.text ?? current.text).slice(0, 1024) };
      merged.startHour = Math.min(23, Math.max(0, Math.round(merged.startHour)));
      merged.endHour = Math.min(24, Math.max(0, Math.round(merged.endHour)));
      await setAwaySetting(tid, merged);
    }
    if (body.flowNudge) {
      const current = await getFlowNudge(tid);
      await setFlowNudge({
        enabled: typeof body.flowNudge.enabled === "boolean" ? body.flowNudge.enabled : current.enabled,
        variations: Array.isArray(body.flowNudge.variations) ? body.flowNudge.variations : current.variations,
      }, tid);
    }
    if (body.flowReminders) {
      const current = await getFlowReminders(tid);
      await setFlowReminders({
        enabled: typeof body.flowReminders.enabled === "boolean" ? body.flowReminders.enabled : current.enabled,
        steps: Array.isArray(body.flowReminders.steps) ? body.flowReminders.steps : current.steps,
      }, tid);
    }
    logActivity(await currentUser(), "settings.save", [body.ai && `AI replies ${body.ai.enabled ? "ON" : "OFF"}`, body.welcome && "welcome", body.away && "away", body.flowNudge && "flow nudge", body.flowReminders && "flow reminders"].filter(Boolean).join(" + "));
    const [welcome, away, aiEnabled, flowNudge, flowReminders] = await Promise.all([getWelcomeSetting(tid), getAwaySetting(tid), isAiEnabled(tid), getFlowNudge(tid), getFlowReminders(tid)]);
    return NextResponse.json({ welcome, away, ai: { enabled: aiEnabled }, flowNudge, flowReminders });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
