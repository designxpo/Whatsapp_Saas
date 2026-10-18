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
  leadScore: string | null;    // mx_Lead_Score — the grade a counsellor sets by hand
  leadId: string | null;       // LSQ ProspectID
  source: string | null;
  /**
   * The programme the lead enquired about, and the city they are in.
   *
   * Three of the five drip messages are addressed to a subset: the roles
   * message needs a confirmed role pair, the results message makes a salary
   * and refund claim only some programmes carry, and the centre invitation
   * is meaningless to an online-only course or a lead nowhere near a centre.
   * Each is an `attrIn` rule, and attrIn treats a MISSING value as "no" on
   * purpose — an unverifiable claim must not go out by default.
   *
   * Which meant that until these two fields existed, every lead enrolled by
   * the stage poll arrived knowing neither, failed all three gates, and
   * received a four-week nurture consisting of day 3 and day 28. Measured
   * 13 Oct: 122 of 3,128 contacts carried a course, and none of the leads
   * this path creates could.
   */
  course: string | null;       // mx_Course_Interested
  city: string | null;         // mx_City
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
  const root = body as unknown as Record<string, unknown>;
  const layers: Record<string, unknown>[] = [root];
  for (const key of ["Current", "current", "After", "after"]) {
    const nested = root[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) layers.push(nested as unknown as Record<string, unknown>);
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
    // The grade a counsellor sets by hand. Exact schema name first — a fuzzy
    // /score/ pass alone would happily pick up EngagementScore or
    // QualityScore01, which LeadSquared moves on its own, and a drip fired by
    // an automatic score is not what anybody configured.
    leadScore: pick(rec, [/^mx_lead_score$/i, /^lead_?score$/i, /^mx_.*lead.*score.*$/i]),
    leadId: pick(rec, [/^prospectid$/i, /^(leadid|relatedprospectid)$/i]),
    source: pick(rec, [/^(source|leadsource)$/i]),
    // mx_Course_Interested is the field this instance actually fills;
    // mx_Course does not exist here, and mx_Course_Suggested is the
    // counsellor's recommendation rather than the lead's own enquiry, so it
    // is only a fallback. Whatever arrives is validated downstream — the
    // live field is about four-fifths "66" and "Select".
    course: pick(rec, [/^mx_course_interested$/i, /^(course|programme|program)$/i, /^mx_course_suggested$/i]),
    city: pick(rec, [/^mx_city$/i, /^city$/i, /^mx_city_name$/i]),
  };
}
