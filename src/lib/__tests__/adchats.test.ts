import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the maintenance + context helpers from the DB / settings layers.
const supa = vi.hoisted(() => ({ db: vi.fn() }));
const store = vi.hoisted(() => ({ getTenantSetting: vi.fn(), setTenantSetting: vi.fn() }));
vi.mock("../supabase", () => ({ db: supa.db }));
vi.mock("../store", () => ({ getTenantSetting: store.getTenantSetting, setTenantSetting: store.setTenantSetting }));
vi.mock("../tenantdb", () => ({ tdb: vi.fn() }));   // only used by the CRUD fns, not these

import { purgeOldAdChats, getAdContext, setAdContext } from "../adchats";

beforeEach(() => { supa.db.mockReset(); store.getTenantSetting.mockReset(); store.setTenantSetting.mockReset(); });

describe("purgeOldAdChats — 30-day auto-expiry", () => {
  it("deletes rows older than the cutoff and returns how many were removed", async () => {
    const lt = vi.fn();
    supa.db.mockReturnValue({ from: () => ({ delete: () => ({ lt: (col: string, val: string) => { lt(col, val); return { select: () => Promise.resolve({ data: [{ id: "a" }, { id: "b" }], error: null }) }; } }) }) });

    const removed = await purgeOldAdChats(30);

    expect(removed).toBe(2);
    expect(lt).toHaveBeenCalledWith("updated_at", expect.any(String));
    const cutoffAgeMs = Date.now() - new Date(lt.mock.calls[0][1]).getTime();
    expect(cutoffAgeMs).toBeGreaterThan(29 * 86_400_000);   // ~30 days back
    expect(cutoffAgeMs).toBeLessThan(31 * 86_400_000);
  });

  it("returns 0 (never throws) when the delete errors", async () => {
    supa.db.mockReturnValue({ from: () => ({ delete: () => ({ lt: () => ({ select: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) });
    expect(await purgeOldAdChats()).toBe(0);
  });
});

describe("saved context — one small settings row", () => {
  it("reads via getTenantSetting and caps at 4000 chars", async () => {
    store.getTenantSetting.mockResolvedValue("x".repeat(5000));
    const c = await getAdContext("tenant1");
    expect(c).toHaveLength(4000);
    expect(store.getTenantSetting).toHaveBeenCalledWith("tenant1", "ad_chat_context", "");
  });

  it("returns '' when nothing is saved", async () => {
    store.getTenantSetting.mockResolvedValue("");
    expect(await getAdContext("tenant1")).toBe("");
  });

  it("trims and caps on save, writing the single ad_chat_context key", async () => {
    store.setTenantSetting.mockResolvedValue(undefined);
    await setAdContext("   Vegan skincare, warm tone.   ", "tenant1");
    expect(store.setTenantSetting).toHaveBeenCalledWith("tenant1", "ad_chat_context", "Vegan skincare, warm tone.");
  });
});
