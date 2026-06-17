import { NextResponse } from "next/server";
import { requireRoleAdmin, currentTenantId } from "@/lib/auth";
import { verifyIntegration } from "@/lib/integrations";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST — send a live test ping and persist the result (connected / error).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json({ verify: await verifyIntegration(id, tid) });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
