// Pure helpers — mirror the SaaS (src/lib/qrcode.ts) so the extension behaves
// identically to the portal. No network, no DOM. Safe to import anywhere.

// Keep the leading '+' if present, strip everything else. WhatsApp click-to-chat
// wants a country-coded number with no '+', spaces, or dashes.
export function normalizePhone(raw) {
  const s = String(raw ?? "").trim();
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  return { digits, e164: plus ? `+${digits}` : digits };
}

// A lenient international-phone matcher for pulling a number out of highlighted
// text. Wants 8–15 digits, optional leading '+', spaces/dashes/parens allowed.
const PHONE_RE = /\+?\d[\d\s().-]{7,16}\d/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// Best-effort parse of a free-text selection into {name, phone, email}.
// Human-in-the-loop: we only ever propose — the user confirms before sending.
export function parseSelection(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  const email = raw.match(EMAIL_RE)?.[0] ?? "";
  const phoneMatch = raw.match(PHONE_RE)?.[0] ?? "";
  const phone = phoneMatch ? normalizePhone(phoneMatch).digits : "";
  // Name guess: the first line / chunk with letters that isn't the email or phone.
  let name = "";
  for (const piece of raw.split(/[\n,|·•]| - /)) {
    const p = piece.trim();
    if (!p || p === email) continue;
    const letters = p.replace(/[^a-zA-ZÀ-ɏ]/g, "");
    if (letters.length >= 2 && letters.length / p.length > 0.5 && !PHONE_RE.test(p)) {
      name = p.length > 60 ? p.slice(0, 60) : p;
      break;
    }
  }
  return { name, phone, email };
}

// wa.me click-to-chat link with an optional prefilled message. Human clicks it
// to open a chat — this is not automated sending.
export function waClickToChatUrl(phone, text) {
  const { digits } = normalizePhone(phone);
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}

// A QR is just an <img src>. Uses the same free no-auth service the portal uses.
export function qrImageUrl(data, size = 240) {
  const s = Math.max(80, Math.min(1000, Math.round(size)));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&margin=8&data=${encodeURIComponent(data)}`;
}

// Turn a hostname into a short, tag-safe source label, e.g. "in.linkedin.com" → "linkedin".
export function sourceLabel(hostname) {
  const h = String(hostname ?? "").toLowerCase().replace(/^www\./, "");
  const known = ["linkedin", "instagram", "facebook", "twitter", "x.com", "youtube", "maps.google", "google"];
  const hit = known.find(k => h.includes(k.replace(".com", "")));
  if (hit) return hit.replace("maps.google", "google-maps").replace("x.com", "twitter");
  const core = h.split(".").slice(-2, -1)[0] || h;
  return core;
}
