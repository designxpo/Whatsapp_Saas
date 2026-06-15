export const maxDuration = 60;
import { NextResponse, after } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import {
  updateLogByMessageId, messageLogged, claimWebhookEvent, addOptout, removeOptout, optoutSet, upsertContacts,
  getOrCreateConversation, appendConvMessage, touchInbound, claimWelcome,
  setContactAttributes, addContactTag,
} from "@/lib/store";
import { growthToolForOptIn, recordGrowthConversion } from "@/lib/growth";
import { enroll } from "@/lib/sequences";
import { getOpenCart, checkoutCart } from "@/lib/commerce";
import { sendText } from "@/lib/whatsapp";
import { getChannelByPhoneNumberId, type Channel } from "@/lib/channels";
import { DEFAULT_TENANT_ID } from "@/lib/auth";
import { respondToConversation } from "@/lib/assistant";
import { pushWaActivity } from "@/lib/leadsquared";
import { getWelcomeSetting, getAwaySetting, isOutsideWorkingHours } from "@/lib/messaging-settings";
import { loadMemory, saveMemory } from "@/lib/router/memory";
import { handleFlowMessage } from "@/lib/flowengine";
import { recordFormSubmitted } from "@/lib/formresponses";
import { resolveFlowIdForAd } from "@/lib/adflow";

const OPTOUT_RE = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i;
const OPTIN_RE = /^\s*(start|unstop|subscribe|opt[\s-]?in)\s*$/i;
const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);

// GET — Meta webhook verification handshake.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && constEq(token ?? "", process.env.META_WA_WEBHOOK_VERIFY_TOKEN)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// Parses a WhatsApp form (Flows) submission into { field: answer } pairs.
function formAnswers(m: Record<string, unknown>): Record<string, string> | null {
  const it = m.interactive as Record<string, unknown> | undefined;
  const nfm = it?.nfm_reply as Record<string, unknown> | undefined;
  if (!nfm?.response_json) return null;
  try {
    const resp = JSON.parse(nfm.response_json as string) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(resp)) {
      if (k === "flow_token" || v === null || v === undefined) continue;
      // Choice fields submit option ids like "1_Data_Science" — strip the index.
      const clean = (s: string) => s.replace(/^\d+_/, "").replaceAll("_", " ");
      out[k] = Array.isArray(v) ? v.map(x => clean(String(x))).join(", ") : clean(String(v));
    }
    return out;
  } catch { return null; }
}

// Extracts readable text from a Meta inbound message object.
function messageText(m: Record<string, unknown>): string {
  const type = m.type as string;
  if (type === "text") return ((m.text as Record<string, unknown>)?.body as string) ?? "";
  if (type === "button") return ((m.button as Record<string, unknown>)?.text as string) ?? "";
  if (type === "interactive") {
    const it = m.interactive as Record<string, unknown>;
    const answers = formAnswers(m);
    if (answers) {
      const lines = Object.entries(answers).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`);
      return `[form] ${lines.join(" · ") || "submitted"}`;
    }
    const br = (it?.button_reply ?? it?.list_reply) as Record<string, unknown> | undefined;
    return (br?.title as string) ?? "";
  }
  return `[${type} message]`;
}

// Handles one inbound message: dedup, opt-out, persist, trigger AI reply.
async function handleInbound(value: Record<string, unknown>, m: Record<string, unknown>) {
  const id = m.id as string;
  const from = (m.from as string) || "";
  if (!id || !from) return;
  if (await messageLogged(id)) return;                       // webhook retry — already handled
  if (!(await claimWebhookEvent(`wa:${id}`))) return;        // atomic guard against concurrent redelivery

  // Multi-number routing: Meta tells us which of our numbers received this.
  // Replies must go out from the same number; null = env single-number mode.
  const phoneNumberId = ((value.metadata as Record<string, unknown>)?.phone_number_id as string) ?? "";
  const channel: Channel | undefined = (await getChannelByPhoneNumberId(phoneNumberId)) ?? undefined;
  // Inbound belongs to the receiving channel's tenant (never a magic default).
  const tid = channel?.tenantId ?? DEFAULT_TENANT_ID;

  // Shared-WABA guard: webhooks arrive for EVERY number on the WABA. Only
  // handle numbers this portal owns (a channel row or the env number) —
  // other numbers may be served by a different system; never double-handle.
  if (!channel && phoneNumberId && phoneNumberId !== process.env.META_WA_PHONE_NUMBER_ID) {
    console.log(JSON.stringify({ tag: "webhook_skip_foreign_number", phoneNumberId }));
    return;
  }

  const text = messageText(m).trim();
  const contacts = (value.contacts as Record<string, unknown>[]) ?? [];
  const profileName = ((contacts[0]?.profile as Record<string, unknown>)?.name as string) ?? "";

  // Opt-out keyword — suppress, confirm, and stop. Never invoke the bot.
  if (OPTOUT_RE.test(text)) {
    await addOptout(from, "inbound STOP", tid);
    await sendText(from, "You've been unsubscribed and won't receive further messages. Reply START to opt back in.", channel);
    return;
  }
  // Opt back in — the STOP confirmation promises "Reply START to opt back in".
  if (OPTIN_RE.test(text) && (await optoutSet(tid)).has(last10(from))) {
    await removeOptout(from, tid);
    await sendText(from, "Welcome back! You're subscribed again and will receive our updates. Reply STOP anytime to opt out.", channel);
    return;
  }
  // Already opted out — ignore inbound entirely.
  if ((await optoutSet(tid)).has(last10(from))) return;

  // Ensure the sender is a contact, then attach to a conversation.
  await upsertContacts([{ phone: from, name: profileName }], "inbound", tid).catch(() => undefined);

  // Click-to-WhatsApp ad attribution — when the chat was opened from an ad,
  // Meta attaches a referral object. Stamp the contact so the Ads tab can show
  // exactly which ad produced which conversations and leads.
  const referral = m.referral as Record<string, unknown> | undefined;
  if (referral?.source_id) {
    void setContactAttributes(from, {
      ad_id: String(referral.source_id),
      ...(referral.headline ? { ad_headline: String(referral.headline).slice(0, 120) } : {}),
      ...(referral.source_type ? { ad_source: String(referral.source_type) } : {}),
    }, tid).catch(() => undefined);
  }

  // WhatsApp form submission → every answer becomes a contact attribute.
  const answers = formAnswers(m);
  if (answers && Object.keys(answers).length) {
    await setContactAttributes(from, answers, tid).catch(() => undefined);
  }

  const conv = await getOrCreateConversation(from, profileName, channel?.id ?? null, "whatsapp", tid);
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, metaId: id, source: "inbound", tenantId: tid });
  await touchInbound(conv.id, text);

  // Form submission → record it (sent→submitted) for the Responses view + chat.
  if (answers && Object.keys(answers).length) {
    await recordFormSubmitted(conv.id, from, answers, tid).catch(() => undefined);
  }

  // In-chat checkout: a checkout-flow submission (carries a delivery address)
  // for a contact with an open cart → create the order and confirm.
  if (answers && Object.keys(answers).some(k => k.includes("address")) && await getOpenCart(from, tid)) {
    try {
      const order = await checkoutCart({ phone: from }, tid);
      if (order) {
        const msg = "✅ Order placed! Thanks — we've got your details and will confirm shortly.";
        const r = await sendText(from, msg, channel);
        if (r.id) await appendConvMessage({ conversationId: conv.id, role: "assistant", body: msg, metaId: r.id, source: "bot", tenantId: tid }).catch(() => undefined);
      }
    } catch (e) { console.error("[webhook] checkout", e); }
  }

  // Mirror the lead's reply onto their LeadSquared timeline (no-op when LSQ unset).
  after(() => pushWaActivity({ phone: from, direction: "inbound", body: text, via: "lead" }));

  // Growth opt-in: if this message matches a growth tool's prefilled keyword,
  // apply its action (tag + sequence enrollment) and count the conversion.
  try {
    const tool = await growthToolForOptIn(text, tid);
    if (tool) {
      if (tool.tag) await addContactTag(from, tool.tag, tid);
      if (tool.sequenceId) await enroll(tool.sequenceId, { phone: from, platform: "whatsapp", conversationId: conv.id }, tid);
      await recordGrowthConversion(tool.id, tid);
    }
  } catch (e) { console.error("[webhook] growth opt-in", e); }

  // After the 200 ack: welcome → away notice → AI reply, in that order so the
  // greeting lands before the answer. claimReply/claimWelcome guard double-sends.
  after(async () => {
    try {
      const [welcome, away] = await Promise.all([getWelcomeSetting(), getAwaySetting()]);

      // First-ever message from this contact → one-time greeting.
      if (welcome.enabled && !conv.welcomed && await claimWelcome(conv.id)) {
        const sent = await sendText(from, welcome.text, channel);
        if (sent.id) await appendConvMessage({ conversationId: conv.id, role: "assistant", body: welcome.text, metaId: sent.id, source: "bot" });
      }

      // Outside working hours → away notice, at most once per 12h per conversation.
      if (away.enabled && isOutsideWorkingHours(away)) {
        const mem = await loadMemory(conv.id).catch(() => ({} as Awaited<ReturnType<typeof loadMemory>>));
        const lastAway = mem.lastAwayAt ? Date.parse(mem.lastAwayAt) : 0;
        if (Date.now() - lastAway > 12 * 3600 * 1000) {
          const sent = await sendText(from, away.text, channel);
          if (sent.id) {
            await appendConvMessage({ conversationId: conv.id, role: "assistant", body: away.text, metaId: sent.id, source: "bot" });
            await saveMemory(conv.id, { ...mem, lastAwayAt: new Date().toISOString() });
          }
        }
      }
    } catch (e) { console.error("[webhook] welcome/away", conv.id, e); }

    // Chatbot flows take precedence: an ad-bound flow (CTWA lead from a campaign
    // with a flow attached), then keyword triggers and in-progress sessions.
    // Off-script messages fall through to the AI (smarter than a dead-end).
    let adFlowId: string | undefined;
    if (referral?.source_id) {
      adFlowId = (await resolveFlowIdForAd(String(referral.source_id), tid).catch(() => null)) ?? undefined;
    }
    let flowHandled = false;
    try { flowHandled = await handleFlowMessage(conv.id, from, text, { channel, adFlowId }); }
    catch (e) { console.error("[webhook] flow", conv.id, e); }

    if (!flowHandled && process.env.LLM_BOT_ENABLED !== "false") {
      try { await respondToConversation(conv.id); }
      catch (e) { console.error("[webhook] respond", conv.id, e); }
    }
  });
}

// POST — inbound messages + delivery/read status updates. Verifies signature.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_WA_WEBHOOK_SECRET)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = (change.value ?? {}) as Record<string, unknown>;

        // Delivery/read status updates.
        for (const status of (value.statuses as Record<string, unknown>[]) ?? []) {
          const id = status.id as string;
          const at = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
          if (status.status === "delivered") await updateLogByMessageId(id, "delivered", at);
          else if (status.status === "read") await updateLogByMessageId(id, "read", at);
        }

        // Inbound messages.
        for (const m of (value.messages as Record<string, unknown>[]) ?? []) {
          try { await handleInbound(value, m); }
          catch (e) { console.error("[webhook] inbound", e); }
        }
      }
    }
  } catch (err) {
    console.error("[webhook] parse error:", err);
  }
  return NextResponse.json({ received: true });
}
