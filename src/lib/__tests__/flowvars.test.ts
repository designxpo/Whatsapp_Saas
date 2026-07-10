import { describe, it, expect } from "vitest";
import { fillVars, validateInput } from "../flowengine";

describe("fillVars", () => {
  const c = { name: "Riya Sharma", phone: "919999000011", email: "riya@x.com", attributes: { course: "Generative AI", City: "Noida" } };

  it("fills built-ins and attributes (case-insensitive), first name for {{name}}", () => {
    expect(fillVars("Hi {{name}}!", c)).toBe("Hi Riya!");
    expect(fillVars("Our {{course}} certification", c)).toBe("Our Generative AI certification");
    expect(fillVars("You're in {{city}}", c)).toBe("You're in Noida");          // attribute key was "City"
    expect(fillVars("{{full_name}} · {{phone}} · {{email}}", c)).toBe("Riya Sharma · 919999000011 · riya@x.com");
  });

  it("resolves unknown tokens to empty and leaves plain text untouched", () => {
    expect(fillVars("Hello {{unknown}}", c)).toBe("Hello ");
    expect(fillVars("no placeholders here", c)).toBe("no placeholders here");
    expect(fillVars("Our {{course}}", null)).toBe("Our ");                     // no contact → tokens still stripped
  });
});

describe("validateInput (deterministic types)", () => {
  it("validates email / phone / number; passes through unknown types", async () => {
    expect(await validateInput("email", "a@b.com")).toBe(true);
    expect(await validateInput("email", "Ingl")).toBe(false);
    expect(await validateInput("phone", "+91 99990 00011")).toBe(true);
    expect(await validateInput("phone", "hello")).toBe(false);
    expect(await validateInput("number", "25000")).toBe(true);
    expect(await validateInput("number", "lots")).toBe(false);
    expect(await validateInput("none", "anything")).toBe(true);
    expect(await validateInput("city", "")).toBe(false);   // empty fails before any AI call
  });
});
