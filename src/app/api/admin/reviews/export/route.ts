import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { currentTenantId, requireRoleAdmin } from "@/lib/auth";
import { guardFeature } from "@/lib/feature-guard";
import { listChannels } from "@/lib/channels";
import { listUsers } from "@/lib/team";
import { toCsv } from "@/lib/review-reports";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CASE: Record<string, string> = { new: "New", in_progress: "In progress", waiting_customer: "Waiting on customer", resolved: "Resolved" };
const REPLY: Record<string, string> = { none: "No reply", draft: "Draft waiting", posted: "Replied" };

// GET ?from&to&location — the reviews as a spreadsheet (CSV). Admins only.
// Review text and replies are customer-written, so every cell is quoted and
// anything that could run as a spreadsheet formula is neutralised. No ids,
// tokens or internal notes.
export async function GET(req: Request) {
  if (!(await requireRoleAdmin())) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Workspace required" }, { status: 401 });
  const gate = await guardFeature(tid, "reviews");
  if (gate) return gate;
  const sp = new URL(req.url).searchParams;
  const from = ISO_DAY.test(sp.get("from") ?? "") ? sp.get("from")! : null;
  const to = ISO_DAY.test(sp.get("to") ?? "") ? sp.get("to")! : null;
  const location = sp.get("location");
  let q = db().from("wa_reviews")
    .select("source,channel_id,location_name,author,rating,text,review_created_at,reply_status,reply_text,posted_at,is_complaint,case_status,assignee_id,follow_up_at")
    .eq("tenant_id", tid);
  if (from) q = q.gte("review_created_at", `${from}T00:00:00Z`);
  if (to) q = q.lte("review_created_at", `${to}T23:59:59.999Z`);
  if (location === "manual") q = q.eq("source", "manual");
  else if (location) q = q.eq("channel_id", location);
  const { data, error } = await q.order("review_created_at", { ascending: false }).limit(10000);
  if (error) return NextResponse.json({ error: "The export couldn't be built right now." }, { status: 500 });
  const [channels, users] = await Promise.all([listChannels(tid), listUsers(tid)]);
  const locName = new Map(channels.map(c => [c.id, c.name]));
  const userName = new Map(users.map(u => [u.id, u.name || u.email]));
  const rows = ((data ?? []) as Record<string, unknown>[]).map(r => [
    String(r.review_created_at ?? "").slice(0, 10),
    (r.channel_id && locName.get(r.channel_id as string)) || r.location_name || "",
    r.source === "google" ? "Google" : "Pasted by hand",
    r.author ?? "", r.rating || "", r.text ?? "",
    REPLY[String(r.reply_status)] ?? r.reply_status, r.reply_text ?? "", String(r.posted_at ?? "").slice(0, 10),
    r.is_complaint ? "Yes" : "", CASE[String(r.case_status)] ?? "", (r.assignee_id && userName.get(r.assignee_id as string)) || "", String(r.follow_up_at ?? "").slice(0, 10),
  ]);
  const csv = toCsv(["Written", "Location", "Source", "Reviewer", "Stars", "Review", "Reply status", "Reply", "Replied on", "Complaint", "Case status", "Assigned to", "Follow up"], rows);
  const name = `reviews-${from ?? "all"}-to-${to ?? new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`﻿${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
}
