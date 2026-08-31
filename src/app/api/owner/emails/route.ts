import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// GET ?type=&status=&tenantId=&q=&offset= — one page of the platform's email
// log (owner only). `q` matches the recipient address or subject
// (case-insensitive substring). Newest first.
export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  try {
    let query = db().from("wa_email_log")
      .select("id,tenant_id,email_type,to_email,subject,status,error,sent_at,delivered_at,opened_at,clicked_at,bounced_at,tenants(company)", { count: "exact" })
      .order("sent_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (type) query = query.eq("email_type", type);
    if (status) query = query.eq("status", status);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    if (q) query = query.or(`to_email.ilike.%${q}%,subject.ilike.%${q}%`);

    const { data, count, error } = await query;
    if (error) throw error;

    const rows = (data ?? []).map(r => ({
      id: r.id as string,
      tenantId: (r.tenant_id as string | null) ?? null,
      company: ((r.tenants as { company?: string | null } | null)?.company) ?? null,
      type: r.email_type as string,
      to: r.to_email as string,
      subject: r.subject as string,
      status: r.status as string,
      error: (r.error as string | null) ?? null,
      sentAt: r.sent_at as string,
      deliveredAt: (r.delivered_at as string | null) ?? null,
      openedAt: (r.opened_at as string | null) ?? null,
      clickedAt: (r.clicked_at as string | null) ?? null,
      bouncedAt: (r.bounced_at as string | null) ?? null,
    }));

    return NextResponse.json({ rows, total: count ?? rows.length, offset, pageSize: PAGE_SIZE });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
