import { describe, it, expect } from "vitest";
import { templatePlaceholders, isNamedFormat, paramFormat, paramCount, bodyParameters } from "../template-params";

// Meta templates declare one of two parameter formats and the send payload is
// not interchangeable. Everything here matched only /\{\{(\d+)\}\}/ — digits —
// so a NAMED template read as having ZERO variables: the composer printed
// "This template has no variables — nothing else to fill in", the send went out
// with no body parameters, and Meta answered
//   (#132000) Number of parameters does not match the expected number of params
// Three approved templates on the internal build's live WABA were unusable this
// way; this schema had the identical scans, including in preflight.

// Exactly as Meta returns it.
const NAMED_BODY = "Hello {{customer_name}} \n\nDesigned by experts to keep you ahead, combining industry interface and domain expertise to deliver the perfect blend of theoretical and practical learning.";
const POSITIONAL_BODY = "Hi {{1}}, your {{2}} is confirmed for {{3}}.";

describe("placeholders are found whatever the format", () => {
  it("finds a named placeholder the old digits-only regex missed entirely", () => {
    expect(templatePlaceholders(NAMED_BODY)).toEqual(["customer_name"]);
    expect(/\{\{(\d+)\}\}/.test(NAMED_BODY)).toBe(false);   // why it was invisible
  });

  it("still finds positional placeholders", () => {
    expect(templatePlaceholders(POSITIONAL_BODY)).toEqual(["1", "2", "3"]);
  });

  it("dedupes a placeholder used twice", () => {
    expect(templatePlaceholders("{{name}} and again {{name}}")).toEqual(["name"]);
    expect(templatePlaceholders("{{1}} then {{1}}")).toEqual(["1"]);
  });

  it("keeps first-appearance order, which is what a positional send relies on", () => {
    expect(templatePlaceholders("{{2}} before {{1}}")).toEqual(["2", "1"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(templatePlaceholders("Hello {{ customer_name }}")).toEqual(["customer_name"]);
  });

  it("finds nothing in a body with no placeholders, and does not throw on empty", () => {
    expect(templatePlaceholders("Plain text.")).toEqual([]);
    expect(templatePlaceholders("")).toEqual([]);
    expect(templatePlaceholders(null)).toEqual([]);
    expect(templatePlaceholders(undefined)).toEqual([]);
  });
});

describe("format detection", () => {
  it("any non-numeric placeholder makes the template NAMED", () => {
    expect(isNamedFormat(["customer_name"])).toBe(true);
    expect(paramFormat(["customer_name"])).toBe("NAMED");
  });

  it("all-numeric placeholders are POSITIONAL", () => {
    expect(isNamedFormat(["1", "2"])).toBe(false);
    expect(paramFormat(["1", "2"])).toBe("POSITIONAL");
  });

  it("no placeholders is POSITIONAL — nothing to name", () => {
    expect(paramFormat([])).toBe("POSITIONAL");
  });
});

describe("how many values a template needs", () => {
  it("counts named placeholders", () => {
    expect(paramCount(["customer_name", "course"])).toBe(2);
  });

  it("uses the HIGHEST positional index, not the count", () => {
    // A body using only {{2}} still needs two parameters: Meta reads the array
    // by position, so asking for one would land the value in slot 1.
    expect(paramCount(["2"])).toBe(2);
    expect(paramCount(["1", "3"])).toBe(3);
  });

  it("is zero for a template with no placeholders", () => {
    expect(paramCount([])).toBe(0);
  });
});

describe("the payload Meta actually accepts", () => {
  it("tags each value with its parameter_name for a NAMED template", () => {
    expect(bodyParameters(["Priyesh"], ["customer_name"]))
      .toEqual([{ type: "text", parameter_name: "customer_name", text: "Priyesh" }]);
  });

  it("sends a bare positional array for a POSITIONAL template", () => {
    expect(bodyParameters(["Priyesh", "SQL"], ["1", "2"]))
      .toEqual([{ type: "text", text: "Priyesh" }, { type: "text", text: "SQL" }]);
  });

  it("never puts parameter_name on a positional parameter", () => {
    for (const p of bodyParameters(["a", "b"], ["1", "2"])) expect(p).not.toHaveProperty("parameter_name");
  });

  it("pairs several named values with their own placeholders, in body order", () => {
    expect(bodyParameters(["Priyesh", "Data Science"], ["customer_name", "course"])).toEqual([
      { type: "text", parameter_name: "customer_name", text: "Priyesh" },
      { type: "text", parameter_name: "course", text: "Data Science" },
    ]);
  });

  it("drops a named value with no placeholder to bind to rather than failing the send", () => {
    // Meta rejects an unknown parameter_name outright, which would lose the
    // whole message for every recipient.
    expect(bodyParameters(["Priyesh", "stray"], ["customer_name"]))
      .toEqual([{ type: "text", parameter_name: "customer_name", text: "Priyesh" }]);
  });

  it("returns [] for no values so the caller omits the component — Meta rejects an empty array", () => {
    expect(bodyParameters([], ["customer_name"])).toEqual([]);
    expect(bodyParameters([], [])).toEqual([]);
  });

  it("falls back to positional when the template could not be resolved", () => {
    // templateSpec returns no tokens if Meta is unreachable; the send must still
    // go out the way it always did rather than being blocked.
    expect(bodyParameters(["Priyesh"], [])).toEqual([{ type: "text", text: "Priyesh" }]);
  });

  it("preserves the value verbatim, including characters that look like placeholders", () => {
    expect(bodyParameters(["{{not_a_token}}"], ["customer_name"]))
      .toEqual([{ type: "text", parameter_name: "customer_name", text: "{{not_a_token}}" }]);
  });
});

describe("end to end on the template that failed in production", () => {
  it("name_testing_2 needs one value, named customer_name", () => {
    const tokens = templatePlaceholders(NAMED_BODY);
    expect(paramCount(tokens)).toBe(1);                       // was 0 -> #132000
    expect(bodyParameters(["Priyesh"], tokens)).toEqual([
      { type: "text", parameter_name: "customer_name", text: "Priyesh" },
    ]);
  });
});

import { templateIssues } from "../preflight";

describe("preflight no longer waves a NAMED template through", () => {
  const named = [{ type: "BODY", text: NAMED_BODY }];

  it("blocks a NAMED template with no value supplied", () => {
    // It used to read zero placeholders, pass, and let Meta reject the send.
    const r = templateIssues({ name: "name_testing_2", components: named } as never, { bodyParams: [] } as never);
    expect(r.blocking.join(" ")).toContain("customer_name");
  });

  it("passes once the value is supplied", () => {
    const r = templateIssues({ name: "name_testing_2", components: named } as never, { bodyParams: ["Priyesh"] } as never);
    expect(r.blocking).toEqual([]);
  });

  it("still blocks a POSITIONAL template that is short a value", () => {
    const r = templateIssues(
      { name: "t", components: [{ type: "BODY", text: POSITIONAL_BODY }] } as never,
      { bodyParams: ["a", "b"] } as never);
    expect(r.blocking.join(" ")).toMatch(/needs 3 values/);
  });
});
