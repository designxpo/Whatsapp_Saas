import { NextResponse } from "next/server";
import { currentUser, DEFAULT_TENANT_ID } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { listSocialPosts, SocialPostError } from "@/lib/social-posts";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tenantId = user.tenantId || DEFAULT_TENANT_ID;
  const blocked = await guardFeature(tenantId, "growth");
  if (blocked) return blocked;
  const query = new URL(req.url).searchParams;
  try {
    const page = await listSocialPosts(
      tenantId,
      query.get("channelId") || "",
      query.get("after"),
    );
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof SocialPostError
            ? error.message
            : "Could not load posts. Try refreshing.",
      },
      {
        status: error instanceof SocialPostError ? error.status : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
