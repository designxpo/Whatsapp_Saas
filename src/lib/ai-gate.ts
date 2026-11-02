// One gate for the knowledge-base and AI-configuration routes (2026-11 AI
// security audit). Three questions, answered from the SESSION — never from the
// request body:
//
//   1. Signed in?                      no  → 401
//   2. In a business (tenant)?         no  → 401. These routes used to fall
//      back to DEFAULT_TENANT_ID, so a request with no business read and wrote
//      the platform's own knowledge base, personas and AI functions.
//   3. An admin, when the route needs one? no → 403. Before, any member could
//      upload or delete the knowledge the bot answers from, export it, and add
//      an "AI function" — a webhook the model calls with customer data.
import { NextResponse } from "next/server";
import { currentUser, currentTenantId, requireRoleAdmin } from "./auth";

export type AiGate = { ok: true; tid: string; admin: boolean } | { ok: false; res: NextResponse };

export async function aiGate(need: "admin" | "member"): Promise<AiGate> {
  const user = await currentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const tid = await currentTenantId();
  if (!tid) return { ok: false, res: NextResponse.json({ error: "No workspace for this account" }, { status: 401 }) };
  const admin = await requireRoleAdmin();   // the app's one definition of "admin"
  if (need === "admin" && !admin) return { ok: false, res: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { ok: true, tid, admin };
}
