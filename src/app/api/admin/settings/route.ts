import { NextResponse } from "next/server";
import { getWelcomeSetting, getAwaySetting, setWelcomeSetting, setAwaySetting, type WelcomeSetting, type AwaySetting } from "@/lib/messaging-settings";
import { currentUser, currentTenantId } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — messaging settings (welcome + away/working hours), scoped to the
// signed-in tenant so each business sees and edits ONLY its own config.
export async function GET() {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [welcome, away] = await Promise.all([getWelcomeSetting(tid), getAwaySetting(tid)]);
    return NextResponse.json({ welcome, away });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — save settings. Body: { welcome?: {...}, away?: {...} }
export async function POST(req: Request) {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { welcome?: Partial<WelcomeSetting>; away?: Partial<AwaySetting> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
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
    logActivity(await currentUser(), "settings.save", [body.welcome && "welcome", body.away && "away"].filter(Boolean).join(" + "));
    const [welcome, away] = await Promise.all([getWelcomeSetting(tid), getAwaySetting(tid)]);
    return NextResponse.json({ welcome, away });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
