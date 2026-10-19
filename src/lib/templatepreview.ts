// Showing an operator what the lead will actually receive.
//
// A sequence step stores a template NAME and a list of params. The preview
// used to show exactly that — "📄 intro_offer, approved template
// message" — which is the one part of the message the lead never sees.
// Whether the copy is right, whether the buttons are the ones the router
// knows, whether a variable landed in the wrong blank: none of it was
// visible until a real message arrived on a real phone.
//
// ── Which value goes in {{1}} ──────────────────────────────────────────────
//
// Three candidates, in order:
//
//   1. A literal param the operator typed. It is what will be sent, so it
//      is what should be shown.
//
//   2. Meta's own approved sample for that position. A param is usually a
//      token like `{first_name}` that resolves per lead at send time, so
//      there is no single true value — and "Hi Rahul" tells an operator
//      what the lead reads, while "Hi {first_name}" tells them what the
//      code does. They are checking the copy, so show the copy.
//
//   3. The token itself, then the bare `{{1}}`. Something is better than a
//      gap, and a visible `{{1}}` is a legible sign that nothing will fill
//      it.

export interface TemplateComponent {
  type: string;                       // HEADER | BODY | FOOTER | BUTTONS
  format?: string;                    // TEXT | IMAGE | VIDEO | DOCUMENT
  text?: string;
  buttons?: { type: string; text?: string }[];
  /** Meta's approved samples: example.body_text[0][n-1] fills {{n}}. */
  example?: { body_text?: string[][]; header_text?: string[] };
}

export interface PreviewTemplate {
  name: string;
  language: string;
  status?: string;
  components?: TemplateComponent[];
}

/** A step's param is a token when it is exactly `{word}` — not literal text. */
export const isToken = (p: string): boolean => /^\{\w+\}$/.test(p.trim());

export const componentOf = (t: PreviewTemplate | null | undefined, type: string): TemplateComponent | undefined =>
  t?.components?.find(c => c.type === type);

/**
 * Substitute `{{n}}` for what this step will put there.
 *
 * `params` are the step's own values; `samples` are Meta's approved
 * examples for the same positions. See the note above for the order.
 */
export function fillBody(body: string, params: readonly string[] = [], samples: readonly string[] = []): string {
  return String(body ?? "").replace(/\{\{(\d+)\}\}/g, (whole, n) => {
    const i = Number(n) - 1;
    if (i < 0) return whole;
    const p = String(params[i] ?? "").trim();
    if (p && !isToken(p)) return p;                       // a literal the operator typed
    const sample = String(samples[i] ?? "").trim();
    return sample || p || whole;                          // Meta's sample, else the token
  });
}

export interface PreviewParts {
  /** Filled header text, or null when there is no text header. */
  headerText: string | null;
  /** IMAGE | VIDEO | DOCUMENT when the header is media, else null. */
  headerMedia: string | null;
  body: string;
  footer: string | null;
  buttons: string[];
}

/** Everything the preview bubble needs, with the blanks already filled. */
export function previewParts(
  t: PreviewTemplate | null | undefined,
  params: readonly string[] = [],
): PreviewParts {
  const header = componentOf(t, "HEADER");
  const body = componentOf(t, "BODY");
  const footer = componentOf(t, "FOOTER");
  const isText = !header?.format || header.format === "TEXT";
  return {
    headerText: isText && header?.text
      ? fillBody(header.text, [], header.example?.header_text ?? [])
      : null,
    headerMedia: header?.format && header.format !== "TEXT" ? header.format : null,
    body: fillBody(body?.text ?? "", params, body?.example?.body_text?.[0] ?? []),
    footer: footer?.text?.trim() || null,
    // A button with no text cannot be rendered or tapped; Meta should never
    // return one, but a malformed component must not put a blank row in the
    // bubble that looks like a button and is not.
    buttons: (componentOf(t, "BUTTONS")?.buttons ?? [])
      .map(b => String(b.text ?? "").trim())
      .filter(Boolean),
  };
}
