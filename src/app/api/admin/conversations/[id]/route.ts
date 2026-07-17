export const maxDuration = 60;   // the "suggest" action runs an LLM call — must outlast the default
import { NextResponse } from "next/server";
import {
  getConversation, getConvHistory, appendConvMessage, touchOutbound,
  setConversationStatus, setBotEnabled, setConvLabels, assignConversation,
  setConversationAgent, markConversationRead, getContactByPhone, type ConvStatus,
} from "@/lib/store";
import { generateReply } from "@/lib/llm";
import { sendText, sendButtons, sendTemplateSingle, sendMedia } from "@/lib/whatsapp";
import { sendIgMessage, sendIgQuickReplies, sendIgMedia } from "@/lib/instagram";
import { sendFbMessage, sendFbQuickReplies, sendFbMedia } from "@/lib/messenger";
import { credsFor, getChannel, explicitDefaultChannel, effectiveAgentId, effectiveKbTag } from "@/lib/channels";
import { pushWaActivity, pushIgActivity, phoneFromAttributes, getLeadIdByPhone, updateLeadStage } from "@/lib/leadsquared";
import { getCannedTemplates, resolveCannedParams } from "@/lib/canned";
import { currentUser, currentTenantId, DEFAULT_TENANT_ID } from "@/lib/auth";
import { supportDeskTenantId } from "@/lib/supportdesk";
import { logActivity } from "@/lib/team";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// ?desk=support → operate on the support workspace (owner sessions only hop;
// everyone else resolves to their own session tenant regardless of the flag).
function deskTenant(req: Request): Promise<string | null> {
  return new URL(req.url).searchParams.get("desk") === "support" ? supportDeskTenantId() : currentTenantId();
}

// GET — one conversation + its full message thread.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const tid = await deskTenant(req);
    if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const conversation = await getConversation(id, tid);
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const messages = await getConvHistory(id, 200, tid);
    // Opening the chat marks it read (clears the "awaiting your reply" flag).
    if (conversation.needsReply) { await markConversationRead(id); conversation.needsReply = false; }
    return NextResponse.json({ conversation, messages });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

// POST — agent actions on a conversation.
//   { action: "reply", body, buttons? }  → manual reply; ≤3 quick-reply buttons optional
//   { action: "status", status }         → active | paused | escalated
//   { action: "bot", enabled }           → toggle the per-conversation bot
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { action?: string; body?: string; buttons?: string[]; status?: ConvStatus; enabled?: boolean; labels?: string[]; assignedTo?: string | null; agentId?: string | null; templateName?: string; languageCode?: string; bodyParams?: string[]; preview?: string; url?: string; kind?: "image" | "video" | "document"; mediaType?: string; caption?: string; cannedId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const tid = await deskTenant(req);
  if (!tid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const conv = await getConversation(id, tid);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // Agent-assist: draft a KB-grounded reply for the agent to review/edit — NOT
    // sent. Same pipeline the live bot uses (RAG + persona), so the suggestion
    // reflects exactly what the bot would say. Returns "" when there's nothing
    // grounded to offer (the UI then tells the agent to type their own).
    if (body.action === "suggest") {
      const history = await getConvHistory(id, 20, tid);
      // Same resolution as the live bot (conversation pin → channel default →
      // tenant-global) so the draft matches what the bot itself would have said.
      const suggestCh = conv.channelId ? await getChannel(conv.channelId, tid) : null;
      const r = await generateReply(history.map(h => ({ role: h.role, body: h.body, mediaUrl: h.mediaUrl, mediaType: h.mediaType })), conv.phone, effectiveAgentId(conv, suggestCh), tid, effectiveKbTag(conv, suggestCh));
      return NextResponse.json({ suggestion: r.reply ?? "", escalate: r.escalate });
    }
    if (body.action === "reply") {
      const text = (body.body ?? "").trim();
      if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });
      const buttons = (body.buttons ?? []).map(b => b.trim()).filter(Boolean).slice(0, 3);
      const logged = buttons.length > 0 ? `${text}\n[buttons: ${buttons.join(" | ")}]` : text;

      // Route by platform — an Instagram chat MUST go out via the IG API, not
      // WhatsApp (otherwise the message is logged but never reaches the user).
      let messageId: string | undefined;
      if (conv.platform === "instagram") {
        const ch = conv.channelId ? await getChannel(conv.channelId, tid) : null;
        if (!ch?.igUserId || !ch?.token) return NextResponse.json({ error: "Instagram account not connected for this chat" }, { status: 502 });
        const creds = { igUserId: ch.igUserId, token: ch.token };
        const sent = buttons.length > 0
          ? await sendIgQuickReplies(creds, conv.phone, text, buttons.map((title, i) => ({ title, payload: `btn_${i + 1}` })), { lastInboundAt: conv.lastInboundAt })
          : await sendIgMessage(creds, conv.phone, text, { lastInboundAt: conv.lastInboundAt });
        if (!sent.ok) return NextResponse.json({ error: sent.error || (sent.blockedBy === "window" ? "Outside the 24-hour window — the user must message again first." : "Instagram send failed") }, { status: 502 });
        messageId = sent.messageId;
        // Mirror to LeadSquared by a known phone (shared in chat) or @handle.
        void (async () => {
          const handle = conv.name && conv.name.startsWith("@") ? conv.name : null;
          const phone = conv.leadPhone || phoneFromAttributes((await getContactByPhone(conv.phone, tid).catch(() => null))?.attributes);
          if (phone || handle) await pushIgActivity({ igUserId: conv.phone, handle, phone, direction: "outbound", body: logged, via: "agent", tenantId: tid });
        })();
      } else if (conv.platform === "messenger") {
        const ch = conv.channelId ? await getChannel(conv.channelId, tid) : null;
        if (!ch?.pageId || !ch?.token) return NextResponse.json({ error: "Facebook Page not connected for this chat" }, { status: 502 });
        const creds = { pageId: ch.pageId, token: ch.token };
        const sent = buttons.length > 0
          ? await sendFbQuickReplies(creds, conv.phone, text, buttons.map((title, i) => ({ title, payload: `btn_${i + 1}` })), { lastInboundAt: conv.lastInboundAt })
          : await sendFbMessage(creds, conv.phone, text, { lastInboundAt: conv.lastInboundAt });
        if (!sent.ok) return NextResponse.json({ error: sent.error || (sent.blockedBy === "window" ? "Outside the 24-hour window — the user must message again first." : "Messenger send failed") }, { status: 502 });
        messageId = sent.messageId;
      } else if (conv.platform === "webchat") {
        // Web-chat has no external API and no 24h window — the agent reply is just
        // persisted below and the visitor's widget picks it up on its next poll.
      } else {
        // WhatsApp free-form is only allowed inside Meta's 24-hour window. The
        // AI always replies instantly (in-window); an agent replying later can
        // fall outside it, so give a clear reason instead of a cryptic Meta error.
        if (conv.lastInboundAt && Date.now() - new Date(conv.lastInboundAt).getTime() > 24 * 60 * 60 * 1000) {
          return NextResponse.json({ error: "Outside WhatsApp's 24-hour window — the customer must message again before you can reply, or send an approved template." }, { status: 409 });
        }
        const channel = await credsFor(conv.channelId, tid);    // reply from the chat's own number
        const sent = buttons.length > 0
          ? await sendButtons(conv.phone, text, buttons.map((title, i) => ({ id: `btn_${i + 1}`, title })), channel)
          : await sendText(conv.phone, text, channel);
        if (sent.error) return NextResponse.json({ error: sent.error }, { status: 502 });
        messageId = sent.id;
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: logged, via: "agent", tenantId: tid });
      }
      await appendConvMessage({ conversationId: id, role: "assistant", body: logged, metaId: messageId, source: "agent", tenantId: tid, channelId: conv.channelId ?? null });
      await touchOutbound(id, logged);
      // A human has stepped in → pause the bot for this chat so it doesn't reply
      // over the agent. (Escalated chats now keep the bot on until this happens.)
      // The agent can re-enable any time with "Turn bot on".
      if (conv.botEnabled) await setBotEnabled(id, false);
      logActivity(await currentUser(), "inbox.reply", `to ${conv.phone}: ${text.slice(0, 80)}`);
      return NextResponse.json({ success: true, messageId });
    }
    if (body.action === "media") {
      // Agent sends a photo / video / file to the customer. The clip was already
      // uploaded to public storage (via /api/upload); we just relay the URL.
      const url = (body.url ?? "").trim();
      const kind = body.kind;
      if (!url || (kind !== "image" && kind !== "video" && kind !== "document")) {
        return NextResponse.json({ error: "url and a valid kind (image|video|document) are required" }, { status: 400 });
      }
      const caption = (body.caption ?? "").trim();
      const mediaType = (body.mediaType ?? "").trim() || (kind === "image" ? "image/*" : kind === "video" ? "video/*" : "application/octet-stream");
      const logged = caption || `[${kind}]`;

      let messageId: string | undefined;
      if (conv.platform === "instagram") {
        const ch = conv.channelId ? await getChannel(conv.channelId, tid) : null;
        if (!ch?.igUserId || !ch?.token) return NextResponse.json({ error: "Instagram account not connected for this chat" }, { status: 502 });
        if (kind === "document") return NextResponse.json({ error: "Instagram supports photos and videos only — paste the file link as a message instead." }, { status: 400 });
        const creds = { igUserId: ch.igUserId, token: ch.token };
        const sent = await sendIgMedia(creds, conv.phone, kind, url, { lastInboundAt: conv.lastInboundAt });
        if (!sent.ok) return NextResponse.json({ error: sent.error || (sent.blockedBy === "window" ? "Outside the 24-hour window — the user must message again first." : "Instagram send failed") }, { status: 502 });
        messageId = sent.messageId;
        if (caption) await sendIgMessage(creds, conv.phone, caption, { lastInboundAt: conv.lastInboundAt }).catch(() => undefined);
      } else if (conv.platform === "messenger") {
        const ch = conv.channelId ? await getChannel(conv.channelId, tid) : null;
        if (!ch?.pageId || !ch?.token) return NextResponse.json({ error: "Facebook Page not connected for this chat" }, { status: 502 });
        if (kind === "document") return NextResponse.json({ error: "Messenger supports photos and videos here — paste the file link as a message instead." }, { status: 400 });
        const creds = { pageId: ch.pageId, token: ch.token };
        const sent = await sendFbMedia(creds, conv.phone, kind, url, { lastInboundAt: conv.lastInboundAt });
        if (!sent.ok) return NextResponse.json({ error: sent.error || (sent.blockedBy === "window" ? "Outside the 24-hour window — the user must message again first." : "Messenger send failed") }, { status: 502 });
        messageId = sent.messageId;
        if (caption) await sendFbMessage(creds, conv.phone, caption, { lastInboundAt: conv.lastInboundAt }).catch(() => undefined);
      } else if (conv.platform === "webchat") {
        // Web-chat: the media URL is persisted below; the widget renders it on poll.
      } else {
        if (conv.lastInboundAt && Date.now() - new Date(conv.lastInboundAt).getTime() > 24 * 60 * 60 * 1000) {
          return NextResponse.json({ error: "Outside WhatsApp's 24-hour window — the customer must message again before you can send media." }, { status: 409 });
        }
        const channel = await credsFor(conv.channelId, tid);
        const sent = await sendMedia(conv.phone, kind, url, caption || undefined, channel);
        if (sent.error) return NextResponse.json({ error: sent.error }, { status: 502 });
        messageId = sent.id;
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: logged, via: "agent", tenantId: tid });
      }
      await appendConvMessage({ conversationId: id, role: "assistant", body: logged, metaId: messageId, source: "agent", tenantId: tid, channelId: conv.channelId ?? null, mediaUrl: url, mediaType });
      await touchOutbound(id, caption || `[${kind} sent]`);
      logActivity(await currentUser(), "inbox.media", `${kind} to ${conv.phone}`);
      return NextResponse.json({ success: true, messageId });
    }
    if (body.action === "template") {
      // Approved templates are the ONLY message type allowed OUTSIDE the 24h
      // window — the supported way to re-open a closed conversation. Meta bills
      // this as a business-initiated conversation. WhatsApp only (IG has none).
      if (conv.platform !== "whatsapp") return NextResponse.json({ error: "Templates are WhatsApp-only — on this channel the user must message again first." }, { status: 400 });
      const templateName = (body.templateName ?? "").trim();
      if (!templateName) return NextResponse.json({ error: "templateName required" }, { status: 400 });
      const languageCode = (body.languageCode ?? "en_US").trim() || "en_US";
      const bodyParams = (body.bodyParams ?? []).map(p => String(p ?? ""));
      const channel = await credsFor(conv.channelId, tid);
      const sent = await sendTemplateSingle(conv.phone, templateName, languageCode, bodyParams, channel);
      if (sent.error) return NextResponse.json({ error: sent.error }, { status: 502 });
      // Show the resolved text in the thread when the UI supplies a preview,
      // else fall back to the template name.
      const logged = (body.preview ?? "").trim() || `[template: ${templateName}]`;
      void pushWaActivity({ phone: conv.phone, direction: "outbound", body: logged, via: "agent", tenantId: tid });
      await appendConvMessage({ conversationId: id, role: "assistant", body: logged, metaId: sent.id, source: "agent", tenantId: tid, channelId: conv.channelId ?? null });
      await touchOutbound(id, logged);
      logActivity(await currentUser(), "inbox.template", `to ${conv.phone}: ${templateName}`);
      return NextResponse.json({ success: true, messageId: sent.id });
    }
    // One-click canned template (RNR, post-call follow-up…): resolves {tokens}
    // from the agent + contact, sends the approved template (24h-window safe),
    // logs to LSQ, and optionally moves the lead's stage. Config: Settings.
    if (body.action === "canned" && body.cannedId) {
      if (conv.platform !== "whatsapp") return NextResponse.json({ error: "Canned templates are WhatsApp-only." }, { status: 400 });
      const canned = (await getCannedTemplates(tid)).find(c => c.id === body.cannedId);
      if (!canned) return NextResponse.json({ error: "Canned template not found" }, { status: 404 });
      const user = await currentUser();
      const contact = await getContactByPhone(conv.phone, tid).catch(() => null);
      // Built-ins go LAST so a contact attribute literally named "name"/"agent"/
      // "counselor" can't shadow the documented tokens. `agent` is the current
      // token name; `counselor` is kept as an alias so templates saved before the
      // rename (this was originally an ed-tech-only product) keep resolving.
      const tokens = { ...(contact?.attributes ?? {}), agent: user?.name || "", counselor: user?.name || "", name: contact?.name || conv.name || "" };
      const params = resolveCannedParams(canned.params, tokens);
      // Meta rejects empty body params — fail with a message the sender can act
      // on instead of a cryptic Graph error.
      const emptyAt = params.findIndex(p => !p);
      if (emptyAt >= 0) {
        return NextResponse.json({ error: `"${canned.label}" can't send: {{${emptyAt + 1}}} is empty (configured as "${canned.params[emptyAt]}"). Fill that contact attribute or edit the canned template in Settings.` }, { status: 400 });
      }
      // Never fall through to the platform env number: a stale/null channel on a
      // tenant conversation resolves to the tenant's default channel or errors.
      let channel = await credsFor(conv.channelId, tid);
      if (!channel && tid !== DEFAULT_TENANT_ID) {
        channel = await credsFor(await explicitDefaultChannel(tid), tid);
        if (!channel) return NextResponse.json({ error: "No WhatsApp number available to send from — connect one in Settings." }, { status: 400 });
      }
      const sent = await sendTemplateSingle(conv.phone, canned.templateName, canned.language, params, channel, canned.headerImageUrl);
      if (sent.error) {
        void pushWaActivity({ phone: conv.phone, direction: "outbound", body: `⚠ "${canned.label}" template not sent: ${sent.error}`, via: "agent", tenantId: tid });
        return NextResponse.json({ error: sent.error }, { status: 502 });
      }
      const logged = `[${canned.label}]`;
      await appendConvMessage({ conversationId: id, role: "assistant", body: logged, metaId: sent.id, source: "agent", tenantId: tid, channelId: conv.channelId ?? null });
      await touchOutbound(id, logged);
      void pushWaActivity({ phone: conv.phone, direction: "outbound", body: `Sent "${canned.label}"`, via: "agent", tenantId: tid });
      // Stage change is best-effort but never silent: the response + audit log
      // say whether the CRM actually moved.
      let stageSet = false;
      if (canned.stage) {
        const leadId = await getLeadIdByPhone(conv.phone, tid).catch(() => null);
        if (leadId) stageSet = await updateLeadStage(leadId, canned.stage, tid).catch(() => false);
      }
      logActivity(user, "inbox.canned", `${canned.label} to ${conv.phone}${canned.stage ? ` · stage→${canned.stage}${stageSet ? "" : " (CRM update FAILED)"}` : ""}`);
      return NextResponse.json({ success: true, messageId: sent.id, ...(canned.stage ? { stageUpdated: stageSet } : {}) });
    }
    if (body.action === "status" && body.status) {
      await setConversationStatus(id, body.status);
      return NextResponse.json({ success: true });
    }
    if (body.action === "bot" && typeof body.enabled === "boolean") {
      await setBotEnabled(id, body.enabled);
      return NextResponse.json({ success: true });
    }
    if (body.action === "labels" && Array.isArray(body.labels)) {
      await setConvLabels(id, body.labels);
      return NextResponse.json({ success: true });
    }
    if (body.action === "assign") {
      await assignConversation(id, body.assignedTo ?? null);
      return NextResponse.json({ success: true });
    }
    if (body.action === "agent") {
      await setConversationAgent(id, body.agentId ?? null);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
