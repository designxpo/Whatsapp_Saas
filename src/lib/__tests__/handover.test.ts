// Handing a lead on: sales → ops by hand, and mirroring LeadSquared ownership.
//
// The two systems disagree about what "owns" a lead. LeadSquared says a PERSON;
// the portal says a NUMBER, because the number is what team scoping reads and
// what replies go out from. Everything below is about that translation, and
// about the cases where it must refuse to translate — a wrong number sends the
// next reply from a line the customer has never seen.
import { describe, it, expect } from "vitest";
import { resolveOwnerTarget, resolveTeamTarget, type OwnerCandidateUser, type OwnerCandidateChannel } from "../handover";
import { nextTeam, TEAM_FLOW } from "../teams";

const user = (p: Partial<OwnerCandidateUser> & { email: string }): OwnerCandidateUser =>
  ({ name: "", active: true, team: null, channelId: null, ...p });
const chan = (p: Partial<OwnerCandidateChannel> & { id: string }): OwnerCandidateChannel =>
  ({ name: p.id, active: true, team: null, kind: "whatsapp", ...p });

const DIVESH = user({ email: "divesh@analytixlabs.co.in", name: "Divesh Bakshi", team: "sales", channelId: "ch-divesh" });
const OPS_ANNA = user({ email: "anna@analytixlabs.co.in", name: "Anna", team: "ops" });

const CHANNELS = [
  chan({ id: "ch-ppc", name: "PPC SM", team: "marketing" }),
  chan({ id: "ch-divesh", name: "Divesh", team: "sales" }),
  chan({ id: "ch-pooja", name: "Pooja", team: "sales" }),
  chan({ id: "ch-ops", name: "Support", team: "ops" }),
];

describe("resolveOwnerTarget — the member's own line", () => {
  it("moves the chat onto the LeadSquared owner's number", () => {
    const t = resolveOwnerTarget("divesh@analytixlabs.co.in", [DIVESH], CHANNELS, { channelId: "ch-ppc" });
    expect(t.channelId).toBe("ch-divesh");
    expect(t.assignTo).toBe("Divesh Bakshi");
    expect(t.team).toBe("sales");
  });

  it("matches the owner email case-insensitively — LSQ echoes it however it was typed", () => {
    const t = resolveOwnerTarget("Divesh@AnalytixLabs.co.in", [DIVESH], CHANNELS, { channelId: "ch-ppc" });
    expect(t.channelId).toBe("ch-divesh");
  });

  it("does not re-move a chat already on that owner's number", () => {
    const t = resolveOwnerTarget("divesh@analytixlabs.co.in", [DIVESH], CHANNELS, { channelId: "ch-divesh" });
    expect(t.channelId).toBeNull();
    expect(t.assignTo).toBe("Divesh Bakshi");
  });

  it("ignores a personal number that is deactivated, falling back to the team", () => {
    const channels = CHANNELS.map(c => (c.id === "ch-divesh" ? { ...c, active: false } : c));
    const t = resolveOwnerTarget("divesh@analytixlabs.co.in", [DIVESH], channels, { channelId: "ch-ppc" });
    expect(t.channelId).toBe("ch-pooja");       // the only remaining sales line
  });
});

describe("resolveOwnerTarget — falling back to the team", () => {
  it("uses the team's number when the member has no line of their own", () => {
    const t = resolveOwnerTarget("anna@analytixlabs.co.in", [OPS_ANNA], CHANNELS, { channelId: "ch-divesh" });
    expect(t.channelId).toBe("ch-ops");
    expect(t.team).toBe("ops");
  });

  it("leaves a chat alone when it already sits on one of that team's numbers", () => {
    // Pooja's line is also sales, and moving between two sales numbers would
    // change nothing except which 24-hour window the next reply needs.
    const t = resolveOwnerTarget("pooja@analytixlabs.co.in",
      [user({ email: "pooja@analytixlabs.co.in", name: "Pooja", team: "sales" })],
      CHANNELS, { channelId: "ch-pooja" });
    expect(t.channelId).toBeNull();
    expect(t.note).toContain("already on a Sales number");
  });

  it("refuses to guess between a team's numbers, and says how to fix it", () => {
    const t = resolveOwnerTarget("sam@analytixlabs.co.in",
      [user({ email: "sam@analytixlabs.co.in", name: "Sam", team: "sales" })],
      CHANNELS, { channelId: "ch-ppc" });
    expect(t.channelId).toBeNull();
    expect(t.assignTo).toBe("Sam");             // still labelled — just not moved
    expect(t.note).toContain("Settings → Team");
  });

  it("says so when the owner's team has no number at all", () => {
    const t = resolveOwnerTarget("anna@analytixlabs.co.in", [OPS_ANNA],
      CHANNELS.filter(c => c.team !== "ops"), { channelId: "ch-divesh" });
    expect(t.channelId).toBeNull();
    expect(t.note).toContain("no whatsapp number yet");
  });
});

describe("resolveOwnerTarget — when it must do nothing", () => {
  it("does nothing without an owner", () => {
    for (const v of [null, undefined, "", "   "]) {
      const t = resolveOwnerTarget(v, [DIVESH], CHANNELS, { channelId: "ch-ppc" });
      expect(t).toMatchObject({ assignTo: null, channelId: null });
    }
  });

  it("does nothing when the owner is not a portal member", () => {
    const t = resolveOwnerTarget("stranger@example.com", [DIVESH], CHANNELS, { channelId: "ch-ppc" });
    expect(t.channelId).toBeNull();
    expect(t.note).toContain("isn't a portal team member");
  });

  it("ignores a deactivated member — an ex-counsellor must not pull leads back", () => {
    const t = resolveOwnerTarget("divesh@analytixlabs.co.in", [{ ...DIVESH, active: false }], CHANNELS, { channelId: "ch-ppc" });
    expect(t.channelId).toBeNull();
  });

  it("still moves the number for a member with no display name", () => {
    // assigned_to is a label; "" would UNassign the chat. The move is what
    // actually grants the receiving team access, so it must not be blocked by
    // a missing name.
    const t = resolveOwnerTarget("divesh@analytixlabs.co.in", [{ ...DIVESH, name: "  " }], CHANNELS, { channelId: "ch-ppc" });
    expect(t.assignTo).toBeNull();
    expect(t.channelId).toBe("ch-divesh");
  });

  it("never moves a non-WhatsApp chat onto a WhatsApp number", () => {
    const t = resolveOwnerTarget("divesh@analytixlabs.co.in", [DIVESH], CHANNELS, { channelId: "ig-1", platform: "instagram" });
    expect(t.channelId).toBeNull();
  });

  it("leaves the number alone for a member on no team", () => {
    const t = resolveOwnerTarget("solo@analytixlabs.co.in",
      [user({ email: "solo@analytixlabs.co.in", name: "Solo" })], CHANNELS, { channelId: "ch-ppc" });
    expect(t.assignTo).toBe("Solo");
    expect(t.channelId).toBeNull();
    expect(t.team).toBeNull();
  });
});

describe("resolveTeamTarget — the manual push", () => {
  it("picks the team's only number", () => {
    const r = resolveTeamTarget("ops", CHANNELS, { channelId: "ch-divesh" });
    expect(r.channelId).toBe("ch-ops");
    expect(r.error).toBeNull();
  });

  it("asks which one when the team works several", () => {
    const r = resolveTeamTarget("sales", CHANNELS, { channelId: "ch-ppc" });
    expect(r.channelId).toBeNull();
    expect(r.error).toContain("choose which one");
    expect(r.choices.map(c => c.id)).toEqual(["ch-divesh", "ch-pooja"]);
  });

  it("is a no-op, not an error, when the chat is already on that team", () => {
    const r = resolveTeamTarget("sales", CHANNELS, { channelId: "ch-pooja" });
    expect(r.channelId).toBeNull();
    expect(r.error).toBeNull();
  });

  it("explains an empty team instead of silently doing nothing", () => {
    const r = resolveTeamTarget("ops", CHANNELS.filter(c => c.team !== "ops"), { channelId: "ch-divesh" });
    expect(r.error).toContain("Settings → Numbers");
  });
});

describe("nextTeam — the funnel", () => {
  it("walks marketing → sales → ops and stops", () => {
    expect(nextTeam("marketing")).toBe("sales");
    expect(nextTeam("sales")).toBe("ops");
    expect(nextTeam("ops")).toBeNull();
  });

  it("has no next phase for API traffic or an unassigned number", () => {
    expect(nextTeam("api")).toBeNull();
    expect(nextTeam(null)).toBeNull();
    expect(nextTeam(undefined)).toBeNull();
  });

  it("leaves `api` out of the funnel entirely — it has no human inbox", () => {
    expect(TEAM_FLOW).not.toContain("api");
  });
});
