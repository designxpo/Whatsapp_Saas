import { describe, it, expect, vi, afterEach } from "vitest";
import { deriveFieldAttrs } from "../fieldenrich";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe("deriveFieldAttrs (shared smart-field enricher)", () => {
  it("routes a postal-code field → city/state/district", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, [{ Status: "Success", PostOffice: [{ District: "Pune", State: "Maharashtra" }] }])));
    expect(await deriveFieldAttrs("pincode", "pincode", "411001", {})).toMatchObject({ city: "Pune", state: "Maharashtra" });
  });

  it("routes an IFSC field → bank/branch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { BANK: "HDFC Bank", BRANCH: "Camp" })));
    expect(await deriveFieldAttrs("ifsc", "ifsc", "HDFC0000123", {})).toEqual({ bank: "HDFC Bank", bank_branch: "Camp" });
  });

  it("returns {} for an ordinary field without touching the network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not fetch"); }));
    expect(await deriveFieldAttrs("text", "full_name", "Priyesh", {})).toEqual({});
  });
});
