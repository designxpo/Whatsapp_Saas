import { describe, it, expect } from "vitest";
import { checkEmail } from "../emailcheck";

describe("checkEmail", () => {
  it("accepts a normal address (trims + lowercases)", () => {
    expect(checkEmail("priya@company.com")).toEqual({ ok: true });
    expect(checkEmail("  Priya@Company.com ")).toEqual({ ok: true });
  });

  it("rejects malformed addresses", () => {
    expect(checkEmail("nope")).toEqual({ ok: false, reason: "format" });
    expect(checkEmail("a@b")).toEqual({ ok: false, reason: "format" });
    expect(checkEmail("")).toEqual({ ok: false, reason: "format" });
  });

  it("rejects disposable inboxes", () => {
    expect(checkEmail("x@mailinator.com")).toMatchObject({ ok: false, reason: "disposable" });
    expect(checkEmail("x@yopmail.com").ok).toBe(false);
  });

  it("passes a typo'd domain but returns a suggestion", () => {
    expect(checkEmail("priya@gmial.com")).toEqual({ ok: true, suggestion: "priya@gmail.com" });
  });
});
