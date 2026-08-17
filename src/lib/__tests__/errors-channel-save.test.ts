import { describe, it, expect } from "vitest";
import { describeChannelSaveError } from "../errors";

// Every channel-save route used to append "— make sure migrations X and Y are
// applied" to EVERY failure unconditionally, whether or not that was the real
// cause — a network blip or a bad phoneId got told to "apply a migration,"
// an instruction no tenant can act on. Only the actual missing-column
// signature (Postgres 42703 / PostgREST's PGRST204) should trigger the hint.

describe("describeChannelSaveError", () => {
  it("appends the migration hint when Postgres reports a missing column (42703)", () => {
    const msg = describeChannelSaveError(new Error('column "coex" does not exist (42703)'), "migration 0078_coex.sql");
    expect(msg).toMatch(/apply migration 0078_coex\.sql/);
  });

  it("appends the migration hint on PostgREST's schema-cache code (PGRST204)", () => {
    const msg = describeChannelSaveError({ message: "PGRST204: column not found in schema cache" }, "migrations 0013 and 0070");
    expect(msg).toMatch(/apply migrations 0013 and 0070/);
  });

  it("does NOT append the migration hint for an unrelated failure", () => {
    const msg = describeChannelSaveError(new Error("fetch failed: network timeout"), "migration 0093_youtube_comments.sql");
    expect(msg).not.toMatch(/migration/i);
    expect(msg).toMatch(/network timeout/);
    expect(msg).toMatch(/contact support/i);
  });

  it("does not tell a tenant to apply a migration for a bad phoneId / validation error", () => {
    const msg = describeChannelSaveError(new Error("Couldn't verify this phone number with Meta: invalid phone_number_id"), "migrations 0013_channels.sql and 0070_channel_kb.sql");
    expect(msg).not.toMatch(/migration/i);
  });

  it("still surfaces the underlying message either way", () => {
    const withHint = describeChannelSaveError(new Error("column \"foo\" does not exist"), "migration X");
    const withoutHint = describeChannelSaveError(new Error("some other db error"), "migration X");
    expect(withHint).toContain("column \"foo\" does not exist");
    expect(withoutHint).toContain("some other db error");
  });
});
