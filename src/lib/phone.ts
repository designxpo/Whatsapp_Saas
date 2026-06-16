// Lightweight phone validation/normalization. Not a full libphonenumber, but it
// rejects the common bad imports — local trunk-prefix numbers (leading 0), and
// too-short / too-long values — that otherwise get sent to Meta verbatim, spike
// #131026/#131047 undeliverable errors, and drag down the number's quality rating.
// E.164 allows up to 15 digits with a 1-3 digit country code.

export function toDigits(raw: string | null | undefined): string {
  return (raw || "").replace(/\D/g, "");
}

// Best-effort plausibility check for an E.164 number (already country-coded).
export function isLikelyValidE164(raw: string | null | undefined): boolean {
  let d = toDigits(raw);
  if (d.startsWith("00")) d = d.slice(2);     // strip 00 international prefix
  if (d.length < 8 || d.length > 15) return false;
  if (d.startsWith("0")) return false;        // leading 0 = national trunk prefix, never E.164
  return true;
}

// Normalize to bare E.164 digits, optionally prepending a default country code
// for local-format numbers. Returns null when the number can't be made valid.
export function normalizeE164(raw: string | null | undefined, defaultCountryCode?: string): string | null {
  let d = toDigits(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (defaultCountryCode && d.startsWith("0")) d = toDigits(defaultCountryCode) + d.replace(/^0+/, "");
  return isLikelyValidE164(d) ? d : null;
}
