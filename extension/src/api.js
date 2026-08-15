// Thin client for Talko's public (ak_live_) API. The extension is ONLY ever a
// client of your own backend — it never talks to WhatsApp, LinkedIn, or any
// other platform directly. Every write lands in your portal with a record.
//
// Auth: a per-tenant `ak_live_…` key the tenant creates in Settings → API keys
// and pastes into the extension options. Fetches run from the service worker,
// where the manifest host_permission for the API origin bypasses CORS.

import { normalizePhone, sourceLabel } from "./wa.js";
import { DEFAULT_THEME } from "./theme.js";
import { IMPORT_LIMIT } from "./scan.js";

export const DEFAULTS = Object.freeze({
  baseUrl: "https://app.thetalko.in",
  apiKey: "",
  defaultTags: ["extension"],
  attestConsent: false,          // only true if the user confirms the lead opted in
  theme: DEFAULT_THEME,          // "light" | "dark" | "system" — see theme.js
  defaultCc: "91",               // country code given to numbers written the local way
});

export async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s, baseUrl: String(s.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "") };
}

export async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
  return getSettings();
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const { baseUrl, apiKey } = await getSettings();
  if (!apiKey) return { ok: false, status: 0, error: "No API key set. Open the extension options and paste your ak_live_ key." };
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Network error: ${err?.message || err}. Check the base URL and your connection.` };
  }
  let data = {};
  // A missing route answers with Next's HTML 404, not JSON — so there's no
  // data.error to fall back on, which is how "Request failed (404)" happened.
  try { data = await res.json(); } catch { /* non-JSON (404/500 HTML page) */ }
  if (res.status === 401) return { ok: false, status: 401, error: "Unauthorized — the API key is wrong or revoked." };
  if (res.status === 404 && !data?.error) {
    return { ok: false, status: 404, error: "Your workspace doesn't have this feature yet — it needs the latest server update. Try again in a minute." };
  }
  if (res.status === 429) return { ok: false, status: 429, error: "Too many requests — wait a moment and try again." };
  if (res.status >= 500 && !data?.error) return { ok: false, status: res.status, error: "The workspace had a server error. Try again shortly." };
  if (!res.ok) return { ok: false, status: res.status, error: data?.error || `Request failed (${res.status})` };
  return { ok: true, status: res.status, data };
}

// Validate the key + learn which workspace it belongs to. Side-effect-free.
export function whoami() {
  return apiFetch("/api/whoami");
}

// Capture a lead → lands in Contacts, fires the 'contact_added' automation, and
// (best-effort) leaves a 'web_capture' event carrying the source URL so the
// portal has a full record of where the lead came from.
export async function addLead({ phone, name = "", email = "", tags = [], sourceUrl = "", consent = false }) {
  const { digits } = normalizePhone(phone);
  if (!digits || digits.length < 8) return { ok: false, status: 400, error: "That doesn't look like a valid phone number." };
  const { defaultTags, attestConsent } = await getSettings();

  let host = "";
  try { host = sourceUrl ? new URL(sourceUrl).hostname : ""; } catch { /* ignore */ }
  const allTags = Array.from(new Set([
    ...(defaultTags || []),
    "web-capture",
    ...(host ? [`source:${sourceLabel(host)}`] : []),
    ...tags,
  ].filter(Boolean)));

  const contactRes = await apiFetch("/api/contacts", {
    method: "POST",
    body: {
      contacts: [{ phone: digits, name: name.trim() || undefined, email: email.trim() || undefined, tags: allTags }],
      consent: consent || attestConsent,
    },
  });
  if (!contactRes.ok) return contactRes;

  // Record where it came from (non-fatal if it fails — the contact is already saved).
  await apiFetch("/api/events", {
    method: "POST",
    body: { event: "web_capture", phone: digits, name: name.trim() || undefined, data: { source_url: sourceUrl, via: "extension", tags: allTags } },
  }).catch(() => undefined);

  return { ok: true, status: contactRes.status, data: { ...contactRes.data, tags: allTags } };
}

// Add several reviewed contacts at once — the "Scan page" import. The tenant has
// already ticked each row in the popup, so this is a plain bulk upsert.
//
// Unlike addLead it does NOT write a per-contact 'web_capture' event: that would
// be one extra API round trip per row, and the source is already recorded on the
// contact itself by the `page-scan` and `source:…` tags.
export async function addLeads({ contacts = [], sourceUrl = "", consent = false } = {}) {
  const { defaultTags, attestConsent } = await getSettings();

  let host = "";
  try { host = sourceUrl ? new URL(sourceUrl).hostname : ""; } catch { /* ignore */ }
  const tags = Array.from(new Set([
    ...(defaultTags || []),
    "web-capture",
    "page-scan",
    ...(host ? [`source:${sourceLabel(host)}`] : []),
  ].filter(Boolean)));

  const rows = contacts
    .map((c) => ({
      phone: normalizePhone(c?.phone).digits,
      name: String(c?.name ?? "").trim() || undefined,
      email: String(c?.email ?? "").trim() || undefined,
      tags,
    }))
    .filter((c) => c.phone.length >= 8)
    .slice(0, IMPORT_LIMIT);

  if (!rows.length) return { ok: false, status: 400, error: "Tick at least one contact with a phone number." };

  const res = await apiFetch("/api/contacts", {
    method: "POST",
    body: { contacts: rows, consent: consent || attestConsent },
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: { ...res.data, tags, count: rows.length } };
}

// ── Phase 2: inbox side-panel ────────────────────────────────────────────────

// Conversations for the side-panel list, using the portal's Live Chat filters.
// view: "chats" | "comments" · platform: whatsapp|instagram|messenger|webchat
// status: all|needs_reply|escalated|bot_off · q: search by name/number/handle.
export function listInbox({ limit = 50, view = "chats", platform = null, status = "all", q = "" } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    view,
    status,
    ...(platform ? { platform } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  });
  return apiFetch(`/api/inbox?${params}`);
}

// Non-sending thread controls, as in the portal: hand to a human, or escalate.
export function setBot({ conversationId, enabled }) {
  return apiFetch("/api/inbox/actions", { method: "POST", body: { conversationId, action: "bot", enabled } });
}
export function setStatus({ conversationId, status }) {
  return apiFetch("/api/inbox/actions", { method: "POST", body: { conversationId, action: "status", status } });
}

// The tenant's saved canned replies.
export function listQuickReplies() {
  return apiFetch("/api/inbox/quick-replies");
}

// ── Who am I talking to: context + CRM edits ────────────────────────────────

// Contact, order history and pipeline stage behind a conversation.
export function getContactContext({ conversationId, phone } = {}) {
  const q = new URLSearchParams(conversationId ? { conversationId } : { phone: phone || "" });
  return apiFetch(`/api/inbox/contact?${q}`);
}

const contactAction = (payload) => apiFetch("/api/inbox/contact", { method: "POST", body: payload });
export const setContactTags = ({ conversationId, phone, tags }) => contactAction({ conversationId, phone, action: "tags", tags });
export const setContactNote = ({ conversationId, phone, note }) => contactAction({ conversationId, phone, action: "note", note });
export const setContactStage = ({ conversationId, phone, stageId }) => contactAction({ conversationId, phone, action: "stage", stageId });

// Search the whole contact book — including people with no chat open yet.
export function searchContacts({ q = "", limit = 20 } = {}) {
  return apiFetch(`/api/inbox/contacts?${new URLSearchParams({ q, limit: String(limit) })}`);
}

// ── Sell in the chat ────────────────────────────────────────────────────────

// Catalog (optionally filtered) plus this chat's open cart.
export function listCatalog({ q = "", conversationId, phone } = {}) {
  const params = new URLSearchParams({ ...(q ? { q } : {}), ...(conversationId ? { conversationId } : {}), ...(phone ? { phone } : {}) });
  return apiFetch(`/api/inbox/commerce?${params}`);
}

// Replace the chat's cart with these lines (prices come from the catalog server-side).
export function setCart({ conversationId, phone, items }) {
  return apiFetch("/api/inbox/commerce", { method: "POST", body: { conversationId, phone, action: "cart", items } });
}

// Turn the open cart into an order + payment link. The panel then sends the link
// as a normal message, so every send stays on one audited path.
export function checkout({ conversationId, phone }) {
  return apiFetch("/api/inbox/commerce", { method: "POST", body: { conversationId, phone, action: "checkout" } });
}

// One thread's messages + 24h-window state.
export function getThread({ conversationId, phone } = {}) {
  const q = new URLSearchParams(conversationId ? { conversationId } : { phone: phone || "" });
  return apiFetch(`/api/inbox/thread?${q}`);
}

// Send a WhatsApp reply (free-form inside 24h, else an approved template).
export function sendReply(payload) {
  return apiFetch("/api/inbox/reply", { method: "POST", body: payload });
}

// AI-drafted reply for a thread (never auto-sent — the agent reviews it).
export function suggestReply({ conversationId, phone } = {}) {
  return apiFetch("/api/inbox/suggest", { method: "POST", body: { conversationId, phone } });
}

// Approved templates for a thread's number (to answer once the 24h window closed).
export function listTemplates({ conversationId } = {}) {
  const q = new URLSearchParams(conversationId ? { conversationId } : {});
  return apiFetch(`/api/inbox/templates?${q}`);
}

// ── Phase 2: overlay draft (Google Business / YouTube) ───────────────────────

// Draft a short public reply to a review or comment. Grounded only in `text`.
export function draftReply({ text, kind = "review", author, rating } = {}) {
  return apiFetch("/api/assist/draft", { method: "POST", body: { text, kind, author, rating } });
}

// ── Find leads (page signal scan) ────────────────────────────────────────────

// Draft a short private-DM opener for a flagged signal. Grounded only in
// `text` — never a pitch, never auto-sent. The tenant copies it themselves.
export function draftOutreach({ text, author, platform, category } = {}) {
  return apiFetch("/api/assist/outreach", { method: "POST", body: { text, author, platform, category } });
}
