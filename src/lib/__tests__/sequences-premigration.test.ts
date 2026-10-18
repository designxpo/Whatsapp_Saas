// Saving a journey when migrations 0100 and 0101 have not been applied yet.
//
// A deploy lands the moment main is pushed; a migration is run by a person,
// later. 0092 onwards were still pending when the lanes shipped, so for some
// window the code writes `team` and `aida_stage` to a table that has neither.
//
// Postgres fails the WHOLE statement on an unknown column. Without a ladder
// that means every sequence save in the portal breaks — not the new fields
// degrading, the entire feature — until somebody notices and runs the SQL.
//
// Two migrations now, and the rungs are independent: 0101 can land while 0100
// is still pending, or both can be. Each rung is tested on its own rather than
// by counting writes, because a count passes for the wrong reason the moment a
// third column group appears.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Attempt = { table: string; payload: Record<string, unknown> };
let attempts: Attempt[] = [];

/** Which column groups the pretend table is missing. */
let missing: { lanes: boolean; rules: boolean } = { lanes: false, rules: false };

const LANE_COLS = ["team", "aida_stage"];
const RULE_COLS = ["stop_on_reply", "send_start_hour", "send_end_hour"];

const err = (col: string) => ({ code: "42703", message: `column "${col}" of relation "wa_sequences" does not exist` });

function chain(table: string) {
  let payload: Record<string, unknown> = {};
  let op: "insert" | "update" | null = null;
  const result = () => {
    // Newest group first: a payload carrying both is refused for the newest
    // missing column, exactly as Postgres would.
    if (missing.rules) {
      const hit = RULE_COLS.find(c => c in payload);
      if (hit) return { data: null, error: err(hit) };
    }
    if (missing.lanes) {
      const hit = LANE_COLS.find(c => c in payload);
      if (hit) return { data: null, error: err(hit) };
    }
    return { data: { id: "s1", name: payload.name ?? "x", ...payload }, error: null };
  };
  const o: Record<string, unknown> = {
    insert: (p: Record<string, unknown>) => { op = "insert"; payload = p; attempts.push({ table, payload: p }); return o; },
    update: (p: Record<string, unknown>) => { op = "update"; payload = p; attempts.push({ table, payload: p }); return o; },
    select: () => o,
    eq: () => o,
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (res: (v: unknown) => unknown) => Promise.resolve(op ? result() : { data: [], error: null }).then(res),
  };
  return o;
}
vi.mock("../supabase", () => ({ db: () => ({ from: (t: string) => chain(t) }) }));
vi.mock("../leadsquared", () => ({ pushWaActivity: async () => undefined }));
vi.mock("../lanes", () => ({
  leadLane: async () => "marketing", laneAllows: () => true,
  isLane: (v: unknown) => v === "marketing" || v === "sales",
  isAidaStage: (v: unknown) => typeof v === "string" && ["attention","interest","desire","action","retention"].includes(v),
}));

import { createSequence, updateSequence } from "../sequences";

beforeEach(() => { attempts = []; missing = { lanes: false, rules: false }; });

const last = () => attempts[attempts.length - 1].payload;

describe("when both migrations ARE applied", () => {
  it("stores the lane, the stage and the new rules in one write", async () => {
    await createSequence({ name: "Hot lead nurture", team: "sales", aidaStage: "desire", sendStartHour: 10, sendEndHour: 20 });
    expect(attempts).toHaveLength(1);
    expect(attempts[0].payload).toMatchObject({
      team: "sales", aida_stage: "desire",
      stop_on_reply: true, send_start_hour: 10, send_end_hour: 20,
    });
  });

  it("defaults stop_on_reply to true when the caller says nothing", async () => {
    await createSequence({ name: "n" });
    expect(attempts[0].payload).toMatchObject({ stop_on_reply: true });
  });

  it("an explicit false survives — it is not treated as unset", async () => {
    await createSequence({ name: "order updates", stopOnReply: false });
    expect(attempts[0].payload).toMatchObject({ stop_on_reply: false });
  });
});

describe("when 0101 is missing but 0100 is applied", () => {
  beforeEach(() => { missing = { lanes: false, rules: true }; });

  it("keeps the lane and drops only the new rules", async () => {
    const seq = await createSequence({ name: "Hot lead nurture", team: "sales", aidaStage: "desire" });
    expect(seq.name).toBe("Hot lead nurture");
    expect(last()).toMatchObject({ team: "sales", aida_stage: "desire" });
    expect(last()).not.toHaveProperty("stop_on_reply");
  });

  it("still saves an edit that also carried a window", async () => {
    await updateSequence("s1", { name: "Renamed", team: "sales", sendStartHour: 10 });
    expect(last()).toEqual({ name: "Renamed", team: "sales" });
  });
});

describe("when neither migration is applied", () => {
  beforeEach(() => { missing = { lanes: true, rules: true }; });

  it("still creates the journey, unfiled and unrestricted", async () => {
    // Which is exactly how every sequence behaved before either migration.
    const seq = await createSequence({ name: "Hot lead nurture", team: "sales", aidaStage: "desire", sendStartHour: 10, sendEndHour: 20 });
    expect(seq.name).toBe("Hot lead nurture");
    expect(last()).toEqual({
      // Every row is stamped with its owner; the lane columns are what get dropped.
      tenant_id: "00000000-0000-0000-0000-000000000001",
      name: "Hot lead nurture", channel_id: null, platform: "whatsapp",
      trigger_kind: "manual", trigger_value: null,
    });
  });

  it("still saves an EDIT, keeping every field the table does have", async () => {
    // The dangerous one: without this, renaming a sequence or switching it off
    // would fail because the form also submits a lane.
    await updateSequence("s1", { name: "Renamed", active: false, team: "sales", aidaStage: "desire", stopOnReply: true });
    expect(last()).toEqual({ name: "Renamed", active: false });
  });

  it("does not fire a pointless extra write when the lane was all there was", async () => {
    await updateSequence("s1", { team: "sales" });
    expect(attempts).toHaveLength(1);
  });

  it("does not fire a pointless extra write when a rule was all there was", async () => {
    await updateSequence("s1", { stopOnReply: false });
    expect(attempts).toHaveLength(1);
  });

  it("a sequence READ back with no columns still behaves as it always did", async () => {
    // mapSeq must not turn an absent stop_on_reply into a disabled rule.
    const seq = await createSequence({ name: "n" });
    expect(seq.stopOnReply).toBe(true);
    expect(seq.sendStartHour).toBeNull();
    expect(seq.sendEndHour).toBeNull();
  });
});

describe("a real database error is not swallowed", () => {
  it("throws rather than retrying, so a genuine failure still surfaces", async () => {
    // The ladder must key on the missing-column codes only. Retrying on any
    // error would turn a constraint violation into a silent half-write.
    vi.resetModules();
    vi.doMock("../supabase", () => ({
      db: () => ({ from: () => ({
        insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) }),
      }) }),
    }));
    const { createSequence: create } = await import("../sequences");
    await expect(create({ name: "dupe", team: "sales" })).rejects.toMatchObject({ code: "23505" });
    vi.doUnmock("../supabase");
    vi.resetModules();
  });
});
