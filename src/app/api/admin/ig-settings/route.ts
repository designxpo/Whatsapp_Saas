import { NextResponse } from "next/server";
import { getTenantSetting, setTenantSetting } from "@/lib/store";
import { currentUser, currentTenantId, requireRoleAdmin, DEFAULT_TENANT_ID } from "@/lib/auth";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export interface IgCommentRule { enabled: boolean; keyword: string; message: string }
const DEFAULT_RULE: IgCommentRule = { enabled: false, keyword: "", message: "" };

// GET — this tenant's comment-to-DM rule for Instagram.
export async function GET() {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const rule = await getTenantSetting<IgCommentRule>(tid, "ig_comment_dm", DEFAULT_RULE);
    return NextResponse.json({ rule: { ...DEFAULT_RULE, ...rule } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — save the rule. When a comment matches `keyword` (or any comment if
// blank) and `enabled`, the IG webhook sends ONE private reply.
export async function POST(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  let body: Partial<IgCommentRule>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const current = await getTenantSetting<IgCommentRule>(tid, "ig_comment_dm", DEFAULT_RULE);
    const merged: IgCommentRule = {
      enabled: body.enabled ?? current.enabled,
      keyword: (body.keyword ?? current.keyword).trim().slice(0, 60),
      message: (body.message ?? current.message).slice(0, 900),
    };
    if (merged.enabled && !merged.message.trim()) {
      return NextResponse.json({ error: "Add the DM message to enable comment-to-DM" }, { status: 400 });
    }
    await setTenantSetting(tid, "ig_comment_dm", merged);
    logActivity(await currentUser(), "settings.save", "instagram comment-to-DM");
    return NextResponse.json({ rule: merged });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
