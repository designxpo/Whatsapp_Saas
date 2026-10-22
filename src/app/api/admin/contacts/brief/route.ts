import { NextResponse } from "next/server";
import { requireAdmin, currentUser, currentTenantId } from "@/lib/auth";
import { visibleChannelIds } from "@/lib/teams";
import { getContactByPhone, getOwnerHistory } from "@/lib/store";
import { listChannels } from "@/lib/channels";
import { stagesByPhone } from "@/lib/pipeline";
import { getSequence, getSequenceSteps } from "@/lib/sequences";
import { leadContextLines } from "@/lib/leadbrief";
import { generateConversationBrief } from "@/lib/llm";
import { AiKeyMissingError } from "@/lib/ai/keys";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // LLM call — must outlast Vercel's ~10s default

// POST { phone } — generate an adaptive AI conversation brief from the thread +
// details. The model classifies the conversation (sales, support, seeker,
// feedback, spam…) and summarises it accordingly — not always a sales frame.
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
  // Team scope — the brief quotes the recent thread, so it is the same exposure
  // as the inbox and gets the same restriction.
  const allowedChannels = await visibleChannelIds(await currentUser());
  let briefQuery = db().from("wa_conversations")
    .select("id, name, platform, lead_phone, created_at, channel_id, status, needs_reply, last_inbound_at")
    .eq("tenant_id", tid).eq("phone", digits).order("created_at", { ascending: false }).limit(1);
  if (allowedChannels) briefQuery = briefQuery.in("channel_id", allowedChannels);
  const { data: convRow } = await briefQuery.maybeSingle();

  const contact = await getContactByPhone(digits, tid);
  if (!contact && !convRow) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // Everything below is supplementary: a lookup that fails leaves its line out
  // of the brief rather than failing the brief.
  const convId = (convRow?.id as string | undefined) ?? null;
  const [channels, stages, owners, msgs, enrolments, logRows, linkRows] = await Promise.all([
    listChannels(tid).catch(() => []),
    stagesByPhone([digits], tid).catch(() => ({} as Awaited<ReturnType<typeof stagesByPhone>>)),
    convId ? getOwnerHistory(convId, tid).catch(() => []) : Promise.resolve([]),
    convId
      ? db().from("wa_conv_messages").select("role, body, created_at").eq("tenant_id", tid).eq("conversation_id", convId).order("created_at", { ascending: false }).limit(30).then(r => r.data ?? [])
      : Promise.resolve([]),
    db().from("wa_sequence_enrollments").select("sequence_id, current_step, status, last_error").eq("tenant_id", tid).eq("phone", digits).order("created_at", { ascending: false }).limit(5).then(r => r.data ?? []),
    db().from("wa_send_log").select("campaign_id, status").eq("tenant_id", tid).eq("phone", digits).order("sent_at", { ascending: false }).limit(10).then(r => r.data ?? []),
    db().from("wa_links").select("target_url, clicks").eq("tenant_id", tid).eq("phone", digits).gt("clicks", 0).limit(10).then(r => r.data ?? []),
  ]);
  const channelName = (id: string | null | undefined) => (id ? channels.find(c => c.id === id)?.name : null) ?? null;
  const drips = await Promise.all(enrolments.map(async e => {
    const [seq, steps] = await Promise.all([
      getSequence(e.sequence_id as string, tid).catch(() => null),
      getSequenceSteps(e.sequence_id as string, tid).catch(() => []),
    ]);
    return {
      sequence: seq?.name ?? "A drip",
      step: Math.min((e.current_step as number) + 1, Math.max(steps.length, 1)),
      steps: Math.max(steps.length, 1),
      status: e.status as string,
      lastError: (e.last_error as string | null) ?? null,
    };
  }));

  const lines = leadContextLines({
    name: contact?.name || (convRow?.name as string) || "Unknown",
    phone: contact?.phone ?? digits,
    isInstagram: (convRow?.platform as string) === "instagram",
    igPhone: (convRow?.lead_phone as string | null) ?? null,
    email: contact?.email ?? null,
    firstSource: contact?.source ?? null,
    since: contact?.createdAt ?? (convRow?.created_at as string | undefined) ?? null,
    tags: contact?.tags ?? [],
    attributes: contact?.attributes ?? {},
    pipelineStage: stages[digits]?.name ?? null,
    status: (convRow?.status as string | null) ?? null,
    needsReply: !!convRow?.needs_reply,
    lastInboundAt: (convRow?.last_inbound_at as string | null) ?? null,
    owner: channelName(convRow?.channel_id as string | null),
    // Where the lead started is logged too (store.ts) — that is not a hand-over.
    handovers: owners.filter(o => !/^First (contact|known number)/.test(o.reason ?? ""))
      .map(o => ({ at: o.createdAt, to: channelName(o.channelId) ?? "another number", reason: o.reason })),
    drips,
    thread: msgs.slice().reverse().map(m => ({ role: m.role === "user" ? "user" as const : "assistant" as const, body: (m.body as string) ?? "" })),
    campaigns: { received: logRows.length, read: logRows.filter(r => r.status === "read").length },
    links: linkRows.map(l => ({ url: l.target_url as string, clicks: l.clicks as number })),
  });

  try {
    const brief = await generateConversationBrief(lines.join("\n"), tid);
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
