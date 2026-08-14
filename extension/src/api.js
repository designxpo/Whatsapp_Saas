// Thin client for Talko's public (ak_live_) API. The extension is ONLY ever a
// client of your own backend — it never talks to WhatsApp, LinkedIn, or any
// other platform directly. Every write lands in your portal with a record.
//
// Auth: a per-tenant `ak_live_…` key the tenant creates in Settings → API keys
// and pastes into the extension options. Fetches run from the service worker,
// where the manifest host_permission for the API origin bypasses CORS.

import { normalizePhone, sourceLabel } from "./wa.js";

export const DEFAULTS = Object.freeze({
  baseUrl: "https://app.thetalko.in",
  apiKey: "",
  defaultTags: ["extension"],
  attestConsent: false,          // only true if the user confirms the lead opted in
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
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 401) return { ok: false, status: 401, error: "Unauthorized — the API key is wrong or revoked." };
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
