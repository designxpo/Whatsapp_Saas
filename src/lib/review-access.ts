// Who may see and work a review. Admins see every review in their workspace.
// A team member scoped to some locations (teams.ts) sees only reviews from
// those locations — pasted reviews belong to no location, so only unscoped
// people see them. Assigning and linking a CRM contact need an admin or lead.

import { currentUser, currentTenantId, type SessionUser } from "./auth";
import { visibleChannelIds } from "./teams";
import { getReview, type Review } from "./reviews";
import { db } from "./supabase";

export interface ReviewViewer { user: SessionUser; tenantId: string; allowed: string[] | null; canManage: boolean }

export async function reviewViewer(): Promise<ReviewViewer | null> {
  const user = await currentUser();
  if (!user) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  return { user, tenantId, allowed: await visibleChannelIds(user), canManage: user.role === "admin" || user.role === "lead" };
}

export function canSee(v: ReviewViewer, r: Pick<Review, "channelId">): boolean {
  return !v.allowed || (!!r.channelId && v.allowed.includes(r.channelId));
}

/** The review if this viewer may see it, else null (never reveals that it exists elsewhere). */
export async function visibleReview(v: ReviewViewer, id: string): Promise<Review | null> {
  const r = await getReview(id, v.tenantId);
  return r && canSee(v, r) ? r : null;
}

/** The signed-in person's teammate id in this workspace (for "assigned to me"). */
export async function viewerUserId(v: ReviewViewer): Promise<string | null> {
  const { data } = await db().from("wa_users").select("id").eq("tenant_id", v.tenantId).eq("email", v.user.email.toLowerCase()).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
