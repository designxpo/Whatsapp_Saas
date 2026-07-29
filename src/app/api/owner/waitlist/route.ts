import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { listWaitlist, updateWaitlistStatus, deleteWaitlistEntry, WAITLIST_STATUSES, type WaitlistStatus } from "@/lib/waitlist";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET — all waitlist submissions (owner only).
export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try {
    return NextResponse.json({ entries: await listWaitlist() });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// PATCH { id, status } — move a submission through the pipeline (owner only).
export async function PATCH(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string; status?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id || !WAITLIST_STATUSES.includes(body.status as WaitlistStatus)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  try {
    await updateWaitlistStatus(body.id, body.status as WaitlistStatus);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// DELETE { id } — remove a submission (owner only).
export async function DELETE(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await deleteWaitlistEntry(body.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
