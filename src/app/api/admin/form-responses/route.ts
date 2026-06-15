import { NextResponse } from "next/server";
import { listFormResponses } from "@/lib/formresponses";
import { currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — this tenant's recent WhatsApp form responses (sent / submitted / abandoned).
export async function GET(req: Request) {
  try {
    const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;
    const limit = parseInt(new URL(req.url).searchParams.get("limit") ?? "100", 10) || 100;
    return NextResponse.json({ responses: await listFormResponses(tid, limit) });
  } catch (err) {
    return NextResponse.json({ responses: [], error: errorMessage(err) }, { status: 500 });
  }
}
