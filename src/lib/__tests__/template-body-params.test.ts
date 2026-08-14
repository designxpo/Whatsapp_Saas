import { describe, it, expect } from "vitest";
import { bodyParamCount } from "@/lib/whatsapp";

// The extension's side-panel prompts for exactly this many values before it lets
// an agent send a template (the 24h window is closed, so a template is the only
// way to reach the lead). Undercount → Meta rejects the send for a missing
// parameter; overcount → the agent is asked for values that don't exist.
//
// bodyParams fills {{1}}..{{n}} POSITIONALLY, so the contract is the HIGHEST
// index referenced, not the number of distinct placeholders.

const tpl = (text?: string, extra: { type: string; text?: string }[] = []) =>
  ({ components: [...(text === undefined ? [] : [{ type: "BODY", text }]), ...extra] });

describe("bodyParamCount", () => {
  it("counts sequential placeholders", () => {
    expect(bodyParamCount(tpl("Hi {{1}}, your order {{2}} ships {{3}}."))).toBe(3);
  });

  it("returns 0 for a body with no variables", () => {
    expect(bodyParamCount(tpl("We're open again from Monday."))).toBe(0);
  });

  it("counts a repeated placeholder once — it's one value, used twice", () => {
    expect(bodyParamCount(tpl("Thanks {{1}}! See you soon, {{1}}."))).toBe(1);
  });

  it("tolerates whitespace inside the braces", () => {
    // "{{1}} {{ 1 }}" is the same value: a distinct-string count would say 2.
    expect(bodyParamCount(tpl("Hi {{1}}, bye {{ 1 }}"))).toBe(1);
  });

  it("uses the highest index, so a body that skips {{1}} still needs 2 values", () => {
    // Positional fill means {{2}} cannot be supplied without also passing one
    // for slot 1 — reporting 1 here would produce a rejected send.
    expect(bodyParamCount(tpl("Your code is {{2}}."))).toBe(2);
  });

  it("handles double-digit indexes", () => {
    expect(bodyParamCount(tpl("{{9}} then {{10}}"))).toBe(10);
  });

  it("reads only the BODY component, ignoring header/footer/buttons", () => {
    expect(bodyParamCount(tpl("Hello {{1}}", [
      { type: "HEADER", text: "Order {{1}} update" },
      { type: "FOOTER", text: "Reply STOP to opt out" },
    ]))).toBe(1);
  });

  it("is case-insensitive about the component type", () => {
    expect(bodyParamCount({ components: [{ type: "body", text: "Hi {{1}} {{2}}" }] })).toBe(2);
  });

  it("returns 0 when there is no BODY component at all", () => {
    expect(bodyParamCount(tpl(undefined, [{ type: "HEADER", text: "Hi {{1}}" }]))).toBe(0);
  });

  it("survives a missing/empty components array", () => {
    expect(bodyParamCount({ components: [] })).toBe(0);
    expect(bodyParamCount({ components: undefined as unknown as [] })).toBe(0);
  });

  it("ignores malformed braces", () => {
    expect(bodyParamCount(tpl("Hi {1}, {{}} {{a}} {{ }}"))).toBe(0);
  });
});
