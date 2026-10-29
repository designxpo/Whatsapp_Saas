import { describe, it, expect, afterEach } from "vitest";
import { bookingKey, bookingPhone, LINK_KEY_RE, matchOfferedTime, mezmitraBase, pickOutlet, rupees, type MezOutlet } from "../mezmitra";
import { readIdempotencyKey, requestHash } from "../idempotency";

const outlet = (over: Partial<MezOutlet>): MezOutlet => ({
  id: "o1", name: "Courtyard", address: null, city: "Indore", phone: null, timezone: "Asia/Kolkata",
  opening_hours: null, online_booking: { enabled: true, max_party: 8, days_ahead: 30 }, ...over,
});

// Saturday 7 Nov 2026 in IST.
const SLOTS = [
  { start: "2026-11-07T06:30:00.000Z", label: "12:00 pm" },
  { start: "2026-11-07T14:00:00.000Z", label: "7:30 pm" },
  { start: "2026-11-07T14:30:00.000Z", label: "8:00 pm" },
];

describe("mezmitraBase", () => {
  const before = { url: process.env.MEZMITRA_API_URL, env: process.env.NODE_ENV };
  afterEach(() => {
    process.env.MEZMITRA_API_URL = before.url;
    (process.env as Record<string, string | undefined>).NODE_ENV = before.env;
  });
  it("comes only from server config, and must be https in production", () => {
    delete process.env.MEZMITRA_API_URL;
    expect(mezmitraBase()).toBeNull();
    process.env.MEZMITRA_API_URL = "https://app.mezmitra.com/";
    expect(mezmitraBase()).toBe("https://app.mezmitra.com");
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.MEZMITRA_API_URL = "http://app.mezmitra.com";
    expect(mezmitraBase()).toBeNull();
    process.env.MEZMITRA_API_URL = "not a url";
    expect(mezmitraBase()).toBeNull();
  });
});

describe("matchOfferedTime", () => {
  it("matches only times Mezmitra offered", () => {
    expect(matchOfferedTime("8:00 pm", SLOTS, "Asia/Kolkata")?.start).toBe("2026-11-07T14:30:00.000Z");
    expect(matchOfferedTime("8pm", SLOTS, "Asia/Kolkata")?.start).toBe("2026-11-07T14:30:00.000Z");
    expect(matchOfferedTime("20:00", SLOTS, "Asia/Kolkata")?.start).toBe("2026-11-07T14:30:00.000Z");
    expect(matchOfferedTime("7.30 pm", SLOTS, "Asia/Kolkata")?.start).toBe("2026-11-07T14:00:00.000Z");
    expect(matchOfferedTime("12 pm", SLOTS, "Asia/Kolkata")?.start).toBe("2026-11-07T06:30:00.000Z");
  });
  it("refuses a time that was not offered, or a guess", () => {
    expect(matchOfferedTime("9pm", SLOTS, "Asia/Kolkata")).toBeNull();
    expect(matchOfferedTime("tonight", SLOTS, "Asia/Kolkata")).toBeNull();
    expect(matchOfferedTime("2026-11-07T15:00:00.000Z", SLOTS, "Asia/Kolkata")).toBeNull();
    expect(matchOfferedTime("", SLOTS, "Asia/Kolkata")).toBeNull();
  });
});

describe("pickOutlet", () => {
  const a = outlet({ id: "a", name: "Courtyard Indore", city: "Indore" });
  const b = outlet({ id: "b", name: "Courtyard Bhopal", city: "Bhopal" });
  it("uses the only outlet, a named one, or the default", () => {
    expect(pickOutlet([a], undefined, null)?.id).toBe("a");
    expect(pickOutlet([a, b], "bhopal", null)?.id).toBe("b");
    expect(pickOutlet([a, b], "Courtyard Indore", null)?.id).toBe("a");
    expect(pickOutlet([a, b], undefined, "b")?.id).toBe("b");
  });
  it("asks rather than guesses when it is ambiguous", () => {
    expect(pickOutlet([a, b], undefined, null)).toBeNull();
    expect(pickOutlet([a, b], "courtyard", null)).toBeNull();
    expect(pickOutlet([a, b], "Mumbai", "a")).toBeNull();
  });
});

describe("small helpers", () => {
  it("formats prices in rupees", () => {
    expect(rupees(25000)).toBe("₹250");
    expect(rupees(18050)).toBe("₹180.50");
    expect(rupees(125000)).toBe("₹1,250");
  });
  it("normalizes a phone for booking, refusing junk", () => {
    expect(bookingPhone("919876543210")).toBe("+919876543210");
    expect(bookingPhone("98765 43210")).toBe("+919876543210");
    expect(bookingPhone("+1 415 555 0100")).toBe("+14155550100");
    expect(bookingPhone("12345")).toBeNull();
    expect(bookingPhone("09876543210")).toBeNull();
  });
  it("keys the same booking request the same way, and different ones differently", () => {
    const p = { outletId: "o", slotStart: SLOTS[2].start, partySize: 2, phone: "+919876543210" };
    const at = Date.parse("2026-11-01T10:01:00Z");
    expect(bookingKey("t", p, at)).toBe(bookingKey("t", { ...p }, at + 60_000));
    expect(bookingKey("t", p, at)).not.toBe(bookingKey("t", { ...p, partySize: 3 }, at));
    expect(bookingKey("t", p, at)).not.toBe(bookingKey("t2", p, at));
    // A later request for the same table is a new request, not a replay of an old (maybe cancelled) one.
    expect(bookingKey("t", p, at)).not.toBe(bookingKey("t", p, at + 3600_000));
  });
  it("recognises a link key", () => {
    expect(LINK_KEY_RE.test(`mzk_${"A".repeat(43)}`)).toBe(true);
    expect(LINK_KEY_RE.test("mzk_short")).toBe(false);
    expect(LINK_KEY_RE.test(`ak_live_${"a".repeat(48)}`)).toBe(false);
  });
  it("reads an Idempotency-Key header", () => {
    expect(readIdempotencyKey(null)).toEqual({ key: null });
    expect(readIdempotencyKey("3f1c2a9e-0d4b-4c55")).toEqual({ key: "3f1c2a9e-0d4b-4c55" });
    expect(readIdempotencyKey("short").error).toBeTruthy();
    expect(readIdempotencyKey("has spaces in it").error).toBeTruthy();
    expect(requestHash("a")).not.toBe(requestHash("b"));
  });
});
