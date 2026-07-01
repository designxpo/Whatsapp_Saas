// Generous budget: an inbound voice note does a synchronous transcription AND
// then an AI reply (in after()) — two sequential model calls that on a slow
// moment can blow a 60s cap, killing the reply. (The cron is the backstop; this
// keeps the live reply landing in the first place.)
export const maxDuration = 180;
import { NextResponse, after } from "next/server";
import { constEq, verifyMetaSignature } from "@/lib/apiauth";
import {
  updateLogByMessageId, messageLogged, claimWebhookEvent, addOptout, removeOptout, isOptedOut, upsertContacts,
  getOrCreateConversation, appendConvMessage, touchInbound, claimWelcome,
  setContactAttributes, addContactTag, markOptedIn,
} from "@/lib/store";
import { growthToolForOptIn, recordGrowthConversion } from "@/lib/growth";
import { parseRef, stripRef, resolveRef, recordTouch } from "@/lib/handlehub";
import { enroll, matchKeywordSequence, hasActiveEnrollment } from "@/lib/sequences";
import { getOpenCart, checkoutCart } from "@/lib/commerce";
import { sendText, sendTypingIndicator, downloadMedia } from "@/lib/whatsapp";
import { transcribeAudio } from "@/lib/voice";
import { uploadAudio, uploadMedia } from "@/lib/supabase";
import { getChannelByPhoneNumberId, recordChannelQuality, type Channel } from "@/lib/channels";
import { DEFAULT_TENANT_ID } from "@/lib/auth";
import { respondToConversation } from "@/lib/assistant";
import { pushWaActivity, syncLeadProfile } from "@/lib/leadsquared";
import { emitEvent } from "@/lib/integrations";
import { getWelcomeSetting, getAwaySetting, isOutsideWorkingHours } from "@/lib/messaging-settings";
import { loadMemory, saveMemory } from "@/lib/router/memory";
import { handleFlowMessage } from "@/lib/flowengine";
import { recordFormSubmitted } from "@/lib/formresponses";
import { resolveFlowIdForAd } from "@/lib/adflow";

const OPTOUT_RE = /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i;
const OPTIN_RE = /^\s*(start|unstop|subscribe|opt[\s-]?in)\s*$/i;

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

  let text = messageText(m).trim();
  let mediaUrl: string | null = null;     // inbound voice note, re-hosted for Live Chat playback
  let mediaType: string | null = null;
  const contacts = (value.contacts as Record<string, unknown>[]) ?? [];
  const profileName = ((contacts[0]?.profile as Record<string, unknown>)?.name as string) ?? "";

  // Inbound voice note → transcribe with the tenant's AI and treat the transcript
  // as the message, so flows, the AI and CRM sync all work exactly as for text.
  // (messageText returns a "[audio message]" placeholder for audio, so key off
  // the type — never the text, which is non-empty here.)
  let voiceInbound = false;
  if (m.type === "audio") {
    const audioId = (m.audio as Record<string, unknown> | undefined)?.id as string | undefined;
    const media = audioId ? await downloadMedia(audioId, channel) : null;
    if (!media) console.warn(JSON.stringify({ tag: "voice_download_failed", from, audioId: !!audioId }));
    const transcript = media ? await transcribeAudio(media, tid) : null;
    if (media && !transcript) console.warn(JSON.stringify({ tag: "voice_transcribe_failed", from, mime: media.mimeType }));
    if (media && transcript) {
      text = transcript; voiceInbound = true;
      // Re-host the clip so the agent can replay it next to the transcript.
      mediaUrl = await uploadAudio(media.data, media.mimeType);
      mediaType = mediaUrl ? media.mimeType : null;
      console.log(JSON.stringify({ tag: "voice_transcribed", from, chars: transcript.length, stored: !!mediaUrl }));
    } else {
      await sendText(from, "Sorry, I couldn't quite catch that voice note — could you type your question?", channel);
      return;
    }
  }

  // Inbound image / video / document / sticker → re-host so it shows in Live Chat.
  // The customer's caption (if any) becomes the message text; otherwise the
  // "[image message]" placeholder is kept so the AI / list behave as before.
  if (!mediaUrl && (m.type === "image" || m.type === "video" || m.type === "document" || m.type === "sticker")) {
    const node = m[m.type] as Record<string, unknown> | undefined;
    const mediaId = node?.id as string | undefined;
    const media = mediaId ? await downloadMedia(mediaId, channel) : null;
    if (media) {
      mediaUrl = await uploadMedia(media.data, media.mimeType);
      if (mediaUrl) {
        mediaType = media.mimeType;
        const caption = (node?.caption as string)?.trim();
        if (caption) text = caption;
        console.log(JSON.stringify({ tag: "media_stored", from, type: m.type, mime: media.mimeType }));
      }
    }
  }

  // Opt-out keyword — suppress, confirm, and stop. Never invoke the bot.
  if (OPTOUT_RE.test(text)) {
    await addOptout(from, "inbound STOP", tid);
    await sendText(from, "You've been unsubscribed and won't receive further messages. Reply START to opt back in.", channel);
    after(() => emitEvent(tid, "contact.optout", { phone: from, name: profileName, reason: "inbound STOP" }));
    return;
  }
  // One indexed lookup, reused for both the opt-back-in and the suppress checks
  // (avoids loading the tenant's entire opt-out set on every inbound message).
  const optedOut = await isOptedOut(from, tid);
  // Opt back in — the STOP confirmation promises "Reply START to opt back in".
  if (OPTIN_RE.test(text) && optedOut) {
    await removeOptout(from, tid);
    await sendText(from, "Welcome back! You're subscribed again and will receive our updates. Reply STOP anytime to opt out.", channel);
    return;
  }
  // Already opted out — ignore inbound entirely.
  if (optedOut) return;

  // Handle Hub attribution — a tracked link/QR embeds "[ref:CODE]" in the prefilled
  // first message. Capture which source (QR / ad / bio) started the chat, then strip
  // the token so every downstream path (storage, flows, keywords, CRM) sees only the
  // customer's real text. Fire-and-forget; never blocks the inbound.
  const hhRef = parseRef(text);
  if (hhRef) {
    const stripped = stripRef(text);
    if (stripped) text = stripped;
    void resolveRef(tid, hhRef).then(src => {
      if (!src) return;
      void recordTouch(src.id, tid);
      void setContactAttributes(from, { handle_source: src.label }, tid).catch(() => undefined);
    }).catch(() => undefined);
  }

  // Ensure the sender is a contact, then attach to a conversation. An inbound
  // message IS a verifiable opt-in, so mark consent (and upgrade an existing
  // imported-but-unconsented contact via markOptedIn).
  const upserted = await upsertContacts([{ phone: from, name: profileName }], "inbound", tid, { consented: true, proof: "WhatsApp inbound message" }).catch(() => undefined);
  await markOptedIn(from, "inbound", "WhatsApp inbound message", tid).catch(() => undefined);
  // Brand-new contact → a new lead. Fire once (inserted>0) so CRM connectors
  // sync each lead exactly once instead of on every message.
  if (upserted?.inserted) after(() => emitEvent(tid, "contact.created", { phone: from, name: profileName, channel: "whatsapp" }));

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
    // Mirror a form-captured email/city onto the LSQ lead (same gap the ask path had).
    const pick = (re: RegExp) => { for (const [k, v] of Object.entries(answers)) if (re.test(k) && String(v).trim()) return String(v).trim(); return undefined; };
    const fEmail = pick(/email/i), fCity = pick(/city/i);
    if (fEmail || fCity) void syncLeadProfile({ phone: from, email: fEmail, city: fCity, name: profileName }, tid);
  }

  const conv = await getOrCreateConversation(from, profileName, channel?.id ?? null, "whatsapp", tid);
  await appendConvMessage({ conversationId: conv.id, role: "user", body: text, metaId: id, source: "inbound", tenantId: tid, mediaUrl, mediaType });
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
        const msg = order.paymentUrl
          ? `✅ Order placed! Complete your payment here to confirm your order:\n${order.paymentUrl}`
          : "✅ Order placed! Thanks — we've got your details and will confirm shortly.";
        const r = await sendText(from, msg, channel);
        if (r.id) await appendConvMessage({ conversationId: conv.id, role: "assistant", body: msg, metaId: r.id, source: "bot", tenantId: tid }).catch(() => undefined);
      }
    } catch (e) { console.error("[webhook] checkout", e); }
  }

  // Mirror the lead's reply onto their LeadSquared timeline (no-op when LSQ unset).
  after(() => pushWaActivity({ phone: from, direction: "inbound", body: text, via: "lead", tenantId: tid }));
  // Fan the inbound message out to any connected integrations (Zapier/Sheets/
  // Slack…). Deferred so it never delays the reply; no-op when none configured.
  after(() => emitEvent(tid, "message.inbound", { phone: from, name: profileName, text, channel: "whatsapp", conversationId: conv.id }));

  // Growth opt-in: if this message matches a growth tool's prefilled keyword,
  // apply its action (tag + sequence enrollment) and count the conversion.
  try {
    const tool = await growthToolForOptIn(text, tid);
    if (tool) {
      if (tool.tag) await addContactTag(from, tool.tag, tid);
      if (tool.sequenceId) await enroll(tool.sequenceId, { phone: from, platform: "whatsapp", conversationId: conv.id }, tid);
      await markOptedIn(from, "growth", `Growth keyword opt-in${tool.tag ? ` (${tool.tag})` : ""}`, tid);
      await recordGrowthConversion(tool.id, tid);
    }
  } catch (e) { console.error("[webhook] growth opt-in", e); }

  // After the 200 ack: welcome → away notice → AI reply, in that order so the
  // greeting lands before the answer. claimReply/claimWelcome guard double-sends.
  after(async () => {
    // A human owns the chat → the bot stays silent on every path (welcome, away,
    // flow AND ai), matching IG/Messenger/web-chat. bot_enabled is flipped off only
    // by a human (inbox reply / CRM / manual toggle); "escalated" is NOT silenced.
    if (!conv.botEnabled || conv.status === "paused") return;
    // If a drip is already driving this contact, stay quiet — no welcome, no AI —
    // so the sequence owns the thread (until it completes) and nothing collides.
    const inSequence = await hasActiveEnrollment(from, tid).catch(() => false);
    try {
      const [welcome, away] = await Promise.all([getWelcomeSetting(tid), getAwaySetting(tid)]);

      // First-ever message from this contact → one-time greeting.
      if (welcome.enabled && !conv.welcomed && !inSequence && await claimWelcome(conv.id)) {
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

    // Keyword-triggered sequence: the exact trigger word opts the contact into a
    // timed follow-up. Like flows, it takes precedence over the generic AI reply
    // so the drip drives the chat (its first step may be delayed, e.g. 2 min).
    let sequenceTriggered = false;
    if (!flowHandled) {
      try {
        const seq = await matchKeywordSequence("whatsapp", text, tid);
        if (seq) { await enroll(seq.id, { phone: from, platform: "whatsapp", conversationId: conv.id }, tid); sequenceTriggered = true; }
      } catch (e) { console.error("[webhook] keyword sequence", conv.id, e); }
    }

    if (!flowHandled && !sequenceTriggered && !inSequence && process.env.LLM_BOT_ENABLED !== "false") {
      await sendTypingIndicator(id, channel);   // "typing…" while the AI composes
      try { await respondToConversation(conv.id, { inboundWasVoice: voiceInbound }); }
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
      const wabaId = entry.id ? String(entry.id) : null;   // WABA id for account-level events
      for (const change of entry.changes ?? []) {
        const value = (change.value ?? {}) as Record<string, unknown>;
        const field = change.field as string | undefined;

        // Number quality / messaging-limit health → persist + auto-pause marketing.
        // event is FLAGGED|UNFLAGGED; current_limit carries the tier. We match the
        // channel by phone_number_id when present, else by WABA id (entry.id).
        if (field === "phone_number_quality_update") {
          const meta = (value.metadata as Record<string, unknown>) ?? {};
          after(() => recordChannelQuality(
            { phoneNumberId: (meta.phone_number_id as string) ?? (value.phone_number_id as string) ?? null, wabaId },
            { health: value.event === "FLAGGED" ? "FLAGGED" : value.event === "UNFLAGGED" ? "AVAILABLE" : null, event: value.event as string | null },
          ));
          continue;
        }
        // Some accounts deliver the GREEN/YELLOW/RED rating via account_update.
        if (field === "account_update" && (value.current_quality_rating || value.event === "ACCOUNT_RESTRICTION")) {
          after(() => recordChannelQuality(
            { wabaId },
            { rating: value.current_quality_rating as string | null, health: value.event === "ACCOUNT_RESTRICTION" ? "RESTRICTED" : null, event: value.event as string | null },
          ));
          continue;
        }
        // Template paused/disabled/rejected by Meta — log so a tenant can react.
        if (field === "message_template_status_update") {
          console.warn("[webhook] template status", { wabaId, name: value.message_template_name, event: value.event, reason: value.reason });
          continue;
        }

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
