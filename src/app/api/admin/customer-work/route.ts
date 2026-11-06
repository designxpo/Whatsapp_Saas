import { NextResponse } from "next/server";
import { workContext } from "@/lib/work-access";
import { listTasks, setContactOwner } from "@/lib/tasks";
import { contactIdForPhone } from "@/lib/audience";
import { listUsers } from "@/lib/team";
import { tdb } from "@/lib/tenantdb";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// GET ?contactId= | ?phone= [&conversationId=] — who looks after this customer
// and their open follow-ups, for the panel in Live Chat and on the contact.
export async function GET(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  try {
    const contactId = q.get("contactId") || (q.get("phone") ? await contactIdForPhone(q.get("phone")!, ctx.v.tenantId) : null);
    let contact: { id: string; name: string; phone: string; ownerId: string | null } | null = null;
    if (contactId) {
      const { data, error } = await tdb(ctx.v.tenantId).from("contacts").select("id,name,phone,owner_id,channel_id").eq("id", contactId).maybeSingle();
      const c = (error ? null : data) as unknown as { id: string; name: string; phone: string; owner_id?: string | null; channel_id: string | null } | null;
      // A teammate limited to their team's numbers only sees that team's customers.
      if (c && (!ctx.v.allowed || ctx.v.allowed.includes(c.channel_id ?? ""))) contact = { id: c.id, name: c.name, phone: c.phone, ownerId: c.owner_id ?? null };
    }
    const conversationId = q.get("conversationId") ?? undefined;
    const [byContact, byChat, users] = await Promise.all([
      contact ? listTasks(ctx.v, ctx.myId, { contactId: contact.id }) : Promise.resolve({ tasks: [] }),
      conversationId ? listTasks(ctx.v, ctx.myId, { conversationId }) : Promise.resolve({ tasks: [] }),
      listUsers(ctx.v.tenantId).catch(() => []),
    ]);
    const tasks = [...byContact.tasks, ...byChat.tasks.filter(t => !byContact.tasks.some(x => x.id === t.id))]
      .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
    return NextResponse.json({
      contact, tasks, myId: ctx.myId, canManage: ctx.v.canManage,
      setupPending: !!(byContact as { setupPending?: boolean }).setupPending,
      team: users.filter(u => u.active).map(u => ({ id: u.id, name: u.name || u.email })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST { contactId, ownerId } — set (or clear, with null) who looks after this customer.
export async function POST(req: Request) {
  const ctx = await workContext();
  if (!ctx) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof b.contactId !== "string") return NextResponse.json({ error: "contactId required" }, { status: 400 });
  const ownerId = b.ownerId === null || b.ownerId === "" ? null : typeof b.ownerId === "string" ? b.ownerId : undefined;
  if (ownerId === undefined) return NextResponse.json({ error: "ownerId required (or null)" }, { status: 400 });
  const r = await setContactOwner(ctx.v, b.contactId, ownerId);
  return r.error ? NextResponse.json({ error: r.error }, { status: r.status ?? 400 }) : NextResponse.json({ ok: true });
}
