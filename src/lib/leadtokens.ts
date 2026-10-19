// What a sequence step's parameters may refer to, for one lead.
//
// A template has variables ({{1}}, {{2}}), and a sequence step fills them from
// `{token}` references that are resolved PER LEAD at send time: `{first_name}`,
// plus any attribute stored on the contact (`{city}`, `{plan}`, whatever the
// workspace captures through forms, flows, imports or its CRM). Nothing here
// knows what a workspace sells — the tokens are the lead's own data.

/** Normalise a label for comparison: lower-case, "&" read as "and", punctuation dropped. */
export const normLabel = (v: unknown): string =>
  String(v ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

/**
 * A greeting name from a CRM/contact name.
 *
 * A `name` is whatever the enquiry form captured: "rahul", "Rahul Sharma",
 * "RAHUL SHARMA", sometimes a phone number. A number is not a name and
 * "Hi 9876543210" is worse than not sending, so it comes back empty and the step
 * is skipped.
 */
export function firstName(full: string | null | undefined): string {
  const raw = String(full ?? "").trim();
  if (!raw) return "";
  const first = raw.split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, "");
  if (!first) return "";
  // All-caps and all-lower both read as shouting or sloppiness in a greeting.
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export interface TokenSubject {
  name?: string | null;
  attributes?: Record<string, string> | null;
}

/**
 * Everything a step's params may refer to, for one lead.
 *
 * Contact attributes go in FIRST (keys lower-cased — CRM exports disagree about
 * case) so the derived values below cannot be shadowed by an attribute that
 * happens to share a name.
 */
export function leadTokens(
  subject: TokenSubject | null | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  const attrs = subject?.attributes ?? {};
  return {
    ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? "")])),
    name: subject?.name ?? "",
    first_name: firstName(subject?.name),
    ...extra,
  };
}

/**
 * Which `{token}` references in these params resolve to nothing.
 *
 * Returned rather than substituted-with-blank because Meta rejects an empty
 * parameter outright (#132000), and the half of the time it does not, the lead
 * reads "Hi , welcome to…". Both are worse than a skipped step with a reason
 * recorded against it.
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
