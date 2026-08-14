// Channel metadata + human wording for the inbox. Pure (no DOM, no network) so
// the labels an agent reads are unit-tested — a mislabelled channel or a wrong
// "hours left" would push someone into sending the wrong kind of message.

// Labels match the portal's Live Chat exactly (Facebook, Web chat) so the same
// channel never has two names across the product. Short codes rather than icons:
// legible at badge size, read correctly to a screen reader, no borrowed logos.
export const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp", short: "WA" },
  { id: "instagram", label: "Instagram", short: "IG" },
  { id: "messenger", label: "Facebook", short: "FB" },
  { id: "webchat", label: "Web chat", short: "WEB" },
];

// The portal's status filters, same keys and wording.
export const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "needs_reply", label: "Needs reply" },
  { id: "escalated", label: "Escalated" },
  { id: "bot_off", label: "Human" },
];

const BY_ID = new Map(CHANNELS.map(c => [c.id, c]));

export function channelMeta(platform) {
  const id = String(platform ?? "whatsapp");
  return BY_ID.get(id) ?? { id, label: id.charAt(0).toUpperCase() + id.slice(1), short: id.slice(0, 3).toUpperCase() };
}

// Only WhatsApp can be replied to from the extension today (Cloud API). The rest
// are shown read-only, and the composer says so rather than failing on send.
export function isReplyable(platform) {
  return channelMeta(platform).id === "whatsapp";
}

/**
 * Compact age for a list row: "now", "6m", "3h", "2d", "1w".
 * @param {string | null | undefined} iso
 * @param {number} [nowMs]
 */
export function relativeTime(iso, nowMs = Date.now()) {
  if (!iso) return "";
  const s = Math.max(0, (nowMs - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / 604800)}w`;
}

/**
 * Plain-language state of WhatsApp's 24-hour customer-service window.
 *
 * "open"/"closed" means nothing to a shop owner, so this returns what they can
 * actually DO, plus how long they have left to do it.
 *
 * @param {{ platform?: string | null, windowOpen?: boolean, windowClosesAt?: string | null, lastInboundAt?: string | null }} [conv]
 * @param {number} [nowMs]
 * @returns {{ state: "open" | "closed" | "none" | "other", label: string, hint: string }}
 */
export function windowStatus({ platform = "whatsapp", windowOpen = false, windowClosesAt = null, lastInboundAt = null } = {}, nowMs = Date.now()) {
  if (!isReplyable(platform)) {
    const { label } = channelMeta(platform);
    // "Web chat" already ends in the noun — don't say "Web chat chat".
    const noun = /chat$/i.test(label) ? label : `${label} chat`;
    return { state: "other", label: noun, hint: `Reply to this ${noun} in the Talko portal.` };
  }
  if (!lastInboundAt) {
    return { state: "none", label: "Template needed", hint: "This contact hasn't messaged you, so only an approved template can start the chat." };
  }
  if (!windowOpen) {
    return { state: "closed", label: "Template needed", hint: "It's been over 24 hours since they messaged, so WhatsApp only allows an approved template." };
  }
  const msLeft = Math.max(0, new Date(windowClosesAt ?? new Date(lastInboundAt).getTime() + 24 * 3600 * 1000).getTime() - nowMs);
  const mins = Math.floor(msLeft / 60000);
  const left = mins >= 60 ? `${Math.floor(mins / 60)}h left` : mins >= 1 ? `${mins}m left` : "closing now";
  return { state: "open", label: `Can reply · ${left}`, hint: "You can send a normal message while this window is open." };
}
