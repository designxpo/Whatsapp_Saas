// What fills {{1}} for THIS lead.
//
// Every template in the RNR library has variables, and a sequence step's
// params are one fixed list shared by everybody on the journey. "Hi
// {{first_name}}" with a static param sends the same name to four thousand
// people.
//
// So a step's params are written as token strings — `{first_name}`,
// `{course}`, `{min_ctc}` — and resolved per lead at send time through
// canned.ts's resolveCannedParams, the same mechanism the one-click canned
// templates in Live Chat already use. This file is the token map.
//
// ── Why the programme table is keyed on what the CRM ACTUALLY holds ────────
//
// The message library names programmes in full ("Advanced Certification in
// Data Analytics with AI"). LeadSquared holds an abbreviation, in a field
// called `Product Name`:
//
//     Adv. Cert. in Data Analytics & AI                        82 leads
//     Adv. Cert. in Data Science & AI                          11
//     Adv. Cert. in Data Science & GenAI                        9
//     Executive Certif. in Data Science with AI Spec & GenAI    5
//     Certified Business Analytics                              2
//
// Neither spelling matches the other. A table keyed on the library's wording
// would match nobody, and the three audience-restricted steps would be
// skipped for every lead while the journey reported itself complete.
//
// One table, therefore, listing every spelling that means the same
// programme, with the audience lists GENERATED from it — so a programme
// cannot be admitted to a step whose value it has no answer for.
//
// ── The empty-value rule ───────────────────────────────────────────────────
//
// Meta rejects a template parameter that resolves to an empty string with
// #132000, and a body reading "Hi , greetings from AnalytixLabs" is worse
// than no message at all. So an unresolved token is an error the caller must
// handle, never a silent blank — see missingTokens().

/** Trimmed, lowercased, punctuation and runs of spaces flattened. */
export const normCourse = (v: unknown): string =>
  String(v ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface Roles { role1: string; role2: string }

export interface Programme {
  /** Every spelling that means this programme — CRM abbreviations first. */
  crmNames: string[];
  /** How a message should say it. "our Data Analytics course…" */
  display: string;
  /**
   * Roles for R+2. Absent means there is no honest pair, so R+2 skips it.
   *
   * AI for Managers has none because the library says those managers are
   * not changing role. The Executive programme has none either: the roles
   * table does not list it, and giving an executive intake the same two job
   * titles as a fresher intake is a guess in a sentence about their career.
   */
  roles?: Roles;
  /**
   * Minimum CTC for R+10, present ONLY where the programme carries the
   * ₹6L/₹10L and 50%-refund terms. Absent means R+10 must not be sent.
   */
  minCtc?: string;
  /** Runs classroom batches, so R+15 may invite them to a centre. */
  classroom?: boolean;
  /**
   * An older catalogue name we still RECOGNISE but never OFFER.
   *
   * The picker shows ten rows at most and takes the first ten programmes,
   * so without this the legacy names would push the current catalogue off
   * the end of the list a lead is asked to choose from.
   */
  legacy?: boolean;
  /** Why a value is missing, where somebody will need to decide. */
  open?: string;
}

/**
 * Every programme, keyed on what LeadSquared actually stores.
 *
 * Add a spelling here and the audiences widen with it; add a programme with
 * no `minCtc` and R+10 keeps skipping it, which is the safe direction.
 */
export const PROGRAMMES: Programme[] = [
  {
    crmNames: ["Adv. Cert. in Data Analytics & AI", "Advanced Certification in Data Analytics with AI", "Data Analytics"],
    display: "Data Analytics",
    roles: { role1: "Data Analyst", role2: "Business Analyst" },
    minCtc: "₹6 lakh",
    classroom: true,
  },
  {
    // ONE programme under two names. Tanvi, 14 Oct: "Advanced Certification
    // in Data Science has been renamed to Advanced Certification in Data
    // Science with GenAI, hence it remains INR 6,00,000."
    //
    // These were two entries, and the newer name carried no CTC — so every
    // lead whose CRM record used it was skipped by the results message while
    // a lead on the older name got it, for the same course. Both spellings
    // are live in the CRM and will stay live, because renaming a programme
    // does not rewrite the leads already filed under the old one.
    crmNames: [
      "Adv. Cert. in Data Science & GenAI",
      "Advanced Certification in Data Science with GenAI",
      "Adv. Cert. in Data Science & AI",
      "Advanced Certification in Data Science",
      "Data Science",
    ],
    display: "Data Science with GenAI",
    roles: { role1: "Data Scientist", role2: "Machine Learning Engineer" },
    minCtc: "₹6 lakh",
    classroom: true,
  },
  {
    crmNames: [
      "Executive Certif. in Data Science with AI Spec & GenAI",
      "Executive Certification in Data Science & AI",
      "Executive Data Science & AI",
    ],
    display: "Executive Data Science & AI",
    // Tanvi, 14 Oct. The open question was whether an executive intake is
    // changing role at all; these two say it is, and upwards.
    roles: { role1: "Data Scientist", role2: "Data Architect" },
    minCtc: "₹10 lakh",
  },
  {
    crmNames: ["Certified Business Analytics", "Business Analytics"],
    display: "Business Analytics",
    roles: { role1: "Business Analyst", role2: "Analytics Consultant" },
    classroom: true,
    // No minCtc, and now confirmed rather than inferred. Tanvi, 14 Oct: "We
    // don't offer any minimum CTC for Business Analytics — the program
    // doesn't include any job guarantee."
    //
    // So the results message must never reach it. That was already the
    // behaviour; this records WHY, so nobody adds a figure later on the
    // reasonable-looking grounds that every other programme has one.
  },
  {
    crmNames: ["Full Stack AI"],
    display: "Full Stack AI",
    roles: { role1: "AI Engineer", role2: "Machine Learning Engineer" },
    minCtc: "₹6 lakh",
    // Online only — carries the refund terms but gets no centre invitation.
  },
  {
    crmNames: ["GenAI", "Generative AI"],
    display: "GenAI",
    roles: { role1: "GenAI Engineer", role2: "AI Developer" },
  },
  {
    crmNames: ["Agentic AI"],
    display: "Agentic AI",
    roles: { role1: "AI Agent Developer", role2: "AI Engineer" },
  },
  {
    crmNames: ["AI for Managers", "AI for Managers & Leaders"],
    display: "AI for Managers",
    open: "Needs its own wording — these managers are not changing role, so R+2 skips it.",
  },

  // ── The older catalogue, as LeadSquared still holds it ───────────────────
  //
  // Measured 14 Oct against the 4,033 leads on "Not Reachable": 1,072 name a
  // course, and not one uses a spelling above. LeadSquared speaks the website
  // catalogue; this table spoke the sales deck. The overlap was zero, which
  // is why days 7, 12 and 18 reached nobody and the field read as junk.
  //
  // Each name below is placed on the evidence of the landing page its leads
  // actually arrived on (mx_Page_Url, counted per name), plus AnalytixLabs'
  // own published course pages.
  //
  // ── Which of these carry the ₹6 lakh and the refund ──────────────────────
  //
  // Day 12 states a minimum CTC and a 50% fee refund, so this is the line
  // that matters. Tanvi settled it on 14 Oct, and her three answers give the
  // rule for the whole catalogue rather than only the courses she was asked
  // about by name:
  //
  //   · Business Analytics carries NO minimum CTC and no job guarantee.
  //   · Data Science keeps ₹6,00,000 — the renaming to "with GenAI" changed
  //     the name and not the figure.
  //   · The Executive intake is ₹10 lakh, with its own role pair.
  //
  // Every other technical track in this table was already on ₹6 lakh before
  // she was asked. So the rule is: ₹6 lakh for the technical programmes,
  // ₹10 lakh for the Executive one, nothing for Business Analytics, and
  // nothing for AI for Managers. The names below follow it.
  //
  // Cyber Security is the one exception, and not from caution: nothing in
  // the catalogue, the placements page or the programme table establishes a
  // role pair OR a figure for it, so there is no sentence to send. Those 49
  // leads keep days 3 and 28.

  {
    // 302 leads. 265 of them arrived on /data-science-specialization-course —
    // today's Advanced Certification in Data Science, the guaranteed track.
    // Careers360 lists it as a current 425-hour AnalytixLabs programme.
    crmNames: ["Data Science 360 Course", "Data Science 360", "Data Science Course", "Data Science Certification Course"],
    display: "Data Science with GenAI",
    roles: { role1: "Data Scientist", role2: "Machine Learning Engineer" },
    minCtc: "₹6 lakh",
    classroom: true,
    legacy: true,
  },
  {
    // 149 leads, on /business-analytics-data-science-course and
    // /business-analyst-training-course-online. Tanvi, 14 Oct: Business
    // Analytics carries no minimum CTC and no job guarantee — so no minCtc,
    // exactly as the current Business Analytics entry above.
    crmNames: ["Business Analytics 360", "Business Analytics Course", "Business Analytics Certification Course"],
    display: "Business Analytics",
    roles: { role1: "Business Analyst", role2: "Analytics Consultant" },
    classroom: true,
    legacy: true,
  },
  {
    // 111 + 27 + 36 leads. Modules of the Data Science 360 bundle — AnalytixLabs
    // describes Analytics Edge as its R training and Data Science with Python
    // as the Python module. Real courses, but not the guaranteed bundle.
    crmNames: [
      "Data Science With Python", "Data Science using R", "Analytics Edge",
      "Python Machine Learning Course", "Machine Learning Course", "Deep Learning With Python",
    ],
    display: "Data Science",
    roles: { role1: "Data Scientist", role2: "Machine Learning Engineer" },
    minCtc: "₹6 lakh",
    classroom: true,
    legacy: true,
  },
  {
    // 105 leads, split between /advanced-excel-training-certification-course-online
    // and the data science page. Visualisation and analytics tooling — the
    // analyst track, not the data science bundle.
    crmNames: ["Data Visualization & Analytics", "Data Visualisation & Analytics"],
    display: "Data Visualisation & Analytics",
    roles: { role1: "Data Analyst", role2: "Business Intelligence Analyst" },
    minCtc: "₹6 lakh",
    classroom: true,
    legacy: true,
  },
  {
    // 39 leads, on /artificial-intelligence-certification-courses-online and
    // /applied-ai-and-machine-learning-course. Named on the current placements
    // page as part of the ₹6,00,000 guaranteed track.
    crmNames: ["Full Stack Applied AI Course", "Advanced Certification in Full Stack Applied AI"],
    display: "Full Stack Applied AI",
    roles: { role1: "AI Engineer", role2: "Machine Learning Engineer" },
    minCtc: "₹6 lakh",
    legacy: true,
  },
  {
    // 25 leads, on /artificial-intelligence-engineering-course. Not named on
    // the placements page, so it gets roles and no figure.
    crmNames: ["Artificial Intelligence Engineering", "Artificial Intelligence Certification Course"],
    display: "AI Engineering",
    roles: { role1: "AI Engineer", role2: "Machine Learning Engineer" },
    minCtc: "₹6 lakh",
    legacy: true,
  },
  {
    // 56 leads, 39 of them on /big-data-analytics-hadoop-spark-training-course-online.
    // A distinct engineering track — offered online, classroom and blended.
    crmNames: ["Certified Big Data Engineer", "Certified Data Engineering"],
    display: "Data Engineering",
    roles: { role1: "Data Engineer", role2: "Big Data Engineer" },
    minCtc: "₹6 lakh",
    classroom: true,
    legacy: true,
  },
  {
    // 49 leads. Recognised so we stop asking them a question whose answer we
    // already hold and cannot act on — the picker does not offer Cyber
    // Security, so asking would only invite a wrong answer. No roles and no
    // figure: nothing published supports either, so days 7, 12 and 18 skip it
    // and they keep days 3 and 28.
    crmNames: ["Cyber Security", "Cybersecurity"],
    display: "Cyber Security",
    legacy: true,
    open: "No role pair or CTC published for this track — R+2, R+10 and R+15 all skip it.",
  },
];

const BY_NAME = new Map<string, Programme>();
for (const p of PROGRAMMES) for (const n of p.crmNames) BY_NAME.set(normCourse(n), p);

/** The programme a CRM value refers to, or null if we do not recognise it. */
/**
 * The course a tracked-link label names.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Three of the five drip steps are addressed by the lead's course, and
 * LeadSquared does not hold one: measured 14 Oct, 0 of the 1,000 most recent
 * leads on Not Reachable had a usable mx_Course_Interested. 254 of them hold
 * the literal string "66" — a form posting an option id instead of its label.
 *
 * But OUR OWN links already say it. `ppc-wa-da-delhi` is Data Analytics in
 * Delhi; `ppc-wa-ds-noida` is Data Science in Noida. The webhook already
 * stores that label on the contact as handle_source, and nothing was reading
 * the course out of it.
 *
 * ── What it will and will not answer ───────────────────────────────────────
 *
 * Only the course segment, and only when the label states one. A label that
 * names a PLACE or an ACTION — ppc-wa-placement, Callback, Masterclass,
 * GMB_Whatsapp_Noida, organic-whatsapp — returns null rather than a guess.
 * Addressing somebody by a course they never asked about is worse than not
 * addressing them, and the day-12 message carries a salary and refund claim.
 *
 * `ppc-wa-ds-specialization` is Data Science: "specialization" is the variant,
 * not a different subject.
 */
const LABEL_COURSE: [RegExp, string][] = [
  // Checked before the two-letter codes: "da" would otherwise match inside
  // a longer word and claim a lead for the wrong programme.
  [/(^|[-_])full[-_]?stack/i, "Full Stack AI"],
  [/(^|[-_])(business[-_]?analytics|ba)([-_]|$)/i, "Certified Business Analytics"],
  [/(^|[-_])(ds|data[-_]?science)([-_]|$)/i, "Adv. Cert. in Data Science & GenAI"],
  [/(^|[-_])(da|data[-_]?analytics)([-_]|$)/i, "Adv. Cert. in Data Analytics & AI"],
  [/(^|[-_])gen[-_]?ai([-_]|$)/i, "GenAI"],
  [/(^|[-_])agentic([-_]|$)/i, "Agentic AI"],
];

export function courseFromLabel(label: string | null | undefined): string | null {
  const l = String(label ?? "").trim();
  if (!l) return null;
  for (const [re, course] of LABEL_COURSE) {
    // The match must still resolve in the programme table — a mapping that
    // drifted from the table would stamp a value no message can render.
    if (re.test(l)) return programmeFor(course) ? course : null;
  }
  return null;
}

export const programmeFor = (v: unknown): Programme | null => BY_NAME.get(normCourse(v)) ?? null;

/** Every CRM spelling of a programme that satisfies `pick`. */
const namesWhere = (pick: (p: Programme) => boolean): string[] =>
  PROGRAMMES.filter(pick).flatMap(p => p.crmNames);

/** R+10's audience — generated, so it can never admit a programme with no figure. */
export const CTC_COURSE_VALUES: readonly string[] = namesWhere(p => !!p.minCtc);
/** R+2's audience — only programmes with a confirmed role pair. */
export const ROLE_COURSE_VALUES: readonly string[] = namesWhere(p => !!p.roles);
/** R+15's course side — only programmes that run classroom batches. */
export const CLASSROOM_COURSE_VALUES: readonly string[] = namesWhere(p => !!p.classroom);

/** Questions this table cannot answer, for whoever owns the programme data. */
export const PROGRAMME_QUESTIONS = PROGRAMMES.filter(p => p.open).map(p => `${p.display}: ${p.open}`);

export interface Centre { name: string; address: string }

/** The three centres, addresses exactly as the library prints them. */
export const CENTRES: Record<string, Centre> = {
  noida: { name: "Noida", address: "1st Floor, A78, A Block, Sector 2, near Metro Gate 3" },
  gurgaon: { name: "Gurgaon", address: "2nd Floor, Sidhartha House, Building 6, Sector 44, near HUDA City Centre Metro" },
  bangalore: { name: "Bangalore", address: "Bldg 51/2, 1st Floor, 12th Main Road, Sector 6, HSR Layout, opposite A2B" },
};

/**
 * City → nearest centre.
 *
 * The misspellings are real: "Banglore" is in the live data, as are trailing
 * spaces on most values (normCourse handles those). A lead whose city we
 * cannot read gets no centre invitation, which is the right failure but a
 * silent one, so the common variants are listed.
 *
 * Delhi maps to Gurgaon, which is a GUESS: both centres serve NCR and
 * nothing says which side of the city a Delhi lead is on. It is wrong for
 * east Delhi and nobody has the data to do better.
 */
export const CITY_CENTRE: Record<string, string> = {
  "bangalore": "bangalore", "bengaluru": "bangalore", "banglore": "bangalore", "bengalore": "bangalore",
  "noida": "noida", "greater noida": "noida", "ghaziabad": "noida",
  "gurgaon": "gurgaon", "gurugram": "gurgaon",
  "delhi": "gurgaon", "new delhi": "gurgaon", "faridabad": "gurgaon",
};

/** R+15's city side — every spelling that maps to a centre. */
export const CENTRE_CITIES: readonly string[] = Object.keys(CITY_CENTRE);

/**
 * The first word of a name, which is what every template greets people by.
 *
 * A CRM `name` is whatever the enquiry form captured: "rahul", "Rahul
 * Sharma", "RAHUL SHARMA", sometimes a phone number. A number is not a name
 * and "Hi 9876543210" is worse than not sending, so it comes back empty and
 * the step is skipped.
 */
export function firstName(full: string | null | undefined): string {
  const raw = String(full ?? "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, "");
  if (!first) return "";
  // All-caps and all-lower both read as shouting or sloppiness in a greeting.
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** Read an attribute case-insensitively — CRM exports disagree about case. */
function attr(attrs: Record<string, string> | null | undefined, ...keys: string[]): string {
  const want = new Set(keys.map(k => k.trim().toLowerCase()));
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (want.has(k.trim().toLowerCase())) {
      const s = String(v ?? "").trim();
      if (s) return s;
    }
  }
  return "";
}

export interface TokenSubject {
  name?: string | null;
  attributes?: Record<string, string> | null;
}

/**
 * Everything a step's params may refer to, for one lead.
 *
 * Contact attributes go in FIRST so the derived values below cannot be
 * shadowed by an attribute that happens to share a name — a CRM field called
 * `min_ctc` holding something stale must not outrank the table.
 */
export function leadTokens(
  subject: TokenSubject | null | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  const attrs = subject?.attributes ?? {};
  // `Product Name` is what LeadSquared actually calls it here; the others
  // are what a different export, or a hand-typed contact, might use.
  const rawCourse = attr(attrs, "Product Name", "course", "mx_Course", "programme", "program");
  const prog = programmeFor(rawCourse);
  const city = attr(attrs, "city", "mx_City");
  const centre = CENTRES[CITY_CENTRE[normCourse(city)] ?? ""];

  return {
    ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? "")])),
    name: subject?.name ?? "",
    first_name: firstName(subject?.name),
    // The DISPLAY name, not the CRM abbreviation: "our Adv. Cert. in Data
    // Analytics & AI course prepares you" is not a sentence.
    course: prog?.display ?? "",
    role_1: prog?.roles?.role1 ?? "",
    role_2: prog?.roles?.role2 ?? "",
    min_ctc: prog?.minCtc ?? "",
    centre_name: centre?.name ?? "",
    centre_address: centre?.address ?? "",
    ...extra,
  };
}

/**
 * Which `{token}` references in these params resolve to nothing.
 *
 * Returned rather than substituted-with-blank because Meta rejects an empty
 * parameter outright (#132000), and the half of the time it does not, the
 * lead reads "Hi , greetings from AnalytixLabs". Both are worse than a
 * skipped step with a reason recorded against it.
 */
export function missingTokens(params: readonly string[], tokens: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const p of params) {
    for (const m of String(p ?? "").matchAll(/\{(\w+)\}/g)) {
      const key = m[1].toLowerCase();
      if (!String(tokens[key] ?? "").trim()) missing.add(m[1]);
    }
  }
  return [...missing];
}
