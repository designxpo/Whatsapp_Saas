import { NextResponse } from "next/server";
import { requireAdmin, currentTenantId } from "@/lib/auth";
import { getContactByPhone } from "@/lib/store";
import { generateSalesBrief } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call — must outlast Vercel's ~10s default

// POST { phone } — generate an AI sales-call brief from the lead's chat + details.
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { phone?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const digits = (body.phone ?? "").replace(/\D/g, "");
  if (!digits) return NextResponse.json({ error: "phone required" }, { status: 400 });

  // Instagram chats have no contact row (keyed by IGSID) — fall back to the
  // conversation so the brief works from the DM thread instead of 404-ing.
  const { data: convRow } = await db().from("wa_conversations")
    .select("id, name, platform, lead_phone, created_at")
    .eq("tenant_id", tid).eq("phone", digits).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const contact = await getContactByPhone(digits, tid);
  if (!contact && !convRow) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  const isIg = (convRow?.platform as string) === "instagram";

  // Build a compact context: identity + collected attributes + recent thread + campaigns + clicks.
  const lines: string[] = [];
  lines.push(`Name: ${contact?.name || (convRow?.name as string) || "Unknown"}`);
  if (isIg) {
    lines.push(`Channel: Instagram DM`);
    if (convRow?.lead_phone) lines.push(`Phone shared in chat: ${convRow.lead_phone}`);
  } else {
    lines.push(`Phone: ${contact?.phone ?? digits}`);
  }
  if (contact?.email) lines.push(`Email: ${contact.email}`);
  if (contact?.source) lines.push(`First source: ${contact.source}`);
  const since = contact?.createdAt ?? (convRow?.created_at as string | undefined);
  if (since) lines.push(`Lead since: ${new Date(since).toLocaleDateString()}`);
  if (contact?.tags.length) lines.push(`Tags: ${contact.tags.join(", ")}`);
  const attrs = Object.entries(contact?.attributes ?? {});
  if (attrs.length) lines.push(`Collected details:\n${attrs.map(([k, v]) => `  - ${k}: ${v}`).join("\n")}`);
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
    const busy = err instanceof Error && /AI_BUSY/.test(err.message);
    const msg = err instanceof AiKeyMissingError
      ? "AI isn't configured for this workspace yet (add an API key in Settings)."
      : busy ? "AI is busy right now (model overloaded) — tap Generate to try again."
      : "Could not generate the brief — try again.";
    return NextResponse.json({ error: msg }, { status: busy ? 503 : 500 });
  }
}
