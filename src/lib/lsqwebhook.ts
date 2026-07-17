// LeadSquared → portal webhook parsing. LSQ Automations post JSON whose shape
// depends on how the webhook action was configured: a custom mail-merge body
// (recommended — see docs/lsq-webhooks.md), LSQ's standard flat lead JSON, or
// an update shape nested under Before/After/Current. This normalizes all of
// them into one event the route can act on. Pure + unit-tested.

export interface LsqEvent {
  event: "lead_created" | "owner_changed" | "stage_changed" | "unknown";
  phone: string | null;        // digits only, ≥10
  name: string | null;
  email: string | null;        // the LEAD's email (never the owner's)
  ownerEmail: string | null;   // counselor to assign, matched to wa_users.email
  ownerName: string | null;
  stage: string | null;
  leadId: string | null;       // LSQ ProspectID
  source: string | null;
}

const digits = (v: string) => v.replace(/\D/g, "");
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// Case-insensitive first-match lookup over a flat record. Values are trimmed;
// LSQ renders empties as "", "null", or an unresolved mail-merge token — all
// treated as absent.
function pick(rec: Record<string, string>, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    for (const [k, v] of Object.entries(rec)) {
      if (!re.test(k)) continue;
      const t = v.trim();
      if (!t || t.toLowerCase() === "null" || /^@\{|\{\{/.test(t)) continue;   // unresolved merge token
      return t;
    }
  }
  return null;
}

// Flatten one level: unwrap After/Current (update webhooks) over the root, and
// stringify scalars. Non-scalar values are ignored.
function flatten(body: unknown): Record<string, string> {
  if (!body || typeof body !== "object") return {};
  const root = body as Record<string, unknown>;
  const layers: Record<string, unknown>[] = [root];
  for (const key of ["Current", "current", "After", "after"]) {
    const nested = root[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) layers.push(nested as Record<string, unknown>);
  }
  const out: Record<string, string> = {};
  for (const layer of layers) {                       // later layers (After/Current) override the root
    for (const [k, v] of Object.entries(layer)) {
      if (v == null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    }
  }
  return out;
}

export function parseLsqWebhook(body: unknown): LsqEvent {
  const rec = flatten(body);

  // Explicit event marker (we ask integrators to include one); else unknown —
  // actions are field-driven, the label only affects logging.
  const rawEvent = (pick(rec, [/^event(type)?$/i]) ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  const event: LsqEvent["event"] = rawEvent === "lead_created" || rawEvent === "owner_changed" || rawEvent === "stage_changed" ? rawEvent : "unknown";

  // Phone: exact-named lead fields first (Phone/Mobile/WhatsAppNumber), then
  // fuzzy phone-ish keys — so an AlternatePhone/RelativePhone can never hijack
  // the lead's identity when the primary field is present. Owner fields never.
  let phone: string | null = null;
  const phonePasses: RegExp[] = [/^(phone|mobile|phone_?number|whatsapp_?(number)?)$/i, /phone|mobile|whatsapp/i];
  outer: for (const re of phonePasses) {
    for (const [k, v] of Object.entries(rec)) {
      if (/owner/i.test(k) || !re.test(k)) continue;
      const d = digits(v);
      if (d.length >= 10 && d.length <= 15) { phone = d; break outer; }
    }
  }

  // Owner: email-shaped owner field wins; a bare name-shaped one becomes ownerName.
  const ownerRaw = pick(rec, [/^owneridemailaddress$/i, /^owneremail(address)?$/i, /^leadowneremail$/i, /^owner$/i, /^leadowner$/i]);
  const ownerEmail = ownerRaw && isEmail(ownerRaw) ? ownerRaw.toLowerCase() : null;
  const ownerName = pick(rec, [/^owneridname$/i, /^ownername$/i]) ?? (ownerRaw && !isEmail(ownerRaw) ? ownerRaw : null);

  // Lead email: exact-ish email fields, excluding anything owner-flavored.
  let email: string | null = null;
  for (const [k, v] of Object.entries(rec)) {
    if (/owner/i.test(k)) continue;
    if (!/^(emailaddress|email)$/i.test(k)) continue;
    if (isEmail(v)) { email = v.trim(); break; }
  }

  const first = pick(rec, [/^firstname$/i]) ?? "";
  const last = pick(rec, [/^lastname$/i]) ?? "";
  const name = `${first} ${last}`.trim() || pick(rec, [/^(leadname|fullname|name)$/i]);

  return {
    event,
    phone,
    name: name || null,
    email,
    ownerEmail,
    ownerName,
    stage: pick(rec, [/^prospectstage$/i, /^(currentstage|leadstage|stage)$/i, /^mx_.*stage.*$/i]),
    leadId: pick(rec, [/^prospectid$/i, /^(leadid|relatedprospectid)$/i]),
    source: pick(rec, [/^(source|leadsource)$/i]),
  };
}
