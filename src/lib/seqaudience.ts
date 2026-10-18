// Who a single drip step is for.
//
// Most steps go to everyone. Three of the seven in the RNR brief do not:
//
//   R+5   Free masterclass    only leads not already registered
//   R+10  Results in numbers  only programmes that carry those terms
//   R+15  Centre visit        only Bangalore/NCR, never the online-only courses
//
// ── Why a rule object and not columns ──────────────────────────────────────
//
// The interesting part of every one of those is WHICH CRM ATTRIBUTE to read,
// and that is LeadSquared's vocabulary, not ours. A `course` column here
// would be wrong the first time they rename the field or the second campaign
// needs to filter on something else. So the rule names the attribute, and
// adding a new kind of audience is a row edit rather than a migration —
// which is what the 29 September meeting asked for when it said new stages
// must not need rework.
//
// ── Why a miss SKIPS rather than STOPS ─────────────────────────────────────
//
// A lead who is not eligible for the centre-visit message is still a live
// lead: they should get R+21 and R+28. So the engine advances past a step the
// lead does not match, rather than ending the journey. Dropping the whole
// nurture because one message did not apply would be the loudest possible
// over-reaction to the quietest possible condition.
//
// ── The asymmetry that matters ─────────────────────────────────────────────
//
// A MISSING attribute fails `attrIn` and passes `attrNotIn`, and that is
// deliberate rather than an accident of implementation:
//
//   attrIn   is a claim about the lead we must be able to stand behind.
//            R+10 promises "₹6L minimum CTC, 50% fee refund" and the brief
//            says "only to leads on programmes that carry these terms". A
//            lead whose course we do not know is a lead we cannot make that
//            promise to. Unknown must not mean yes.
//
//   attrNotIn is an exclusion of the known-bad. R+15 must not go to the
//            online-only courses; a lead whose course is unknown is not
//            known to be one of them, so this clause alone does not exclude
//            them. R+15 also carries a region attrIn, which is what actually
//            keeps an unknown lead out.
//
// Getting this backwards would put an unverified salary claim in front of
// every lead with an incomplete CRM record, which is the one failure here
// with a legal edge to it.

export interface AudienceRule {
  /** Attribute must be PRESENT and one of these values. Missing → no match. */
  attrIn?: Record<string, string[]>;
  /** Attribute must not be any of these values. Missing → no match needed, passes. */
  attrNotIn?: Record<string, string[]>;
  /** Contact must carry every one of these tags. */
  hasTag?: string[];
  /** Contact must carry none of these tags. */
  lacksTag?: string[];
}

/** The part of a contact an audience rule is allowed to see. */
export interface AudienceSubject {
  attributes?: Record<string, string> | null;
  tags?: string[] | null;
}

/** Trimmed and lowercased, so "Delhi NCR" and "delhi ncr " are one value. */
const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();

const normSet = (vs: readonly string[] | undefined): Set<string> =>
  new Set((vs ?? []).map(norm).filter(Boolean));

/**
 * Read an attribute case-insensitively by KEY as well as by value.
 *
 * CRM exports disagree about capitalisation far more often than they disagree
 * about spelling — `Course`, `course` and `mx_Course` all turn up — and a
 * rule that silently matched nothing because of a capital C would look
 * exactly like a rule that was correctly excluding everybody.
 */
function attr(subject: AudienceSubject, key: string): string {
  const attrs = subject.attributes ?? {};
  const want = norm(key);
  for (const [k, v] of Object.entries(attrs)) {
    if (norm(k) === want) return norm(v);
  }
  return "";                     // absent, and so is a value that is all spaces
}

/** True when this rule is empty — no rule at all, which means everyone. */
export function isEveryone(rule: AudienceRule | null | undefined): boolean {
  if (!rule) return true;
  const { attrIn, attrNotIn, hasTag, lacksTag } = rule;
  return !Object.keys(attrIn ?? {}).length
    && !Object.keys(attrNotIn ?? {}).length
    && !(hasTag ?? []).length
    && !(lacksTag ?? []).length;
}

/**
 * A stable fingerprint of an audience rule.
 *
 * Two rules that select the same leads must produce the same string. Order
 * carries no meaning here — `["a","b"]` and `["b","a"]` are one rule, and so
 * are a null rule and an empty one — so anything comparing rules literally
 * reports a difference every time the programme table is merely reordered.
 *
 * It lives beside the matcher deliberately: this is a claim about when two
 * rules are the SAME, and the matcher is what decides that. A second copy
 * somewhere else would be free to drift from it, and the drift would show up
 * as a health check that cried wolf or, worse, one that stayed quiet.
 */
export function audienceFingerprint(rule: AudienceRule | null | undefined): string {
  if (isEveryone(rule)) return "";
  const r = rule as AudienceRule;
  const attrs = (o: Record<string, string[]> | undefined) =>
    Object.entries(o ?? {})
      .map(([k, v]) => [k.trim().toLowerCase(), [...v].map(x => String(x).trim().toLowerCase()).sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  const tags = (v: string[] | undefined) => [...(v ?? [])].map(x => x.trim().toLowerCase()).sort();
  return JSON.stringify([attrs(r.attrIn), attrs(r.attrNotIn), tags(r.hasTag), tags(r.lacksTag)]);
}

/**
 * Does this lead match the step's audience?
 *
 * Every clause must pass. A null/empty rule matches everyone, which is what
 * every step that predates 0103 has.
 */
export function matchesAudience(
  rule: AudienceRule | null | undefined,
  subject: AudienceSubject | null | undefined,
): boolean {
  if (isEveryone(rule)) return true;
  const s = subject ?? {};
  const r = rule as AudienceRule;

  // Must be present AND listed. An unknown value is not a yes — see the note
  // at the top about R+10's salary claim.
  for (const [key, values] of Object.entries(r.attrIn ?? {})) {
    const allowed = normSet(values);
    if (!allowed.size) continue;                 // an empty list constrains nothing
    const have = attr(s, key);
    if (!have || !allowed.has(have)) return false;
  }

  // Excludes only what is known to be excluded.
  for (const [key, values] of Object.entries(r.attrNotIn ?? {})) {
    const denied = normSet(values);
    if (!denied.size) continue;
    const have = attr(s, key);
    if (have && denied.has(have)) return false;
  }

  const tags = normSet(s.tags ?? []);
  for (const t of normSet(r.hasTag)) if (!tags.has(t)) return false;
  for (const t of normSet(r.lacksTag)) if (tags.has(t)) return false;

  return true;
}

/**
 * Parse whatever came out of the `audience` jsonb column.
 *
 * Anything unrecognised becomes "everyone" rather than "nobody". A garbled
 * rule that matched nobody would stop a live campaign silently — the step
 * would be skipped for every lead and the enrolment would keep advancing, so
 * the journey would complete having sent nothing and looking complete.
 * Sending to too many is visible and recoverable; sending to nobody is
 * neither.
 */
export function parseAudience(raw: unknown): AudienceRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as unknown as Record<string, unknown>;

  const strMap = (v: unknown): Record<string, string[]> | undefined => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
    const out: Record<string, string[]> = {};
    for (const [k, val] of Object.entries(v as unknown as Record<string, unknown>)) {
      const list = Array.isArray(val) ? val : [val];
      const cleaned = list.filter(x => typeof x === "string" && x.trim()).map(x => x as string);
      if (cleaned.length) out[k] = cleaned;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const strList = (v: unknown): string[] | undefined => {
    const list = Array.isArray(v) ? v : v == null ? [] : [v];
    const cleaned = list.filter(x => typeof x === "string" && x.trim()).map(x => x as string);
    return cleaned.length ? cleaned : undefined;
  };

  const rule: AudienceRule = {
    attrIn: strMap(o.attrIn),
    attrNotIn: strMap(o.attrNotIn),
    hasTag: strList(o.hasTag),
    lacksTag: strList(o.lacksTag),
  };
  return isEveryone(rule) ? null : rule;
}

/**
 * How many values are worth spelling out before a count says more.
 *
 * The course lists went from 12 names to 40 the day the legacy catalogue was
 * mapped. At that size the sentence stops being a sentence: a step row became
 * a paragraph and the DAY — the one thing the row exists to show — was lost
 * inside it. Under this many, the names ARE the information and get printed.
 */
export const AUDIENCE_SPELL_OUT = 4;

/**
 * A sentence an operator can read back, for the step editor and the skip log.
 *
 * Written out rather than dumping the JSON because the person who needs to
 * know why a lead did not get R+15 is a counsellor, not the person who wrote
 * the rule.
 *
 * Each clause is judged on its own length, not the rule's: the centre step
 * is forty courses AND three cities, and collapsing both would hide the half
 * a reader can actually act on. `long` spells everything out, for a tooltip
 * or anywhere the full list is the point.
 */
export function describeAudience(rule: AudienceRule | null | undefined, long = false): string {
  if (isEveryone(rule)) return "Everyone in this journey";
  const r = rule as AudienceRule;
  const list = (v: string[], join: string) =>
    !long && v.length > AUDIENCE_SPELL_OUT ? `one of ${v.length} values` : v.join(join);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(r.attrIn ?? {})) parts.push(`${k} is ${list(v, " or ")}`);
  for (const [k, v] of Object.entries(r.attrNotIn ?? {})) parts.push(`${k} is not ${list(v, " or ")}`);
  if (r.hasTag?.length) parts.push(`tagged ${r.hasTag.join(" and ")}`);
  if (r.lacksTag?.length) parts.push(`not tagged ${r.lacksTag.join(" or ")}`);
  return parts.join("; ");
}

/**
 * Work out each step's audience on a save, preserving what is already stored
 * when the client did not mention it.
 *
 * setSequenceSteps deletes and re-inserts, so a step that arrives without an
 * audience is a step that goes to EVERYONE from the next drain onwards. Any
 * client that predates 0103 sends exactly that — a browser tab left open
 * across the deploy is enough — and the three restricted RNR steps would
 * quietly begin sending an unverified salary claim to the whole enrolment.
 *
 * An OMITTED key and an explicit null are therefore different answers:
 * omitted means "I know nothing about this", null means "clear it". Only
 * `in` can tell them apart, which is why this takes the raw step objects
 * rather than a list of rules.
 *
 * Matched by index, because that is the only identity a step has — they are
 * deleted and rewritten on every save. A reordered step keeps the audience
 * of the position it now occupies, which is wrong but visible; losing the
 * rule entirely would not be.
 */
export function resolveStepAudiences(
  incoming: readonly Record<string, unknown>[],
  prior: readonly (AudienceRule | null | undefined)[],
): (AudienceRule | null)[] {
  return incoming.map((step, i) =>
    "audience" in step ? parseAudience(step.audience) : (prior[i] ?? null),
  );
}
