// QR codes via the free, no-auth goqr.me API (api.qrserver.com), which returns a
// PNG directly — so a QR is just an <img src>, no backend call of our own.
// Non-PII (only the link you choose is encoded). Bring customers into chat from
// posters, packaging and receipts.

const QR_BASE = "https://api.qrserver.com/v1/create-qr-code/";

// A QR image URL encoding `data` at `size`×`size` px (clamped 80–1000). Returns
// "" for empty input so callers can render nothing.
export function qrImageUrl(data: string, size = 240): string {
  const d = (data || "").trim();
  if (!d) return "";
  const s = Math.min(1000, Math.max(80, Math.round(size) || 240));
  return `${QR_BASE}?size=${s}x${s}&margin=8&data=${encodeURIComponent(d)}`;
}

// A wa.me click-to-chat link (opens a WhatsApp chat with the number, optionally
// pre-filling `text`). "" when there aren't enough digits for a real number.
export function waClickToChatUrl(phone: string, text?: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  const q = text && text.trim() ? `?text=${encodeURIComponent(text.trim())}` : "";
  return `https://wa.me/${digits}${q}`;
}
