import { describe, it, expect, vi, afterEach } from "vitest";
import { getRates, convert } from "../currency";

const res = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe("currency", () => {
  it("getRates fetches + normalizes, drops the base, sorts symbols in the query", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => res(200, { base: "INR", rates: { USD: 0.012, EUR: 0.011 } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await getRates("inr", ["USD", "EUR", "INR"]);   // INR (self) dropped
    expect(r.rates).toEqual({ USD: 0.012, EUR: 0.011 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("from")).toBe("INR");
    expect(url.searchParams.get("to")).toBe("EUR,USD");   // sorted
  });

  it("getRates returns empty on HTTP error and on a bad base code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500, {})));
    expect((await getRates("INR", ["JPY"])).rates).toEqual({});   // JPY key avoids the cache from test 1
    expect((await getRates("bad", ["USD"])).rates).toEqual({});
  });

  it("convert multiplies by the rate; identity for the same currency", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { rates: { AUD: 0.018 } })));
    expect(await convert(1000, "INR", "AUD")).toBeCloseTo(18);
    expect(await convert(500, "USD", "USD")).toBe(500);   // no fetch
  });
});
