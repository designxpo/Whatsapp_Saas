import { NextResponse } from "next/server";
import { isPlatformOwner, currentUser } from "@/lib/auth";
import { listAnnouncements, saveAnnouncement, deleteAnnouncement, type Announcement } from "@/lib/announcements";
import { ownerAudit } from "@/lib/tenants";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  try { return NextResponse.json({ announcements: await listAnnouncements() }); }
  catch (err) { return NextResponse.json({ announcements: [], error: errorMessage(err) }); }
}

export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: Partial<Announcement> & { title?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.title?.trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
  try {
    const a = await saveAnnouncement({ id: body.id, title: body.title!, body: body.body, level: body.level, pinned: body.pinned, active: body.active });
    await ownerAudit((await currentUser())?.email ?? "owner", "announcement.save", null, a.title);
    return NextResponse.json({ success: true, announcement: a });
  } catch (err) { return NextResponse.json({ error: `${errorMessage(err)} — make sure migration 0025 is applied` }, { status: 500 }); }
}

export async function DELETE(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try { await deleteAnnouncement(body.id); return NextResponse.json({ success: true }); }
  catch (err) { return NextResponse.json({ error: errorMessage(err) }, { status: 500 }); }
}
