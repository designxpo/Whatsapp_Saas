// India PIN code → city / district / state, via the free, no-auth India Post
// directory API (api.postalpincode.in). A postal code is NOT personal data, so
// this never sends customer PII to a third party. Every function is best-effort:
// any failure returns null / {} so an address-capture flow is never blocked.

export interface PincodeInfo {
  pincode: string;
  city: string;       // town/city — India Post's "District" (or the locality)
  district: string;
  state: string;
  locality: string;   // the specific post-office area — India Post's "Name"
}

const PIN_RE = /^\d{6}$/;
// Attribute keys that read like a postal-code field (native WhatsApp forms carry
// no field TYPE, so we also match by key + a 6-digit value).
const PIN_KEY_RE = /(?:^|_)(?:pin|pincode|pin_code|postal|postcode|post_code|zip|zipcode|zip_code)(?:$|_)/i;

// A plausible 6-digit Indian PIN. Format-only (deterministic) — the authoritative
// check is the lookup, which is best-effort.
export function isPincode(text: string): boolean {
  return PIN_RE.test((text || "").replace(/\s/g, ""));
}

// Should this answer trigger PIN autofill? True when the field is explicitly a
// "pincode" type/rule, or the attribute key reads like a postal-code field.
export function isPincodeField(typeOrRule: string | undefined, attrKey: string | undefined): boolean {
  if ((typeOrRule || "").toLowerCase() === "pincode") return true;
  return PIN_KEY_RE.test(attrKey || "");
}

// Look up a PIN. Returns null on a bad PIN, network error, timeout, or "not found".
export async function lookupPincode(pin: string): Promise<PincodeInfo | null> {
  const code = (pin || "").replace(/\D/g, "");
  if (!PIN_RE.test(code)) return null;
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${code}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = await r.json();
    const entry = Array.isArray(j) ? (j[0] as Record<string, unknown>) : null;
    const offices = entry?.Status === "Success" && Array.isArray(entry.PostOffice) ? (entry.PostOffice as Record<string, unknown>[]) : [];
    if (!offices.length) return null;
    const po = offices[0];
    const district = String(po.District ?? "").trim();
    const state = String(po.State ?? "").trim();
    const locality = String(po.Name ?? "").trim();
    return { pincode: code, city: district || locality, district, state, locality };
  } catch {
    return null;
  }
}

// The address attributes a PIN answer should fill in, WITHOUT clobbering values
// the flow already captured (an explicitly-answered city wins). Returns only the
// keys to add ({} on any failure).
export async function derivePincodeAttrs(
  current: Record<string, string> | undefined,
  pin: string,
): Promise<Record<string, string>> {
  const geo = await lookupPincode(pin);
  if (!geo) return {};
  const cur = current ?? {};
  const add: Record<string, string> = {};
  const setIfAbsent = (k: string, v: string) => { if (v && !String(cur[k] ?? "").trim()) add[k] = v; };
  setIfAbsent("city", geo.city);
  setIfAbsent("state", geo.state);
  setIfAbsent("district", geo.district);
  return add;
}

// Scan a bag of answered attributes for a postal-code field (key + 6-digit value)
// and return the PIN to enrich from, or null. Used where there's no field type
// (native WhatsApp form submissions).
export function findPincodeValue(attrs: Record<string, string> | undefined): string | null {
  if (!attrs) return null;
  for (const [k, v] of Object.entries(attrs)) {
    const val = String(v ?? "").replace(/\s/g, "");
    if (PIN_KEY_RE.test(k) && PIN_RE.test(val)) return val;
  }
  return null;
}
