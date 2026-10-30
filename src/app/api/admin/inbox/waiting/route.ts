import { NextResponse } from "next/server";
import { currentUser, currentTenantId } from "@/lib/auth";
import { visibleChannelIds } from "@/lib/teams";
import { waitingForTeam } from "@/lib/store";
import { isAiEnabled } from "@/lib/messaging-settings";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — the chats waiting for a person, for agent alerts (src/lib/use-inbox-alerts.ts):
// the count for the tab title and the sidebar, and the newest few for
// notifications. The signed-in business only, scoped exactly as Live Chat is:
// a team member hears only about their own team's numbers.
export async function GET() {
  const tenantId = await currentTenantId();
  if (!tenantId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const [channelIds, aiOn] = await Promise.all([visibleChannelIds(await currentUser()), isAiEnabled(tenantId)]);
    return NextResponse.json(await waitingForTeam({ tenantId, channelIds, aiOn }), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
