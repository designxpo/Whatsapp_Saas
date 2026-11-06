import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { buildToday } from "@/lib/today";
import { responseTimes } from "@/lib/response-times";
import { listUsers } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — everything waiting for a person today, each with a person, an action
// and a deadline (today.ts), plus last week's reply times and the teammates
// a task can be given to. Scoped exactly as Live Chat is.
export async function GET() {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { v, myId } = ctx;
  try {
    const today = await buildToday(v, myId);
    const [times, users] = await Promise.all([
      responseTimes(v.tenantId, { channelIds: v.allowed, targetMinutes: today.settings.replyTargetMinutes }).catch(() => null),
      listUsers(v.tenantId).catch(() => []),
    ]);
    return NextResponse.json({
      ...today,
      responseTimes: times,
      team: users.filter(u => u.active).map(u => ({ id: u.id, name: u.name || u.email })),
      me: { id: myId, role: v.user.role, canManage: v.canManage },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
