import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { getBoard } from "@/lib/pipeline";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's Kanban board: stages + every contact on it (chat snippet).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
  try {
    return NextResponse.json(await getBoard(tid));
  } catch (err) {
    return NextResponse.json({ stages: [], cards: [], error: errorMessage(err) });
  }
}
