import { insertLog, optoutSet } from "./store";
import { getTrackedUrls, mintLinks } from "./links";
import type { ChannelCreds } from "./channels";

const GRAPH = "https://graph.facebook.com/v22.0";
const MSG_DELAY_MS = 100;   // ~10 msg/s
const BATCH_SIZE = 30;
const BATCH_PAUSE_MS = 3000;

// Channel creds when provided (multi-number mode), else the env single-number setup.
export function getCreds(channel?: ChannelCreds) {
  if (channel?.token && channel?.phoneId) {
    return { token: channel.token, phoneId: channel.phoneId, wabaId: channel.wabaId, appId: channel.appId ?? process.env.META_WA_APP_ID };
  }
  return {
    token: process.env.META_WA_ACCESS_TOKEN,
    phoneId: process.env.META_WA_PHONE_NUMBER_ID,
    wabaId: process.env.META_WA_WABA_ID,
    appId: process.env.META_WA_APP_ID,
  };
}

const last10 = (p: string) => (p || "").replace(/\D/g, "").slice(-10);
const firstName = (n: string) => (n || "").trim().split(/\s+/)[0] || "";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface SendResult { sentCount: number; failedCount: number; skippedCount: number; errors: string[] }

// Sends a template to a batch of recipients, logging each to wa_send_log.
// Skips opted-out numbers. Returns aggregate counts.
export async function sendCampaign(params: {
  campaignId: string;
  templateName: string;
  languageCode: string;
  variables: string[];
  recipients: { phone: string; fullName: string }[];
  headerImageUrl?: string | null;
  channel?: ChannelCreds;
  tenantId?: string;
}): Promise<SendResult> {
  const { token, phoneId } = getCreds(params.channel);
  if (!token || !phoneId) return { sentCount: 0, failedCount: params.recipients.length, skippedCount: 0, errors: ["WhatsApp credentials not configured"] };

  const optouts = await optoutSet(params.tenantId);
  const errors: string[] = [];
  let sentCount = 0, failedCount = 0, skippedCount = 0, consecutiveErrors = 0;
  const log: Parameters<typeof insertLog>[0] = [];

  // Click tracking: templates submitted with "Enable click tracking" have their
  // URL buttons pointing at {SITE}/r/{{1}} — each recipient gets a unique code.
  const trackedUrls = await getTrackedUrls(params.templateName, params.tenantId).catch(() => []);

  for (let i = 0; i < params.recipients.length; i++) {
    const r = params.recipients[i];
    const digitsPhone = (r.phone || "").replace(/\D/g, "");
    if (optouts.has(last10(r.phone))) {
      skippedCount++;
      log.push({ campaignId: params.campaignId, phone: digitsPhone, recipientName: r.fullName, status: "skipped", errorDetail: "opted out" });
      continue;
    }

    // Substitute {name} per recipient.
    const vars = params.variables.map(v => v.replace(/\{name\}/gi, firstName(r.fullName)));
    const components: unknown[] = [];
    if (params.headerImageUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: params.headerImageUrl } }] });
    if (vars.length) components.push({ type: "body", parameters: vars.map(t => ({ type: "text", text: t })) });
    if (trackedUrls.length) {
      // The template's URL button is dynamic ({SITE}/r/{{1}}), so Meta requires a
      // parameter either way — fall back to "0" (redirects to the site home) if
      // minting fails so the send still goes through.
      const codes = await mintLinks({ campaignId: params.campaignId, phone: digitsPhone, tracked: trackedUrls, tenantId: params.tenantId })
        .catch(() => trackedUrls.map(t => ({ index: t.index, code: "0" })));
      for (const c of codes) {
        components.push({ type: "button", sub_type: "url", index: String(c.index), parameters: [{ type: "text", text: c.code }] });
      }
    }

    try {
      const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: digitsPhone,
          type: "template",
          template: { name: params.templateName, language: { code: params.languageCode }, ...(components.length ? { components } : {}) },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.messages?.[0]?.id) {
        sentCount++; consecutiveErrors = 0;
        log.push({ campaignId: params.campaignId, phone: digitsPhone, recipientName: r.fullName, status: "sent", metaMessageId: data.messages[0].id });
      } else {
        failedCount++; consecutiveErrors++;
        const msg = data?.error?.message || `HTTP ${res.status}`;
        if (errors.length < 5) errors.push(msg);
        log.push({ campaignId: params.campaignId, phone: digitsPhone, recipientName: r.fullName, status: "failed", errorDetail: msg });
      }
    } catch (err) {
      failedCount++; consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      if (errors.length < 5) errors.push(msg);
      log.push({ campaignId: params.campaignId, phone: digitsPhone, recipientName: r.fullName, status: "failed", errorDetail: msg });
    }

    // Abort early if Meta is rejecting everything (bad token/template).
    if (consecutiveErrors >= 5) { errors.push("Aborted after 5 consecutive failures"); break; }

    await sleep(MSG_DELAY_MS);
    if ((i + 1) % BATCH_SIZE === 0) await sleep(BATCH_PAUSE_MS);
  }

  await insertLog(log, params.tenantId).catch(() => undefined);
  return { sentCount, failedCount, skippedCount, errors };
}

// One-off test send to any number — renders exactly like a campaign send
// ({name} substitution, header image, click-tracking button params) but creates
// no campaign, contact, or send-log row. Tracked URL buttons get code "0"
// (redirects to the site home) since there is no campaign to mint links for.
export async function sendTemplateTest(params: {
  phone: string;
  name?: string;
  templateName: string;
  languageCode: string;
  variables: string[];
  headerImageUrl?: string | null;
  channel?: ChannelCreds;
  tenantId?: string;
}): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(params.channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  const vars = params.variables.map(v => v.replace(/\{name\}/gi, firstName(params.name ?? "") || "there"));
  const components: unknown[] = [];
  if (params.headerImageUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: params.headerImageUrl } }] });
  if (vars.length) components.push({ type: "body", parameters: vars.map(t => ({ type: "text", text: t })) });
  const trackedUrls = await getTrackedUrls(params.templateName, params.tenantId).catch(() => []);
  for (const t of trackedUrls) {
    components.push({ type: "button", sub_type: "url", index: String(t.index), parameters: [{ type: "text", text: "0" }] });
  }
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: (params.phone || "").replace(/\D/g, ""),
        type: "template",
        template: { name: params.templateName, language: { code: params.languageCode }, ...(components.length ? { components } : {}) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends a free-form text message. Only valid within the 24h customer-service
// window (i.e. in reply to a recent inbound message). Returns the Meta message id.
export async function sendText(phone: string, body: string, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  if (!body.trim()) return { error: "Empty message body" };
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: (phone || "").replace(/\D/g, ""),
        type: "text",
        text: { body: body.slice(0, 4096), preview_url: true },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends a single product card from the WABA's connected catalog (Meta Commerce
// Manager). Free-form, 24h-window rules apply.
export async function sendProduct(phone: string, body: string, catalogId: string, productRetailerId: string, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  return sendInteractive(phone, {
    type: "product",
    body: { text: body.slice(0, 1024) },
    action: { catalog_id: catalogId, product_retailer_id: productRetailerId },
  }, channel);
}

// Sends a multi-product list (≤30 products across ≤10 sections) from the catalog.
export async function sendProductList(phone: string, header: string, body: string, catalogId: string, sections: { title: string; productRetailerIds: string[] }[], channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  return sendInteractive(phone, {
    type: "product_list",
    header: { type: "text", text: header.slice(0, 60) },
    body: { text: body.slice(0, 1024) },
    action: {
      catalog_id: catalogId,
      sections: sections.slice(0, 10).map(s => ({ title: s.title.slice(0, 24), product_items: s.productRetailerIds.slice(0, 30).map(id => ({ product_retailer_id: id })) })),
    },
  }, channel);
}

// Shared sender for interactive payloads (product/product_list).
async function sendInteractive(phone: string, interactive: Record<string, unknown>, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: (phone || "").replace(/\D/g, ""), type: "interactive", interactive }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends one approved template to one recipient — the only message type allowed
// outside the 24h customer-service window. bodyParams fill {{1}}..{{n}} in order.
export async function sendTemplateSingle(phone: string, templateName: string, languageCode: string, bodyParams: string[] = [], channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  const components = bodyParams.length
    ? [{ type: "body", parameters: bodyParams.map(t => ({ type: "text", text: t })) }]
    : [];
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: (phone || "").replace(/\D/g, ""),
        type: "template",
        template: { name: templateName, language: { code: languageCode }, ...(components.length ? { components } : {}) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends a media message (image/video/document/audio) by public URL. Free-form,
// so 24h-window rules apply just like sendText.
export async function sendMedia(phone: string, kind: "image" | "video" | "document" | "audio", url: string, caption?: string, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  const media: Record<string, unknown> = { link: url };
  if (caption && (kind === "image" || kind === "video" || kind === "document")) media.caption = caption;
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: (phone || "").replace(/\D/g, ""), type: kind, [kind]: media }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends a message with a tappable URL button (interactive cta_url). Free-form,
// 24h-window rules apply — used when an AI answer references a link.
export async function sendCtaUrl(phone: string, body: string, buttonText: string, url: string, channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  return sendInteractive(phone, {
    type: "cta_url",
    body: { text: body.slice(0, 1024) },
    action: { name: "cta_url", parameters: { display_text: buttonText.slice(0, 20) || "View details", url } },
  }, channel);
}

// Sends an interactive quick-reply button message (max 3 buttons, titles ≤20 chars).
// Free-form → 24h-window rules apply.
export async function sendButtons(phone: string, body: string, buttons: { id: string; title: string }[], channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  const btns = buttons.filter(b => b.title.trim()).slice(0, 3);
  if (!body.trim() || btns.length === 0) return { error: "Body and at least one button required" };
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: (phone || "").replace(/\D/g, ""),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body.slice(0, 1024) },
          action: { buttons: btns.map(b => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends an interactive list message (≤10 rows across all sections).
export async function sendList(phone: string, body: string, buttonText: string, sections: { title: string; rows: { id: string; title: string; description?: string }[] }[], channel?: ChannelCreds): Promise<{ id?: string; error?: string }> {
  const { token, phoneId } = getCreds(channel);
  if (!token || !phoneId) return { error: "WhatsApp credentials not configured" };
  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: (phone || "").replace(/\D/g, ""),
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: body.slice(0, 1024) },
          action: {
            button: buttonText.slice(0, 20),
            sections: sections.map(s => ({
              title: s.title.slice(0, 24),
              rows: s.rows.map(r => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })),
            })),
          },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.messages?.[0]?.id) return { id: data.messages[0].id as string };
    return { error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Template management ───────────────────────────────────────────────────────

// Sample media for template submissions must go through Meta's *resumable
// upload* API (scoped to the App, not the WABA) — the returned `h:…` handle is
// what message_templates accepts as the header example. A plain URL won't do.
export async function uploadSampleMedia(file: { bytes: ArrayBuffer; mime: string }, channel?: ChannelCreds): Promise<{ handle?: string; error?: string }> {
  const { token, appId } = getCreds(channel);
  if (!token) return { error: "Missing META_WA_ACCESS_TOKEN" };
  if (!appId) return { error: "Missing META_WA_APP_ID — the Meta App ID is required to upload template sample media" };
  try {
    const start = await fetch(`${GRAPH}/${appId}/uploads?file_length=${file.bytes.byteLength}&file_type=${encodeURIComponent(file.mime)}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}` },
    });
    const session = await start.json().catch(() => ({}));
    if (!start.ok || !session?.id) return { error: session?.error?.message || `Upload session failed (HTTP ${start.status})` };
    const up = await fetch(`${GRAPH}/${session.id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
      body: file.bytes,
    });
    const data = await up.json().catch(() => ({}));
    if (!up.ok || !data?.h) return { error: data?.error?.message || `Upload failed (HTTP ${up.status})` };
    return { handle: data.h as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string; example?: string }   // example required when url has a {{1}} suffix
  | { type: "PHONE_NUMBER"; text: string; phoneNumber: string }
  | { type: "COPY_CODE"; example: string };

export interface CarouselCardInput {
  headerFormat: "IMAGE" | "VIDEO";
  headerHandle: string;         // from uploadSampleMedia
  bodyText: string;
  buttons: TemplateButton[];    // Meta requires 1–2 per card, same set on every card
}

export type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export interface CreateTemplateInput {
  name: string;                 // lowercase letters, digits, underscores
  language: string;             // e.g. en_US
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  headerType?: HeaderType;
  headerText?: string;          // TEXT header — may contain one {{1}}
  headerExample?: string;       // sample value when headerText has {{1}}
  headerHandle?: string;        // IMAGE/VIDEO/DOCUMENT header — from uploadSampleMedia
  bodyText: string;             // may contain {{1}}, {{2}}, …
  footerText?: string;
  exampleValues?: string[];     // required by Meta when bodyText has variables
  buttons?: TemplateButton[];   // up to 10; max 2 URL, 1 phone
  carouselCards?: CarouselCardInput[]; // 2–10 cards → CAROUSEL template
}

function buttonPayload(b: TemplateButton): Record<string, unknown> {
  switch (b.type) {
    case "QUICK_REPLY": return { type: "QUICK_REPLY", text: b.text.slice(0, 25) };
    case "URL": return {
      type: "URL", text: b.text.slice(0, 25), url: b.url,
      ...(/\{\{1\}\}/.test(b.url) && b.example ? { example: [b.example] } : {}),
    };
    case "PHONE_NUMBER": return { type: "PHONE_NUMBER", text: b.text.slice(0, 25), phone_number: b.phoneNumber };
    case "COPY_CODE": return { type: "COPY_CODE", example: b.example.slice(0, 15) };
  }
}

// Assembles the components array exactly as Meta's message_templates endpoint
// expects: HEADER → BODY → FOOTER → BUTTONS, or BODY + CAROUSEL for carousels.
function buildTemplateComponents(input: CreateTemplateInput): { components?: Record<string, unknown>[]; error?: string } {
  const components: Record<string, unknown>[] = [];

  if (input.carouselCards?.length) {
    if (input.carouselCards.length < 2 || input.carouselCards.length > 10) return { error: "Carousel needs 2–10 cards" };
    const hasVars = /\{\{\d+\}\}/.test(input.bodyText);
    components.push({
      type: "BODY", text: input.bodyText,
      ...(hasVars && input.exampleValues?.length ? { example: { body_text: [input.exampleValues] } } : {}),
    });
    const cards = [];
    for (const card of input.carouselCards) {
      if (!card.headerHandle) return { error: "Every carousel card needs an uploaded image/video" };
      if (!card.bodyText.trim()) return { error: "Every carousel card needs body text" };
      if (!card.buttons.length || card.buttons.length > 2) return { error: "Every carousel card needs 1–2 buttons" };
      cards.push({
        components: [
          { type: "HEADER", format: card.headerFormat, example: { header_handle: [card.headerHandle] } },
          { type: "BODY", text: card.bodyText.slice(0, 160) },
          { type: "BUTTONS", buttons: card.buttons.map(buttonPayload) },
        ],
      });
    }
    components.push({ type: "CAROUSEL", cards });
    return { components };
  }

  const headerType = input.headerType ?? "NONE";
  if (headerType === "TEXT") {
    if (!input.headerText?.trim()) return { error: "Header text is required for a text header" };
    const headerHasVar = /\{\{1\}\}/.test(input.headerText);
    components.push({
      type: "HEADER", format: "TEXT", text: input.headerText.trim().slice(0, 60),
      ...(headerHasVar ? { example: { header_text: [input.headerExample || "example"] } } : {}),
    });
  } else if (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") {
    if (!input.headerHandle) return { error: `Upload a sample ${headerType.toLowerCase()} for the header first` };
    components.push({ type: "HEADER", format: headerType, example: { header_handle: [input.headerHandle] } });
  }

  const hasVars = /\{\{\d+\}\}/.test(input.bodyText);
  components.push({
    type: "BODY", text: input.bodyText,
    ...(hasVars && input.exampleValues?.length ? { example: { body_text: [input.exampleValues] } } : {}),
  });
  if (input.footerText?.trim()) components.push({ type: "FOOTER", text: input.footerText.trim().slice(0, 60) });

  if (input.buttons?.length) {
    if (input.buttons.length > 10) return { error: "At most 10 buttons" };
    if (input.buttons.filter(b => b.type === "URL").length > 2) return { error: "At most 2 URL buttons" };
    if (input.buttons.filter(b => b.type === "PHONE_NUMBER").length > 1) return { error: "At most 1 phone button" };
    components.push({ type: "BUTTONS", buttons: input.buttons.map(buttonPayload) });
  }
  return { components };
}

// Submits a new template to Meta for approval. Status starts as PENDING.
export async function createTemplate(input: CreateTemplateInput, channel?: ChannelCreds): Promise<{ id?: string; status?: string; error?: string }> {
  const { token, wabaId } = getCreds(channel);
  if (!token || !wabaId) return { error: "Missing META_WA_ACCESS_TOKEN / META_WA_WABA_ID" };
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) return { error: "Template name must be lowercase letters, digits, underscores" };
  const built = buildTemplateComponents(input);
  if (built.error || !built.components) return { error: built.error ?? "Invalid template" };
  const components = built.components;
  try {
    const res = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name, language: input.language, category: input.category, components }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { id: data.id as string, status: (data.status as string) ?? "PENDING" };
    return { error: data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Deletes a template by name (removes all language versions of that name).
export async function deleteTemplate(name: string, channel?: ChannelCreds): Promise<{ success: boolean; error?: string }> {
  const { token, wabaId } = getCreds(channel);
  if (!token || !wabaId) return { success: false, error: "Missing META_WA_ACCESS_TOKEN / META_WA_WABA_ID" };
  try {
    const res = await fetch(`${GRAPH}/${wabaId}/message_templates?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.success !== false) return { success: true };
    return { success: false, error: data?.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface WaTemplate {
  id?: string;
  name: string;
  status: string;               // APPROVED | PENDING | REJECTED | PAUSED | DISABLED | IN_APPEAL
  language: string;
  category: string;
  rejected_reason?: string | null;
  components: { type: string; format?: string; text?: string; buttons?: { type: string; text?: string }[]; cards?: unknown[] }[];
}

export async function fetchTemplates(channel?: ChannelCreds): Promise<WaTemplate[]> {
  const { token, wabaId } = getCreds(channel);
  if (!token || !wabaId) throw new Error("Missing META_WA_ACCESS_TOKEN / META_WA_WABA_ID");
  const res = await fetch(`${GRAPH}/${wabaId}/message_templates?fields=id,name,status,language,category,components,rejected_reason&limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  return (data.data ?? []) as WaTemplate[];
}
