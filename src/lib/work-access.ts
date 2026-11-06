// Who is asking, for the Today view, tasks and customer owners: the signed-in
// teammate, their workspace, the numbers they may see (teams.ts) and their own
// teammate id (for "mine"). Same rules as the inbox and review cases.

import { reviewViewer, viewerUserId, type ReviewViewer } from "./review-access";

export type WorkViewer = ReviewViewer;

export async function workContext(): Promise<{ v: WorkViewer; myId: string | null } | null> {
  const v = await reviewViewer();
  if (!v) return null;
  return { v, myId: await viewerUserId(v) };
}
