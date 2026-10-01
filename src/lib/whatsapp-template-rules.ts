// WhatsApp template validation rules — pure, so they can be tested without a
// DOM and reused anywhere (the blog widget today, the Templates screen later).
//
// Every rule here is one Meta documents AND one that rejects a template
// outright. No "best practice" guesses: this runs on a public page and tells
// strangers whether to submit, so a false alarm sends someone rewriting
// perfectly good copy and a miss tells them a doomed template is fine.

export const BODY_MAX = 1024;
const HEADER_MAX = 60;
const FOOTER_MAX = 60;

type Finding = { ok: boolean; title: string; detail: string };

/** Placeholder occurrences in order, e.g. "{{1}} {{3}}" → [1, 3]. */
function placeholders(body: string): number[] {
  return [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1]));
}

export function checkTemplate(input: { header: string; body: string; footer: string }): Finding[] {
  const header = input.header.trim();
  const body = input.body.trim();
  const footer = input.footer.trim();
  const out: Finding[] = [];
  const vars = placeholders(body);

  out.push(body.length <= BODY_MAX
    ? { ok: true, title: "Body length", detail: `${body.length} of ${BODY_MAX} characters.` }
    : { ok: false, title: "Body is over the limit", detail: `${body.length} characters. Meta caps the body at ${BODY_MAX}, counting emoji and spaces.` });

  if (header) {
    out.push(header.length <= HEADER_MAX
      ? { ok: true, title: "Header length", detail: `${header.length} of ${HEADER_MAX} characters.` }
      : { ok: false, title: "Header is over the limit", detail: `${header.length} characters. The cap is ${HEADER_MAX}.` });
  }

  if (footer) {
    out.push(footer.length <= FOOTER_MAX
      ? { ok: true, title: "Footer length", detail: `${footer.length} of ${FOOTER_MAX} characters.` }
      : { ok: false, title: "Footer is over the limit", detail: `${footer.length} characters. The cap is ${FOOTER_MAX}.` });
    // Footers are static text. A variable here is rejected, and it is an easy
    // mistake because the body right above it accepts them.
    out.push(/\{\{/.test(footer)
      ? { ok: false, title: "Variable in the footer", detail: "Footers must be static text — they take no parameters at all. Move it into the body." }
      : { ok: true, title: "Footer is static", detail: "No variables, which is the rule." });
  }

  // Unbalanced braces: "{{1}" and "{1}}" both read as a typo to the reviewer.
  const opens = (body.match(/\{\{/g) ?? []).length;
  const closes = (body.match(/\}\}/g) ?? []).length;
  out.push(opens === closes && opens === vars.length
    ? { ok: true, title: "Braces balanced", detail: vars.length ? `${vars.length} variable${vars.length > 1 ? "s" : ""} parsed cleanly.` : "No variables used." }
    : { ok: false, title: "Mismatched or malformed braces", detail: `Found ${opens} opening and ${closes} closing pairs but only ${vars.length} valid {{n}} placeholder${vars.length === 1 ? "" : "s"}. Every variable is exactly {{1}}, {{2}} — no spaces, no names.` });

  if (vars.length) {
    // Must be 1,2,3… with no gaps and no repeats-out-of-order.
    const expected = vars.map((_, i) => i + 1);
    const sequential = vars.length === expected.length && vars.every((v, i) => v === expected[i]);
    out.push(sequential
      ? { ok: true, title: "Variables are sequential", detail: `Numbered ${vars.join(", ")} — correct.` }
      : { ok: false, title: "Variables are not sequential", detail: `Found ${vars.join(", ")}. They must run {{1}}, {{2}}, {{3}} in order with no gaps — skipping a number is an automatic rejection.` });

    const startsWith = /^\{\{\s*\d+\s*\}\}/.test(body);
    const endsWith = /\{\{\s*\d+\s*\}\}$/.test(body);
    out.push(!startsWith && !endsWith
      ? { ok: true, title: "Variables are not at the edges", detail: "Neither the first nor last character is a placeholder." }
      : { ok: false, title: `Variable at the ${startsWith ? "start" : "end"} of the body`, detail: "Meta rejects a body that opens or closes on a placeholder — there is nothing to anchor it. Add a word or punctuation around it." });

    out.push(!/\}\}\s*\{\{/.test(body)
      ? { ok: true, title: "No adjacent variables", detail: "Every placeholder has text around it." }
      : { ok: false, title: "Two variables sit side by side", detail: "Something like {{1}} {{2}} reads as a data dump. Put a word between them, or combine them into one variable." });

    // The ratio rule: lots of placeholders and almost no copy is the classic
    // "abuse potential" rejection, because the template says nothing on its own.
    const words = body.replace(/\{\{\s*\d+\s*\}\}/g, " ").trim().split(/\s+/).filter(Boolean).length;
    out.push(words >= vars.length * 3
      ? { ok: true, title: "Enough text around the variables", detail: `${words} words of real copy for ${vars.length} variable${vars.length > 1 ? "s" : ""}.` }
      : { ok: false, title: "Too many variables for the amount of text", detail: `${words} words of copy for ${vars.length} variables. A template that is mostly placeholders gets rejected for abuse potential — aim for roughly three words per variable.` });
  }

  out.push(!/\t/.test(body) && !/ {5,}/.test(body)
    ? { ok: true, title: "Whitespace is clean", detail: "No tabs or runs of five-plus spaces." }
    : { ok: false, title: "Tabs or long space runs", detail: "Template bodies take no tabs and no more than four consecutive spaces. Pasting from a document is the usual cause." });

  return out;
}
