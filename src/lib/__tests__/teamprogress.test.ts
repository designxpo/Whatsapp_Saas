// Team progress — who on a team is keeping up, and who is behind.
//
// The number that matters is attribution. Work is counted by NUMBER, not by the
// "Assigned to" label, because that label is a display string matched by
// equality and is null on most rows. The tests below pin the two properties a
// lead has to be able to trust: every chat on the team is counted exactly once,
// and a number nobody owns still shows up rather than vanishing from the total.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  conversations: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  messageCounts: {} as Record<string, number>,
  users: [] as Record<string, unknown>[],
  channels: [] as Record<string, unknown>[],
  stages: [] as Record<string, unknown>[],
}));

// One paged builder shape for both tables pageAll reads. `range` is what
// pageAll actually calls; everything before it records filters.
//
// gte/lte are APPLIED, not swallowed. A mock that ignores them lets a missing
// date filter pass the suite — which it did, until this was fixed: dropping the
// pipeline window entirely left every test green while the board would have
// reported leads won last quarter as won this week.
function pagedChain(rows: () => Record<string, unknown>[]) {
  const bounds: Record<string, { gte?: string; lte?: string }> = {};
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "in", "order", "not", "eq"]) chain[m] = () => chain;
  chain.gte = (col: string, v: string) => { (bounds[col] ??= {}).gte = v; return chain; };
  chain.lte = (col: string, v: string) => { (bounds[col] ??= {}).lte = v; return chain; };
  chain.range = (from: number, to: number) => {
    const filtered = rows().filter(r => Object.entries(bounds).every(([col, b]) => {
      const v = r[col] as string | null | undefined;
      if (v == null) return false;
      return (!b.gte || v >= b.gte) && (!b.lte || v <= b.lte);
    }));
    return Promise.resolve({ data: filtered.slice(from, to + 1), error: null });
  };
  return chain;
}

vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "wa_conversations") return pagedChain(() => h.conversations);
      if (table === "contacts") return pagedChain(() => h.contacts);
      if (table === "wa_conv_messages") {
        let channel = "";
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (col: string, v: string) => { if (col === "channel_id") channel = v; return chain; };
        chain.gte = () => chain;
        chain.lte = () => Promise.resolve({ count: h.messageCounts[channel] ?? 0 });
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));
vi.mock("../team", () => ({ listUsers: async () => h.users }));
vi.mock("../channels", () => ({ listChannels: async () => h.channels }));
vi.mock("../pipeline", () => ({ listStages: async () => h.stages }));

const RANGE = { from: "2026-09-01T00:00:00.000Z", to: "2026-09-08T00:00:00.000Z" };
const INSIDE = "2026-09-03T10:00:00.000Z";
const BEFORE = "2026-08-01T10:00:00.000Z";

beforeEach(() => {
  vi.resetModules();
  h.channels = [
    { id: "ch-pooja", name: "Pooja", team: "sales", kind: "whatsapp" },
    { id: "ch-divesh", name: "Divesh", team: "sales", kind: "whatsapp" },
    { id: "ch-ppcsm", name: "PPC SM", team: "sales", kind: "whatsapp" },   // shared, nobody attached
    { id: "ch-ops", name: "Support", team: "ops", kind: "whatsapp" },
  ];
  h.users = [
    { name: "Pooja Singh", email: "pooja@x.com", active: true, channelId: "ch-pooja", team: "sales" },
    { name: "Divesh Bakshi", email: "divesh@x.com", active: true, channelId: "ch-divesh", team: "sales" },
  ];
  h.stages = [
    { id: "s-won", isWon: true, isLost: false },
    { id: "s-lost", isWon: false, isLost: true },
    { id: "s-new", isWon: false, isLost: false },
  ];
  h.conversations = [];
  h.contacts = [];
  h.messageCounts = {};
});

const conv = (p: Partial<Record<string, unknown>> & { channel_id: string }) =>
  ({ id: Math.random().toString(36).slice(2), phone: "91900000000", status: "active", needs_reply: false, last_inbound_at: null, last_outbound_at: null, ...p });

describe("attribution", () => {
  it("names the person who works a line, and the line itself when nobody does", async () => {
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    const by = Object.fromEntries(p.rows.map(r => [r.key, r]));
    expect(by["ch-pooja"].who).toBe("Pooja Singh");
    expect(by["ch-pooja"].shared).toBe(false);
    expect(by["ch-ppcsm"].who).toBe("PPC SM");
    expect(by["ch-ppcsm"].shared).toBe(true);
  });

  it("names both people during a handover instead of picking one", async () => {
    // 0075 deliberately allows a number against two members for a handover
    // period. Showing one of them would credit the wrong person.
    h.users.push({ name: "Sabrish", email: "s@x.com", active: true, channelId: "ch-pooja", team: "sales" });
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows.find(r => r.key === "ch-pooja")!.who).toBe("Pooja Singh + Sabrish");
  });

  it("ignores a deactivated member — their line reads as shared, not as theirs", async () => {
    h.users = [{ name: "Pooja Singh", email: "pooja@x.com", active: false, channelId: "ch-pooja", team: "sales" }];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows.find(r => r.key === "ch-pooja")!.shared).toBe(true);
  });

  it("never counts another team's numbers", async () => {
    h.conversations = [conv({ channel_id: "ch-ops" }), conv({ channel_id: "ch-pooja" })];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows.map(r => r.key)).not.toContain("ch-ops");
    expect(p.totals.open).toBe(1);
  });
});

describe("counting", () => {
  it("splits open, waiting and escalated without double-counting", async () => {
    h.conversations = [
      conv({ channel_id: "ch-pooja", status: "active", needs_reply: true }),
      conv({ channel_id: "ch-pooja", status: "active" }),
      conv({ channel_id: "ch-pooja", status: "escalated", needs_reply: true }),
      conv({ channel_id: "ch-divesh", status: "paused" }),
    ];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    const pooja = p.rows.find(r => r.key === "ch-pooja")!;
    expect(pooja.open).toBe(2);          // the escalated one is not "open"
    expect(pooja.escalated).toBe(1);
    expect(pooja.waiting).toBe(2);       // waiting is orthogonal to status
    expect(p.rows.find(r => r.key === "ch-divesh")!.open).toBe(0);
  });

  it("counts activity only inside the window", async () => {
    h.conversations = [
      conv({ channel_id: "ch-pooja", last_inbound_at: INSIDE, last_outbound_at: INSIDE }),
      conv({ channel_id: "ch-pooja", last_inbound_at: BEFORE, last_outbound_at: BEFORE }),
    ];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    const pooja = p.rows.find(r => r.key === "ch-pooja")!;
    expect(pooja.activeInRange).toBe(1);
    expect(pooja.repliedInRange).toBe(1);
  });

  it("counts human replies per number, not bot replies", async () => {
    h.messageCounts = { "ch-pooja": 42, "ch-divesh": 3 };
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows.find(r => r.key === "ch-pooja")!.humanReplies).toBe(42);
    expect(p.totals.humanReplies).toBe(45);
  });

  it("credits a win to the number that was working the lead", async () => {
    h.conversations = [
      conv({ channel_id: "ch-pooja", phone: "919111111111" }),
      conv({ channel_id: "ch-divesh", phone: "919222222222" }),
    ];
    h.contacts = [
      { phone: "919111111111", pipeline_stage_id: "s-won", pipeline_updated_at: INSIDE },
      { phone: "919222222222", pipeline_stage_id: "s-lost", pipeline_updated_at: INSIDE },
    ];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows.find(r => r.key === "ch-pooja")!.won).toBe(1);
    expect(p.rows.find(r => r.key === "ch-divesh")!.lost).toBe(1);
    expect(p.totals.won).toBe(1);
  });

  it("ignores a win that happened before the window", async () => {
    h.conversations = [conv({ channel_id: "ch-pooja", phone: "919111111111" })];
    h.contacts = [{ phone: "919111111111", pipeline_stage_id: "s-won", pipeline_updated_at: BEFORE }];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.totals.won).toBe(0);        // last quarter's win is not this week's progress
  });

  it("does not count a stage that is neither won nor lost", async () => {
    h.conversations = [conv({ channel_id: "ch-pooja", phone: "919111111111" })];
    h.contacts = [{ phone: "919111111111", pipeline_stage_id: "s-new", pipeline_updated_at: INSIDE }];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.totals.won).toBe(0);
    expect(p.totals.lost).toBe(0);
  });
});

describe("ordering and totals", () => {
  it("puts whoever has the most people waiting at the top", async () => {
    h.conversations = [
      conv({ channel_id: "ch-divesh", needs_reply: true }),
      conv({ channel_id: "ch-divesh", needs_reply: true }),
      conv({ channel_id: "ch-pooja", needs_reply: true }),
    ];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows[0].key).toBe("ch-divesh");
  });

  it("totals equal the sum of the rows", async () => {
    h.conversations = [
      conv({ channel_id: "ch-pooja", needs_reply: true }),
      conv({ channel_id: "ch-ppcsm" }),
      conv({ channel_id: "ch-divesh", status: "escalated" }),
    ];
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.totals.open).toBe(p.rows.reduce((n, r) => n + r.open, 0));
    expect(p.totals.waiting).toBe(1);
    expect(p.totals.escalated).toBe(1);
    expect(p.totals.open).toBe(2);        // the shared line's chat is NOT lost
  });
});

describe("when there is nothing to report", () => {
  it("explains an empty team instead of rendering a blank board", async () => {
    h.channels = h.channels.filter(c => c.team !== "sales");
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.rows).toEqual([]);
    expect(p.note).toContain("Settings → Numbers");
  });

  it("says how many lines have nobody attached", async () => {
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.note).toContain("1 of 3 numbers");
  });

  it("has no note at all once every line has an owner", async () => {
    h.users.push({ name: "Anil", email: "anil@x.com", active: true, channelId: "ch-ppcsm", team: "sales" });
    const { teamProgress } = await import("../teamprogress");
    const p = await teamProgress("sales", RANGE);
    expect(p.note).toBeNull();
  });
});
