import { NextResponse } from "next/server";
import { listChannels } from "@/lib/channels";
import { fetchIgMedia } from "@/lib/instagram";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's IG posts for the rule post-picker. ?channelId=… selects a
// specific connected account; otherwise the first active one.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channelId = new URL(req.url).searchParams.get("channelId");
    const igs = (await listChannels(tid)).filter(c => c.kind === "instagram" && c.igUserId);
    const ig = (channelId && igs.find(c => c.id === channelId)) || igs.find(c => c.active) || igs[0];
    if (!ig || !ig.igUserId) return NextResponse.json({ media: [], error: "Connect an Instagram account first" });
    const media = await fetchIgMedia({ igUserId: ig.igUserId, token: ig.token });
    return NextResponse.json({ media });
  } catch (err) {
    return NextResponse.json({ media: [], error: errorMessage(err) });
  }
}
