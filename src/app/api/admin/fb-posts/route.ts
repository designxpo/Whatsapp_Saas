import { NextResponse } from "next/server";
import { listChannels } from "@/lib/channels";
import { fetchFbPosts } from "@/lib/messenger";
import { currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's Page posts for the rule post-picker. ?channelId=… selects a
// specific connected Facebook Page; otherwise the first active one.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const channelId = new URL(req.url).searchParams.get("channelId");
    const pages = (await listChannels(tid)).filter(c => c.kind === "messenger" && c.pageId);
    const page = (channelId && pages.find(c => c.id === channelId)) || pages.find(c => c.active) || pages[0];
    if (!page || !page.pageId) return NextResponse.json({ media: [], error: "Connect a Facebook Page first" });
    const media = await fetchFbPosts({ pageId: page.pageId, token: page.token });
    return NextResponse.json({ media });
  } catch (err) {
    return NextResponse.json({ media: [], error: errorMessage(err) });
  }
}
