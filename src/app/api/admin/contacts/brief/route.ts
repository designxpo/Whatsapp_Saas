import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { getContactByPhone } from "@/lib/store";
import { generateSalesBrief } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// POST { phone } — generate an AI sales-call brief from the lead's chat + details.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const digits = (body.phone ?? "").replace(/\D/g, "");
  if (!digits) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const contact = await getContactByPhone(digits, tid);
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // Build a compact context: identity + collected attributes + recent thread + campaigns + clicks.
  const lines: string[] = [];
  lines.push(`Name: ${contact.name || "Unknown"}`);
  lines.push(`Phone: ${contact.phone}`);
  if (contact.email) lines.push(`Email: ${contact.email}`);
  if (contact.source) lines.push(`First source: ${contact.source}`);
  lines.push(`Lead since: ${new Date(contact.createdAt).toLocaleDateString()}`);
  if (contact.tags.length) lines.push(`Tags: ${contact.tags.join(", ")}`);
  const attrs = Object.entries(contact.attributes ?? {});
  if (attrs.length) lines.push(`Collected details:\n${attrs.map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`);

  const { data: convRow } = await db().from("wa_conversations")
    .select("id").eq("tenant_id", tid).eq("phone", digits).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (convRow) {
    const { data: msgs } = await db().from("wa_conv_messages")
      .select("role, body, created_at").eq("tenant_id", tid).eq("conversation_id", convRow.id).order("created_at", { ascending: false }).limit(30);
    const thread = (msgs ?? []).reverse().map(m => `${m.role === "user" ? "Lead" : "Us"}: ${(m.body as string ?? "").slice(0, 300)}`);
    if (thread.length) lines.push(`Recent conversation (oldest first):\n${thread.join("\n")}`);
  }

  const { data: logRows } = await db().from("wa_send_log")
    .select("campaign_id, status").eq("tenant_id", tid).eq("phone", digits).order("sent_at", { ascending: false }).limit(10);
  if (logRows?.length) lines.push(`Campaigns received: ${logRows.length} (read: ${logRows.filter(r => r.status === "read").length})`);

  const { data: linkRows } = await db().from("wa_links")
    .select("target_url, clicks").eq("tenant_id", tid).eq("phone", digits).gt("clicks", 0).limit(10);
  if (linkRows?.length) lines.push(`Links tapped:\n${linkRows.map(l => `  - ${l.target_url} (${l.clicks}×)`).join("\n")}`);

  try {
    const brief = await generateSalesBrief(lines.join("\n"), tid);
    return NextResponse.json({ brief });
  } catch (err) {
    const msg = err instanceof AiKeyMissingError
      ? "AI isn't configured for this workspace yet (add an API key in Settings)."
      : "Could not generate the brief — try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
