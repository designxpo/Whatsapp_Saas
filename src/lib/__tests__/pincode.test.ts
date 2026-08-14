import { describe, it, expect, vi, afterEach } from "vitest";
import { isPincode, isPincodeField, findPincodeValue, lookupPincode, derivePincodeAttrs } from "../pincode";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const OK = [{ Status: "Success", PostOffice: [{ Name: "MG Road", District: "Bengaluru", State: "Karnataka" }] }];

afterEach(() => vi.unstubAllGlobals());

describe("pincode helpers", () => {
  it("isPincode accepts 6 digits (with spaces), rejects everything else", () => {
    expect(isPincode("560001")).toBe(true);
    expect(isPincode(" 560 001 ")).toBe(true);
    expect(isPincode("56001")).toBe(false);
    expect(isPincode("abcdef")).toBe(false);
  });

  it("isPincodeField matches the pincode type or a postal-ish key", () => {
    expect(isPincodeField("pincode", "whatever")).toBe(true);
    expect(isPincodeField("text", "pin_code")).toBe(true);
    expect(isPincodeField("text", "postal_code")).toBe(true);
    expect(isPincodeField("text", "city")).toBe(false);
  });

  it("findPincodeValue returns the 6-digit value under a postal-ish key", () => {
    expect(findPincodeValue({ full_name: "A", pincode: "560001" })).toBe("560001");
    expect(findPincodeValue({ city: "Bengaluru", phone: "9812345678" })).toBeNull();
    expect(findPincodeValue({ pin_code: "12" })).toBeNull(); // present but not 6 digits
  });

  it("lookupPincode maps India Post District→city + State", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, OK)));
    const r = await lookupPincode("560001");
    expect(r).toMatchObject({ pincode: "560001", city: "Bengaluru", district: "Bengaluru", state: "Karnataka" });
  });

  it("lookupPincode returns null on 'not found' and on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, [{ Status: "Error", PostOffice: null }])));
    expect(await lookupPincode("000000")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => res(500, {})));
    expect(await lookupPincode("560001")).toBeNull();
  });

  it("derivePincodeAttrs fills absent keys but never clobbers an answered city", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, OK)));
    expect(await derivePincodeAttrs({}, "560001")).toEqual({ city: "Bengaluru", state: "Karnataka", district: "Bengaluru" });
    expect(await derivePincodeAttrs({ city: "My Town" }, "560001")).toEqual({ state: "Karnataka", district: "Bengaluru" });
  });

  it("derivePincodeAttrs returns {} when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500, {})));
    expect(await derivePincodeAttrs({}, "560001")).toEqual({});
  });
});
