import { NextResponse } from "next/server";
import { setSetting } from "@/lib/store";
import { getWelcomeSetting, getAwaySetting, type WelcomeSetting, type AwaySetting } from "@/lib/messaging-settings";
import { currentUser } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — messaging settings (welcome + away/working hours).
export async function GET() {
  try {
    const [welcome, away] = await Promise.all([getWelcomeSetting(), getAwaySetting()]);
    return NextResponse.json({ welcome, away });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — save settings. Body: { welcome?: {...}, away?: {...} }
export async function POST(req: Request) {
  let body: { welcome?: Partial<WelcomeSetting>; away?: Partial<AwaySetting> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    if (body.welcome) {
      const current = await getWelcomeSetting();
      await setSetting("welcome", { ...current, ...body.welcome, text: (body.welcome.text ?? current.text).slice(0, 1024) });
    }
    if (body.away) {
      const current = await getAwaySetting();
      const merged = { ...current, ...body.away, text: (body.away.text ?? current.text).slice(0, 1024) };
      merged.startHour = Math.min(23, Math.max(0, Math.round(merged.startHour)));
      merged.endHour = Math.min(24, Math.max(0, Math.round(merged.endHour)));
      await setSetting("away", merged);
    }
    logActivity(await currentUser(), "settings.save", [body.welcome && "welcome", body.away && "away"].filter(Boolean).join(" + "));
    const [welcome, away] = await Promise.all([getWelcomeSetting(), getAwaySetting()]);
    return NextResponse.json({ welcome, away });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
