// Meta template body placeholders, and the payload shape each format needs.
//
// A template declares one of two parameter formats, and the send payload is
// NOT interchangeable between them:
//
//   POSITIONAL  body "Hi {{1}}, your {{2}} is ready"
//               parameters: [{ type: "text", text: "…" }, …]        (order matters)
//   NAMED       body "Hello {{customer_name}}"
//               parameters: [{ type: "text", parameter_name: "customer_name", text: "…" }]
//
// Everything here matched only /\{\{(\d+)\}\}/ — digits. So a NAMED template
// read as having ZERO variables: the composer said "This template has no
// variables — nothing else to fill in", sent no body parameters, and Meta
// rejected the send with (#132000) "Number of parameters does not match the
// expected number of params". Found on the internal build, where three approved
// templates were unusable that way; this schema had the identical scans.

export type ParamFormat = "POSITIONAL" | "NAMED";

export interface BodyParam { type: "text"; text: string; parameter_name?: string }

// Meta's own identifier rule for a named parameter: lowercase letters, digits
// and underscores. Matching \w+ generally also catches the positional {{1}}.
const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * The template's placeholders, in order of first appearance, deduped.
 *
 * POSITIONAL bodies yield the numbers as strings (["1", "2"]); NAMED bodies
 * yield the names (["customer_name"]). Order is what a positional send relies
 * on, so first-appearance order is preserved rather than sorted — a body that
 * writes {{2}} before {{1}} still maps its values by number, see paramIndex.
 */
export function templatePlaceholders(bodyText: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const m of String(bodyText ?? "").matchAll(PLACEHOLDER)) {
    if (!seen.has(m[1])) seen.add(m[1]);
  }
  return [...seen];
}

/** NAMED as soon as any placeholder is not a plain number. */
export function isNamedFormat(tokens: string[]): boolean {
  return tokens.some(t => !/^\d+$/.test(t));
}

export function paramFormat(tokens: string[]): ParamFormat {
  return isNamedFormat(tokens) ? "NAMED" : "POSITIONAL";
}

/**
 * How many values a template needs.
 *
 * For POSITIONAL this is the HIGHEST index, not the count of distinct
 * placeholders: a body using only {{2}} still needs two parameters, because
 * Meta reads the array by position.
 */
export function paramCount(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  if (isNamedFormat(tokens)) return tokens.length;
  return Math.max(...tokens.map(Number));
}

/**
 * The `parameters` array for a body component.
 *
 * `values` are the human-entered strings. For POSITIONAL they are used in
 * order; for NAMED each is paired with the token at the same index, which is
 * how the composer collects them (one input per placeholder, in body order).
 * Returns [] when there is nothing to send, so callers can skip the component
 * entirely — Meta rejects an empty parameters array.
 */
export function bodyParameters(values: string[], tokens: string[]): BodyParam[] {
  if (values.length === 0) return [];
  if (!isNamedFormat(tokens)) return values.map(text => ({ type: "text", text }));
  const out: BodyParam[] = [];
  values.forEach((text, i) => {
    // A named parameter with no matching placeholder cannot be sent — Meta
    // rejects unknown names — so drop it rather than fail the whole send.
    if (tokens[i]) out.push({ type: "text", parameter_name: tokens[i], text });
  });
  return out;
}
