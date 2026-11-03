import { describe, it, expect, vi } from "vitest";
import { memdb } from "./helpers/memdb";

// claimTenantSettingOnce gates "once per day / once ever" sends (daily digest,
// weekly recap, onboarding nudge). The first caller wins; later callers learn
// it's taken without a database error (a plain insert logged a duplicate-key
// ERROR for every workspace on every cron tick).

describe("claimTenantSettingOnce", () => {
  it("lets exactly one caller claim a key, per workspace, without an error", async () => {
    const m = memdb({ wa_settings: [["tenant_id", "key"]] });
    vi.doMock("../supabase", () => ({ db: () => m.client }));
    const { claimTenantSettingOnce } = await import("../store");
    expect(await claimTenantSettingOnce("t1", "daily_digest:2026-11-03")).toBe(true);
    expect(await claimTenantSettingOnce("t1", "daily_digest:2026-11-03")).toBe(false);
    expect(await claimTenantSettingOnce("t2", "daily_digest:2026-11-03")).toBe(true);
    expect(m.tables.wa_settings).toHaveLength(2);
  });
});
