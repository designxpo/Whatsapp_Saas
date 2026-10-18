// Team scoping (0073) — which NUMBERS a person may work.
//
// The lead runs marketing → sales → ops on separate numbers, and a member is
// pinned to one team. This is access control, so the failure modes are silent
// and asymmetric: getting it wrong either shows one team another team's
// conversations, or blanks somebody's inbox with no error. Both are pinned here.
//
// The subtle one is null-vs-empty. "No restriction" and "restricted to nothing"
// are DIFFERENT answers, and collapsing them hands a member the whole inbox:
// a member on a team that owns no numbers yet must see zero chats, not all of
// them. PostgREST's `.in("channel_id", [])` matches nothing, which is right —
// but only if the empty array is allowed to reach it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TENANT_ID as COMPANY_TENANT_ID } from "../tenant";

const h = vi.hoisted(() => ({
  channelsByTeam: {} as Record<string, { id: string }[]>,
  convQuery: null as null | { inCol?: string; inVals?: string[]; eq?: Record<string, unknown>; limit?: number },
  convRows: [] as Record<string, unknown>[],
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "wa_channels") {
        // Tenant-scoped AND team-scoped, so the chain takes more than one .eq and
        // resolves only when awaited.
        let team = "";
        const ch: Record<string, unknown> = {
          select: () => ch,
          eq: (c: string, v: string) => { if (c === "team") team = v; return ch; },
          then: (res: (x: { data: { id: string }[] }) => unknown) => Promise.resolve(res({ data: h.channelsByTeam[team] ?? [] })),
        };
        return ch;
      }
      // wa_conversations — record exactly what the query asked for.
      const q: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: (n: number) => { q.limit = n; return chain; },
        eq: (c: string, v: unknown) => { q.eq = { ...(q.eq as object ?? {}), [c]: v }; return chain; },
        in: (c: string, v: string[]) => { q.inCol = c; q.inVals = v; return chain; },
        then: (res: (x: { data: Record<string, unknown>[] }) => unknown) => {
          h.convQuery = q as never;
          return Promise.resolve(res({ data: h.convRows }));
        },
      };
      return chain;
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  h.channelsByTeam = {
    marketing: [{ id: "ch-organic" }, { id: "ch-ppc" }],
    sales: [{ id: "ch-pooja" }, { id: "ch-sabrish" }],
    ops: [],                       // ops exists but owns no number yet
  };
  h.convQuery = null;
  h.convRows = [];
});

const admin = { email: "a@x.com", name: "A", role: "admin" as const, team: null, tenantId: COMPANY_TENANT_ID };
const member = (team: string | null) => ({ email: "m@x.com", name: "M", role: "member" as const, team: team as never, tenantId: COMPANY_TENANT_ID });
const lead = (team: string | null) => ({ email: "l@x.com", name: "L", role: "lead" as const, team: team as never, tenantId: COMPANY_TENANT_ID });

describe("visibleChannelIds", () => {
  it("returns null (no restriction) for an admin, even one carrying a team", async () => {
    const { visibleChannelIds } = await import("../teams");
    expect(await visibleChannelIds(admin)).toBeNull();
    expect(await visibleChannelIds({ ...admin, team: "sales" as never })).toBeNull();
  });

  it("returns only that team's channels for a scoped member", async () => {
    const { visibleChannelIds } = await import("../teams");
    expect(await visibleChannelIds(member("sales"))).toEqual(["ch-pooja", "ch-sabrish"]);
  });

  it("returns an EMPTY ARRAY, not null, for a team that owns no numbers", async () => {
    // The whole point: [] means "see nothing". If this ever returned null the
    // ops team would silently get every marketing and sales chat.
    const { visibleChannelIds } = await import("../teams");
    const ids = await visibleChannelIds(member("ops"));
    expect(ids).toEqual([]);
    expect(ids).not.toBeNull();
  });

  it("leaves an unassigned member unrestricted so applying 0073 can't blank an inbox", async () => {
    const { visibleChannelIds } = await import("../teams");
    expect(await visibleChannelIds(member(null))).toBeNull();
  });

  it("shows nothing at all to an unauthenticated caller", async () => {
    const { visibleChannelIds } = await import("../teams");
    expect(await visibleChannelIds(null)).toEqual([]);
  });
});

describe("resolveChannelScope", () => {
  it("passes the full allowance through when no number is requested", async () => {
    const { resolveChannelScope } = await import("../teams");
    expect(resolveChannelScope(["a", "b"], null)).toEqual({ ids: ["a", "b"], denied: false });
    expect(resolveChannelScope(null, null)).toEqual({ ids: null, denied: false });
  });

  it("narrows to the requested number when it is inside the allowance", async () => {
    const { resolveChannelScope } = await import("../teams");
    expect(resolveChannelScope(["a", "b"], "b")).toEqual({ ids: ["b"], denied: false });
  });

  it("lets an unrestricted user filter to any single number", async () => {
    const { resolveChannelScope } = await import("../teams");
    expect(resolveChannelScope(null, "anything")).toEqual({ ids: ["anything"], denied: false });
  });

  it("DENIES rather than silently substituting when the number is another team's", async () => {
    // Falling back to the member's own numbers would look to them like the
    // chats they asked for had been deleted. A 403 is the honest answer.
    const { resolveChannelScope } = await import("../teams");
    expect(resolveChannelScope(["a", "b"], "c")).toEqual({ ids: [], denied: true });
  });
});

describe("canSeeConversation", () => {
  it("allows anything for an unrestricted user, including env-era null-channel chats", async () => {
    const { canSeeConversation } = await import("../teams");
    expect(canSeeConversation(null, "ch-x")).toBe(true);
    expect(canSeeConversation(null, null)).toBe(true);
  });

  it("allows a scoped member only their own team's numbers", async () => {
    const { canSeeConversation } = await import("../teams");
    expect(canSeeConversation(["ch-pooja"], "ch-pooja")).toBe(true);
    expect(canSeeConversation(["ch-pooja"], "ch-organic")).toBe(false);
  });

  it("hides null-channel (env-era) chats from a scoped member", async () => {
    // 23 live conversations have channel_id = NULL. They belong to no number, so
    // no team owns them; a scoped member must not inherit them by default.
    const { canSeeConversation } = await import("../teams");
    expect(canSeeConversation(["ch-pooja"], null)).toBe(false);
  });
});

describe("listConversations channel scope", () => {
  it("applies the number filter IN THE QUERY, not after the row cap", async () => {
    // The query is capped at 200 rows against 1,000+ conversations. Filtering
    // client-side would search only the newest page and quietly lose a team's
    // older chats — the same row-cap trap that broke the analytics filter.
    const { listConversations } = await import("../store");
    await listConversations({ channelIds: ["ch-pooja", "ch-sabrish"] });
    expect(h.convQuery?.inCol).toBe("channel_id");
    expect(h.convQuery?.inVals).toEqual(["ch-pooja", "ch-sabrish"]);
  });

  it("short-circuits to [] for an empty scope without querying at all", async () => {
    const { listConversations } = await import("../store");
    expect(await listConversations({ channelIds: [] })).toEqual([]);
    expect(h.convQuery).toBeNull();      // never reached the database
  });

  it("applies no channel filter when the scope is null", async () => {
    const { listConversations } = await import("../store");
    await listConversations({ channelIds: null });
    expect(h.convQuery?.inCol).toBeUndefined();
  });

  it("combines a status filter with the channel scope", async () => {
    const { listConversations } = await import("../store");
    await listConversations({ status: "escalated", channelIds: ["ch-pooja"] });
    expect((h.convQuery?.eq as Record<string, unknown>)?.status).toBe("escalated");
    expect(h.convQuery?.inVals).toEqual(["ch-pooja"]);
  });
});

describe("team vocabulary", () => {
  it("accepts only the four real teams and nulls anything else", async () => {
    const { asTeam, isTeam, TEAMS } = await import("../teams");
    expect(TEAMS).toEqual(["marketing", "sales", "ops", "api"]);
    expect(asTeam("sales")).toBe("sales");
    expect(asTeam("Sales")).toBeNull();          // case-sensitive: matches the CHECK constraint
    expect(asTeam("")).toBeNull();
    expect(asTeam(undefined)).toBeNull();
    expect(asTeam("finance")).toBeNull();        // a stale client must not fail the save
    expect(isTeam("ops")).toBe(true);
  });
});


// ── Roles (0076) ─────────────────────────────────────────────────────────────
//
// A team lead runs one team. Running it is not the same as being trusted with
// every other team's conversations, so scope-wise a lead IS a member — the
// extra they get is the Team Progress view over these same numbers.
describe("team leads", () => {
  it("sees exactly their own team's numbers — no wider than a member", async () => {
    const { visibleChannelIds } = await import("../teams");
    expect(await visibleChannelIds(lead("sales") as never)).toEqual(["ch-pooja", "ch-sabrish"]);
    expect(await visibleChannelIds(lead("marketing") as never)).toEqual(["ch-organic", "ch-ppc"]);
  });

  it("sees nothing when their team owns no number yet", async () => {
    const { visibleChannelIds } = await import("../teams");
    expect(await visibleChannelIds(lead("ops") as never)).toEqual([]);
  });

  it("cannot reach into another team", async () => {
    const { visibleChannelIds, resolveChannelScope } = await import("../teams");
    const allowed = await visibleChannelIds(lead("sales") as never);
    expect(resolveChannelScope(allowed, "ch-organic")).toEqual({ ids: [], denied: true });
  });
});

describe("canWatchTeam", () => {
  it("lets a super admin watch any team", async () => {
    const { canWatchTeam } = await import("../teams");
    for (const t of ["marketing", "sales", "ops", "api"] as const) {
      expect(canWatchTeam(admin, t)).toBe(true);
    }
  });

  it("lets a lead watch only their own", async () => {
    const { canWatchTeam } = await import("../teams");
    expect(canWatchTeam(lead("sales"), "sales")).toBe(true);
    expect(canWatchTeam(lead("sales"), "ops")).toBe(false);
  });

  it("never lets a member watch a team — not even their own", async () => {
    const { canWatchTeam } = await import("../teams");
    expect(canWatchTeam(member("sales"), "sales")).toBe(false);
  });

  it("refuses a lead with no team rather than defaulting them somewhere", async () => {
    const { canWatchTeam } = await import("../teams");
    expect(canWatchTeam(lead(null), "sales")).toBe(false);
  });
});

describe("asRole", () => {
  it("falls DOWN to member for anything unrecognised, never up to admin", async () => {
    const { asRole } = await import("../teams");
    for (const v of ["Admin", "superadmin", "owner", "", null, undefined, 1, {}]) {
      expect(asRole(v)).toBe("member");
    }
  });

  it("passes the three real roles through", async () => {
    const { asRole } = await import("../teams");
    expect(asRole("admin")).toBe("admin");
    expect(asRole("lead")).toBe("lead");
    expect(asRole("member")).toBe("member");
  });
});
