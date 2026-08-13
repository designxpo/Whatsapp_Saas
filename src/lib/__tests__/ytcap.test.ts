import { describe, it, expect, vi } from "vitest";
import type { PlanLimits } from "../plans";

// getYtDailyReplyCap resolves the tenant's plan limit against the platform default.
vi.mock("../usage", () => ({ getPlanLimits: vi.fn() }));
vi.mock("../supabase", () => ({ db: () => ({}) }));

import { getYtDailyReplyCap, YT_REPLY_DAILY_CAP } from "../ytcomments";
import { getPlanLimits } from "../usage";

const limits = (yt: number): PlanLimits => ({
  contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 0, team_seats: 0, yt_comment_replies_per_day: yt,
});

describe("getYtDailyReplyCap", () => {
  it("uses the plan's per-day limit when the tier sets one (the upgrade lever)", async () => {
    vi.mocked(getPlanLimits).mockResolvedValue(limits(500));
    expect(await getYtDailyReplyCap("t1")).toBe(500);
  });

  it("falls back to the platform default when the plan sets 0 (not unlimited)", async () => {
    vi.mocked(getPlanLimits).mockResolvedValue(limits(0));
    expect(await getYtDailyReplyCap("t1")).toBe(YT_REPLY_DAILY_CAP);
  });

  it("falls back to the platform default if the plan lookup throws", async () => {
    vi.mocked(getPlanLimits).mockRejectedValue(new Error("db down"));
    expect(await getYtDailyReplyCap("t1")).toBe(YT_REPLY_DAILY_CAP);
  });
});
