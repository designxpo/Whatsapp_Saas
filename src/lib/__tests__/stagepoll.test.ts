// The stage poll's job is to replace a LeadSquared Automation that cannot be
// created by API. What makes it safe is not the reading — it is the three
// rails around the sending, so those are what these tests are about:
//
//   1. the first pass enrols nobody (a thousand parked leads are not new)
//   2. a pass is capped, and the watermark only moves as far as it got
//   3. a lead that throws does not strand the queue behind it
//
// Plus the things a cron pass must never do: run when disabled, run when the
// LeadSquared pause switch is on, or lose a lead in the gap between passes.
import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, unknown>();
const applied: { phone: string | null; stage: string | null }[] = [];
let leadsResult: { changed: { ev: Record<string, unknown>; modifiedAt: number }[]; scanned: number; truncated: boolean; error?: string };
let paused = false;
let configured = true;
let applyThrowsOn: string | null = null;
let applyDripFor: Set<string> = new Set();
let lastQuery: { stage: string; sinceMs: number; max: number } | null = null;
const knownContacts = new Map<string, { phone: string; attributes: Record<string, string> }>();
let drips: { stage: string; sequenceId: string }[] = [];

vi.mock("../store", () => ({
  getSetting: async (k: string, fallback: unknown) => (settings.has(k) ? settings.get(k) : fallback),
  setSetting: async (k: string, v: unknown) => { settings.set(k, v); },
  // This codebase scopes settings by tenant; the fake keeps one namespace because
  // each test is a single workspace.
  getTenantSetting: async (_t: string, k: string, fallback: unknown) => (settings.has(k) ? settings.get(k) : fallback),
  setTenantSetting: async (_t: string, k: string, v: unknown) => { settings.set(k, v); },
  getContactByPhoneLoose: async (p: string) => knownContacts.get(p) ?? null,
}));

vi.mock("../stagedrips", () => ({
  getStageDrips: async () => drips,
  stageTransition: (prev: string | undefined, next: string) => ({
    enroll: drips.find((d: { stage: string }) => d.stage === next)?.sequenceId ?? null,
    stop: [],
  }),
}));

vi.mock("../leadsquared", () => ({
  lsqConfigured: async () => configured,
  lsqPaused: async () => paused,
  leadsOnStageSince: async (stage: string, sinceMs: number, max: number) => {
    lastQuery = { stage, sinceMs, max };
    return leadsResult;
  },
}));

vi.mock("../lsqapply", () => ({
  applyLsqLead: async (ev: { phone: string | null; stage: string | null }) => {
    if (applyThrowsOn && ev.phone === applyThrowsOn) throw new Error("boom");
    applied.push({ phone: ev.phone, stage: ev.stage });
    return {
      handled: true,
      phone: `…${String(ev.phone).slice(-4)}`,
      ...(applyDripFor.has(String(ev.phone)) ? { drip: { enrolled: "seq-1", stopped: 0 } } : {}),
    };
  },
}));

const { runStagePoll, getStagePoll, setStagePoll, STAGE_POLL_KEY } = await import("../stagepoll");

const lead = (phone: string, modifiedAt: number) => ({
  modifiedAt,
  ev: { event: "stage_changed", phone, name: "T", email: null, ownerEmail: null, ownerName: null, stage: "Not Reachable", leadScore: null, leadId: null, source: null },
});

const NOW = new Date("2026-10-09T12:00:00.000Z");

beforeEach(() => {
  settings.clear();
  applied.length = 0;
  leadsResult = { changed: [], scanned: 0, truncated: false };
  paused = false;
  configured = true;
  applyThrowsOn = null;
  applyDripFor = new Set();
  lastQuery = null;
  knownContacts.clear();
  drips = [];
});

describe("the switches that keep it off", () => {
  it("does nothing at all until it is enabled", async () => {
    const r = await runStagePoll({ now: NOW });
    expect(r).toEqual({ ran: false, reason: "disabled" });
    expect(lastQuery).toBeNull();
  });

  it("does nothing without a stage, because 'every lead' is not a stage", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "   " });
    expect((await runStagePoll({ now: NOW })).reason).toBe("no stage configured");
    expect(lastQuery).toBeNull();
  });

  it("respects the LeadSquared pause switch — reading is touching", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    paused = true;
    expect((await runStagePoll({ now: NOW })).reason).toBe("LeadSquared sync is paused");
    expect(lastQuery).toBeNull();
  });

  it("does nothing when LeadSquared isn't configured", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable" });
    configured = false;
    expect((await runStagePoll({ now: NOW })).reason).toBe("LeadSquared isn't configured");
  });
});

describe("rail 1 — the first pass enrols nobody", () => {
  it("seeds the watermark and applies nothing, however many leads are parked on the stage", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable" });
    leadsResult = { changed: Array.from({ length: 1000 }, (_, i) => lead(`9${i}`.padEnd(12, "0"), Date.now())), scanned: 1000, truncated: false };

    const r = await runStagePoll({ now: NOW });

    expect(r.seeded).toBe(true);
    expect(r.applied).toBe(0);
    expect(applied).toHaveLength(0);
    // It did not even ask — there is nothing a first pass could do with the answer.
    expect(lastQuery).toBeNull();
    expect((await getStagePoll()).watermark).toBe(NOW.toISOString());
  });

  it("seeds only once — the pass after it does real work", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable" });
    await runStagePoll({ now: NOW });

    leadsResult = { changed: [lead("919000000001", Date.parse("2026-10-09T12:05:00.000Z"))], scanned: 1, truncated: false };
    const r = await runStagePoll({ now: new Date("2026-10-09T12:10:00.000Z") });

    expect(r.seeded).toBeUndefined();
    expect(r.applied).toBe(1);
    expect(applied).toEqual([{ phone: "919000000001", stage: "Not Reachable" }]);
  });
});

describe("rail 2 — a pass is capped and the watermark follows the work", () => {
  it("applies at most maxPerRun, and leaves the rest for the next pass", async () => {
    settings.set(STAGE_POLL_KEY, {
      enabled: true, mode: "apply", stage: "Not Reachable", maxPerRun: 3,
      watermark: "2026-10-09T11:00:00.000Z",
    });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = {
      changed: [0, 1, 2, 3, 4].map(i => lead(`91900000000${i}`, base + i * 1000)),
      scanned: 5, truncated: false,
    };

    const r = await runStagePoll({ now: NOW });

    expect(r.candidates).toBe(5);
    expect(r.applied).toBe(3);
    expect(applied.map(a => a.phone)).toEqual(["919000000000", "919000000001", "919000000002"]);
    // The watermark stops at the LAST LEAD APPLIED, not at `now` — otherwise
    // the two that did not fit would be skipped over and never sent.
    expect((await getStagePoll()).watermark).toBe(new Date(base + 2000).toISOString());
  });

  it("a nonsense maxPerRun in the settings row falls back instead of being obeyed", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", maxPerRun: 0, burstAlarm: -5 });
    const cfg = await getStagePoll();
    expect(cfg.maxPerRun).toBe(50);
    expect(cfg.burstAlarm).toBe(200);
  });

  it("moves the watermark to now when nothing changed, so quiet passes don't re-read", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    const r = await runStagePoll({ now: NOW });
    expect(r.candidates).toBe(0);
    expect(r.watermark).toBe(NOW.toISOString());
  });

  it("re-reads a two-minute overlap, so a lead modified in the watermark's own second is not lost", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    await runStagePoll({ now: NOW });
    expect(lastQuery!.sinceMs).toBe(Date.parse("2026-10-09T11:00:00.000Z") - 2 * 60_000);
  });
});

describe("rail 3 — one bad lead does not strand the queue", () => {
  it("carries on past a lead that throws, and still advances past it", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = {
      changed: [lead("919000000001", base), lead("919000000002", base + 1000), lead("919000000003", base + 2000)],
      scanned: 3, truncated: false,
    };
    applyThrowsOn = "919000000002";

    const r = await runStagePoll({ now: NOW });

    expect(applied.map(a => a.phone)).toEqual(["919000000001", "919000000003"]);
    expect(r.applied).toBe(2);
    // Past the failure, deliberately: a lead that throws every time would
    // otherwise hold the watermark still and re-read the whole queue forever.
    expect((await getStagePoll()).watermark).toBe(new Date(base + 2000).toISOString());
  });

  it("a failed READ leaves the watermark exactly where it was", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    leadsResult = { changed: [], scanned: 0, truncated: false, error: "LeadSquared search failed (HTTP 429)." };

    const r = await runStagePoll({ now: NOW });

    expect(r.error).toContain("429");
    expect((await getStagePoll()).watermark).toBe("2026-10-09T11:00:00.000Z");
    expect((await getStagePoll()).lastError).toContain("429");
  });
});

describe("what it reports", () => {
  it("flags a burst but still drains it", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", maxPerRun: 2, burstAlarm: 3, watermark: "2026-10-09T11:00:00.000Z" });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = { changed: [0, 1, 2, 3].map(i => lead(`91900000000${i}`, base + i * 1000)), scanned: 4, truncated: false };

    const r = await runStagePoll({ now: NOW });

    expect(r.burst).toBe(true);
    expect(r.applied).toBe(2);           // alarmed, not stopped
  });

  it("counts enrolments separately from applications", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = { changed: [lead("919000000001", base), lead("919000000002", base + 1000)], scanned: 2, truncated: false };
    applyDripFor = new Set(["919000000001"]);

    const r = await runStagePoll({ now: NOW });

    // Both leads were applied; only one was actually new to the stage. That
    // difference is the whole point of the idempotency guard, so it is
    // reported rather than hidden behind a single number.
    expect(r.applied).toBe(2);
    expect(r.enrolled).toBe(1);
  });

  it("never lets the lead-welcome template fire from a sweep", async () => {
    // Guarded by the caller, not by the lead-welcome config: a sweep that
    // re-reads a thousand leads must not be one portal setting away from
    // cold-opening all of them.
    const mod = await import("../lsqapply");
    const spy = vi.spyOn(mod, "applyLsqLead");
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "apply", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    leadsResult = { changed: [lead("919000000001", Date.parse("2026-10-09T11:30:00.000Z"))], scanned: 1, truncated: false };

    await runStagePoll({ now: NOW });

    // (event, options, tenantId) — the tenant is the third argument in this codebase.
    expect(spy).toHaveBeenCalledWith(expect.anything(), { allowWelcome: false }, expect.anything());
  });
});

describe("configuration round-trips", () => {
  it("setStagePoll merges onto what is already there", async () => {
    await setStagePoll({ enabled: true, stage: "Not Reachable" });
    await setStagePoll({ maxPerRun: 10 });
    const cfg = await getStagePoll();
    expect(cfg).toMatchObject({ enabled: true, stage: "Not Reachable", maxPerRun: 10 });
  });

  it("is off, stageless and unseeded by default", async () => {
    expect(await getStagePoll()).toMatchObject({ enabled: false, stage: "", watermark: null });
  });
});


describe("observe mode — trying it on live data without touching anything", () => {
  it("is the default, so a half-configured poll cannot start writing", async () => {
    expect((await getStagePoll()).mode).toBe("observe");
  });

  it("treats any value that is not exactly \"apply\" as observe", async () => {
    // A typo must not be the thing that starts moving live conversations.
    for (const v of ["Apply", "APPLY", "on", "", null, undefined, 1]) {
      await setStagePoll({ mode: v as never });
      expect((await getStagePoll()).mode, String(v)).toBe("observe");
    }
  });

  it("reports what WOULD happen and applies nothing", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    drips = [{ stage: "Not Reachable", sequenceId: "seq-rnr" }];
    knownContacts.set("919000000001", { phone: "919000000001", attributes: { lsq_stage: "RNR" } });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = { changed: [lead("919000000001", base), lead("919000000002", base + 1000)], scanned: 2, truncated: false };

    const r = await runStagePoll({ now: NOW });

    expect(r.mode).toBe("observe");
    expect(applied).toHaveLength(0);              // nothing applied, at all
    expect(r.applied).toBe(0);
    expect(r.observed).toHaveLength(2);
    expect(r.observed![0]).toMatchObject({ phone: "…0001", knownStage: "RNR", wouldEnroll: "seq-rnr", note: "would start the drip" });
    expect(r.observed![1]).toMatchObject({ phone: "…0002", knownStage: null, note: "no contact here yet — would be created" });
  });

  it("says plainly when a lead is already on the stage", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    knownContacts.set("919000000001", { phone: "919000000001", attributes: { lsq_stage: "Not Reachable" } });
    leadsResult = { changed: [lead("919000000001", Date.parse("2026-10-09T11:30:00.000Z"))], scanned: 1, truncated: false };
    const r = await runStagePoll({ now: NOW });
    expect(r.observed![0].note).toMatch(/already on this stage/);
    expect(r.observed![0].wouldEnroll).toBeNull();
  });

  it("says when a stage change has no rule, which is today's state", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Test", watermark: "2026-10-09T11:00:00.000Z" });
    drips = [];                                   // stage_drips is [] in production
    knownContacts.set("919000000001", { phone: "919000000001", attributes: { lsq_stage: "RNR" } });
    leadsResult = { changed: [lead("919000000001", Date.parse("2026-10-09T11:30:00.000Z"))], scanned: 1, truncated: false };
    const r = await runStagePoll({ now: NOW });
    expect(r.observed![0].note).toMatch(/no rule matches/);
  });

  it("still advances the watermark, so observing does not replay forever", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = { changed: [lead("919000000001", base)], scanned: 1, truncated: false };
    await runStagePoll({ now: NOW });
    expect((await getStagePoll()).watermark).toBe(new Date(base).toISOString());
  });

  it("never calls applyLsqLead, checked directly", async () => {
    const mod = await import("../lsqapply");
    const spy = vi.spyOn(mod, "applyLsqLead");
    spy.mockClear();   // vi.spyOn returns the EXISTING spy, history and all
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Not Reachable", watermark: "2026-10-09T11:00:00.000Z" });
    leadsResult = { changed: [lead("919000000001", Date.parse("2026-10-09T11:30:00.000Z"))], scanned: 1, truncated: false };
    await runStagePoll({ now: NOW });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("an observation nobody can read is not a dry run", () => {
  it("stores what it saw, so it can be read without deployment logs", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Test", watermark: "2026-10-09T11:00:00.000Z" });
    knownContacts.set("919000000001", { phone: "919000000001", attributes: { lsq_stage: "RNR" } });
    leadsResult = { changed: [lead("919000000001", Date.parse("2026-10-09T11:30:00.000Z"))], scanned: 1, truncated: false };

    await runStagePoll({ now: NOW });

    const cfg = await getStagePoll();
    expect(cfg.lastCandidates).toBe(1);
    expect(cfg.lastObserved).toHaveLength(1);
    expect(cfg.lastObserved![0]).toMatchObject({ phone: "…0001", knownStage: "RNR" });
  });

  it("stores a masked number only, never the full one", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Test", watermark: "2026-10-09T11:00:00.000Z" });
    leadsResult = { changed: [lead("919886098754", Date.parse("2026-10-09T11:30:00.000Z"))], scanned: 1, truncated: false };
    await runStagePoll({ now: NOW });
    expect(JSON.stringify((await getStagePoll()).lastObserved)).not.toContain("919886098754");
  });

  it("caps what it stores so the settings row cannot grow without bound", async () => {
    settings.set(STAGE_POLL_KEY, { enabled: true, mode: "observe", stage: "Test", maxPerRun: 50, watermark: "2026-10-09T11:00:00.000Z" });
    const base = Date.parse("2026-10-09T11:30:00.000Z");
    leadsResult = { changed: Array.from({ length: 50 }, (_, i) => lead(`9190000${String(i).padStart(5, "0")}`, base + i * 1000)), scanned: 50, truncated: false };
    await runStagePoll({ now: NOW });
    expect((await getStagePoll()).lastObserved!.length).toBe(25);
    expect((await getStagePoll()).lastCandidates).toBe(50);
  });
});
