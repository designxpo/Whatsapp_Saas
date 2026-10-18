// Re-seeding the RNR drip while somebody is part-way through it.
//
// The guard exists for a real hazard: enrolments track their place by step
// INDEX, so rewriting the steps can land a lead on a different message on a
// different day. But it was written as "are there active enrolments?", and
// that is not the same question.
//
// The commonest re-seed by far adds a course name to an audience list. Same
// templates, same indexes, same days — a wider audience and nothing moved.
// Refusing that is not caution: it is refusing to ship the fix, and the only
// way past it is `force`, which ALSO waves through the renumbering the guard
// was built to stop. The safe edit and the dangerous one came out the same.
//
// Measured 14 Oct, this was live: Tanvi's answers had been in the programme
// table since 8df36f2 and the running drip still carried the pre-Tanvi course
// lists, because one lead was mid-journey and the rebuild was refused.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  activeEnrolments: 1,
  liveSteps: [] as { stepIndex: number; delayMinutes: number; action: unknown; audience: unknown }[],
  savedSteps: null as unknown,
}));

vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => { void fn; } };
});
vi.mock("../../lib/auth", () => ({ requireRoleAdmin: async () => true, currentUser: async () => ({ id: "u1" }), currentTenantId: async () => "t1" }));
vi.mock("../../lib/feature-guard", () => ({ guardFeature: async () => null }));
vi.mock("../../lib/team", () => ({ logActivity: () => undefined }));
vi.mock("../../lib/channels", () => ({ listChannels: async () => [{ id: "ch-1", name: "PPC SM" }], getChannel: async () => ({ id: "ch-1", name: "PPC SM" }) }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: Array.from({ length: h.activeEnrolments }, (_, i) => ({ id: `e${i}` })) }) }) }) }),
    }),
  }),
}));
vi.mock("../../lib/sequences", () => ({
  listSequences: async () => [{ id: "seq-1", name: "RNR follow-up", active: true, channelId: "ch-1" }],
  createSequence: async () => ({ id: "seq-1" }),
  updateSequence: async () => undefined,
  setSequenceSteps: async (_id: string, steps: unknown) => { h.savedSteps = steps; },
  getSequenceSteps: async () => h.liveSteps,
}));

const { POST } = await import("../../app/api/admin/sequences/seed-rnr/route");
const { rnrSteps, buildSteps } = await import("../rnrseed");

/** The drip exactly as the seeder builds it today. */
const inSync = () =>
  buildSteps(rnrSteps({ channelId: "ch-1" })).map((b, i) => ({ stepIndex: i, ...b }));

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://x/api/admin/sequences/seed-rnr", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }) as never);

beforeEach(() => { h.activeEnrolments = 1; h.liveSteps = inSync(); h.savedSteps = null; });

describe("re-seeding under a live enrolment", () => {
  it("ALLOWS a rebuild that only widens an audience", async () => {
    // The live drip is missing a course from one list — the exact drift that
    // a programme-table edit leaves behind. Nothing moves, so nothing is at
    // risk, and this is the rebuild that fixes it.
    h.liveSteps = inSync().map(s => {
      const a = s.audience as { attrIn?: Record<string, string[]> } | null;
      if (!a?.attrIn?.["Product Name"]) return s;
      return { ...s, audience: { ...a, attrIn: { ...a.attrIn, "Product Name": a.attrIn["Product Name"].slice(1) } } };
    });
    const res = await post({ channelId: "ch-1" });
    expect(res.status).toBe(200);
    expect(h.savedSteps).not.toBeNull();
  });

  it("still REFUSES a rebuild that renumbers the steps", async () => {
    // A step removed from the middle: every lead past it shifts onto a
    // different message. This is what the guard is for and it must hold.
    h.liveSteps = inSync().filter((_, i) => i !== 1).map((s, i) => ({ ...s, stepIndex: i }));
    const res = await post({ channelId: "ch-1" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/running order/i);
    expect(h.savedSteps).toBeNull();
  });

  it("still REFUSES a rebuild that moves a step to a different day", async () => {
    // Same templates in the same order, but day 7 becomes day 2 — a lead
    // waiting on it gets it five days early.
    h.liveSteps = inSync().map((s, i) => (i === 1 ? { ...s, delayMinutes: 60 } : s));
    const res = await post({ channelId: "ch-1" });
    expect(res.status).toBe(409);
    expect(h.savedSteps).toBeNull();
  });

  it("force still overrides a genuine renumber", async () => {
    h.liveSteps = inSync().filter((_, i) => i !== 1).map((s, i) => ({ ...s, stepIndex: i }));
    const res = await post({ channelId: "ch-1", force: true });
    expect(res.status).toBe(200);
    expect(h.savedSteps).not.toBeNull();
  });

  it("does not even look at the order when nobody is enrolled", async () => {
    h.activeEnrolments = 0;
    h.liveSteps = [];
    const res = await post({ channelId: "ch-1" });
    expect(res.status).toBe(200);
  });
});
