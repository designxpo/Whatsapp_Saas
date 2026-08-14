import { describe, it, expect, vi, afterEach } from "vitest";
import { isIfsc, isIfscField, lookupIfsc, deriveIfscAttrs } from "../ifsc";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const OK = { BANK: "State Bank of India", BRANCH: "MG Road", CITY: "Bengaluru", STATE: "Karnataka" };

afterEach(() => vi.unstubAllGlobals());

describe("ifsc helpers", () => {
  it("isIfsc validates the 11-char format (case/space-insensitive)", () => {
    expect(isIfsc("SBIN0001234")).toBe(true);
    expect(isIfsc(" sbin0001234 ")).toBe(true);
    expect(isIfsc("SBIN1001234")).toBe(false); // 5th char must be 0
    expect(isIfsc("SBIN000123")).toBe(false);  // too short
  });

  it("isIfscField matches the ifsc type or a bank-code key", () => {
    expect(isIfscField("ifsc", "whatever")).toBe(true);
    expect(isIfscField("text", "ifsc_code")).toBe(true);
    expect(isIfscField("text", "bank_code")).toBe(true);
    expect(isIfscField("text", "city")).toBe(false);
  });

  it("lookupIfsc maps BANK/BRANCH (and uppercases the code)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, OK)));
    const r = await lookupIfsc("sbin0001234");
    expect(r).toMatchObject({ ifsc: "SBIN0001234", bank: "State Bank of India", branch: "MG Road" });
  });

  it("lookupIfsc returns null on 404 and on a malformed code (no fetch)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(404, {})));
    expect(await lookupIfsc("SBIN0001234")).toBeNull();
    expect(await lookupIfsc("nope")).toBeNull();
  });

  it("deriveIfscAttrs fills absent bank/branch but never clobbers an answered bank", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, OK)));
    expect(await deriveIfscAttrs({}, "SBIN0001234")).toEqual({ bank: "State Bank of India", bank_branch: "MG Road" });
    expect(await deriveIfscAttrs({ bank: "My Bank" }, "SBIN0001234")).toEqual({ bank_branch: "MG Road" });
  });
});
