import { describe, it, expect, vi, afterEach } from "vitest";
import { adminFetch } from "../adminfetch";

// `nonJson` reproduces Next's HTML 404/500 page: res.json() rejects.
const res = (status: number, body?: unknown, nonJson = false) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => { if (nonJson) throw new SyntaxError("Unexpected token <"); return body; },
  }) as Response;

afterEach(() => vi.unstubAllGlobals());

describe("adminFetch", () => {
  it("returns the parsed body on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { optouts: [{ phone: "919876543210" }] })));
    const r = await adminFetch<{ optouts: { phone: string }[] }>("/api/admin/optouts");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.optouts).toHaveLength(1);
  });

  it("only sends Content-Type when there is a body", async () => {
    const seen: (RequestInit | undefined)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_: string, init?: RequestInit) => { seen.push(init); return res(200, {}); }));
    await adminFetch("/api/admin/optouts");
    await adminFetch("/api/admin/optouts", { method: "DELETE", body: { phone: "91" } });
    expect(seen[0]).toMatchObject({ method: "GET", headers: undefined, body: undefined });
    expect(seen[1]).toMatchObject({ method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "91" }) });
  });

  it("names an expired session on 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(401, { error: "Unauthorized" })));
    const r = await adminFetch("/api/admin/optouts", { method: "POST", body: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/session has expired/i);
  });

  it("explains a stale-deploy HTML 404 instead of the raw status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(404, undefined, true)));
    const r = await adminFetch("/api/admin/not-deployed-yet");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/latest update/i);
  });

  it("prefers the route's own message over the generic one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(402, { error: "Your plan doesn't include Broadcast." })));
    const r = await adminFetch("/api/admin/broadcast", { method: "POST", body: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Your plan doesn't include Broadcast.");
  });

  it("reports a network failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const r = await adminFetch("/api/admin/optouts");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(0); expect(r.error).toMatch(/check your connection/i); }
  });

  it("falls back to the status code when a non-OK response carries no message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(418, {})));
    const r = await adminFetch("/api/admin/optouts");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Request failed (418)");
  });
});
