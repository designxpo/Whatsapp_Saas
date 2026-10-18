// The CRM panel credential, and the one place it is allowed to travel badly.
//
// /crm/chat is embedded by LeadSquared as an iframe whose src is configured in
// LSQ, and an iframe src cannot carry a header — so the PAGE is opened with
// ?token=. Everything after that uses x-crm-token. The query parameter is
// therefore not needed on the API, but it cannot be assumed unused either:
// somebody's LSQ automation may still send it, and this project has already
// been bitten once by a credential change that turned into a silent 401.
//
// So it stays, loudly, behind a switch. These tests hold all three parts of
// that: it works, it complains, and the switch actually turns it off.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const API_KEY = "crm-server-key-000000";
const PANEL = "panel-token-1111111111";

let warnings: string[] = [];

beforeEach(() => {
  process.env.CRM_API_KEY = API_KEY;
  process.env.CRM_PANEL_TOKEN = PANEL;
  delete process.env.CRM_QUERY_TOKEN;
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { warnings.push(a.join(" ")); });
});
afterEach(() => { vi.restoreAllMocks(); });

const req = (init: { bearer?: string; header?: string; query?: string; path?: string }) =>
  new Request(`https://waba.test${init.path ?? "/api/crm/thread"}${init.query ? `?token=${init.query}` : ""}`, {
    headers: {
      ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
      ...(init.header ? { "x-crm-token": init.header } : {}),
    },
  });

describe("the two supported credentials", () => {
  it("accepts the server key as a bearer token", async () => {
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({ bearer: API_KEY }))).toBe(true);
  });

  it("accepts the panel token as a header, silently", async () => {
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({ header: PANEL }))).toBe(true);
    expect(warnings).toEqual([]);      // the supported path must not nag
  });

  it("refuses anything else", async () => {
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({}))).toBe(false);
    expect(crmAuthorized(req({ bearer: "wrong" }))).toBe(false);
    expect(crmAuthorized(req({ header: "wrong" }))).toBe(false);
    expect(crmAuthorized(req({ query: "wrong" }))).toBe(false);
  });

  it("does not accept the panel token where the server key belongs, or vice versa", async () => {
    // Two credentials with two different reaches. Letting either stand in for
    // the other would quietly merge them.
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({ bearer: PANEL }))).toBe(false);
    expect(crmAuthorized(req({ header: API_KEY }))).toBe(false);
  });
});

describe("the deprecated query token", () => {
  it("still works, so nobody's LSQ automation breaks without warning", async () => {
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({ query: PANEL }))).toBe(true);
  });

  it("logs where it came from, so the callers can be found and moved", async () => {
    const { crmAuthorized } = await import("../crm");
    crmAuthorized(req({ query: PANEL, path: "/api/crm/send" }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/DEPRECATED/);
    expect(warnings[0]).toMatch(/\/api\/crm\/send/);      // names the caller
    expect(warnings[0]).toMatch(/x-crm-token/);           // says what to do
  });

  it("never writes the token into the log it is complaining about", async () => {
    // The entire objection to ?token= is that the secret lands in logs.
    // Logging it here would be the same mistake with extra steps.
    const { crmAuthorized } = await import("../crm");
    crmAuthorized(req({ query: PANEL }));
    expect(warnings.join(" ")).not.toContain(PANEL);
  });

  it("stops working when CRM_QUERY_TOKEN=off", async () => {
    process.env.CRM_QUERY_TOKEN = "off";
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({ query: PANEL }))).toBe(false);
    // and the supported paths are untouched by the switch
    expect(crmAuthorized(req({ header: PANEL }))).toBe(true);
    expect(crmAuthorized(req({ bearer: API_KEY }))).toBe(true);
  });

  it("is on unless it is explicitly turned off", async () => {
    // A typo in the env var must not silently disable a live integration.
    const { crmAuthorized } = await import("../crm");
    for (const v of ["", "on", "yes", "ON", "true", "nonsense"]) {
      process.env.CRM_QUERY_TOKEN = v;
      expect(crmAuthorized(req({ query: PANEL })), `CRM_QUERY_TOKEN=${v}`).toBe(true);
    }
    process.env.CRM_QUERY_TOKEN = "OFF";
    expect(crmAuthorized(req({ query: PANEL }))).toBe(false);   // case-insensitive
  });
});

describe("when the credentials are not configured", () => {
  it("refuses everything rather than matching an empty string", async () => {
    process.env.CRM_API_KEY = "";
    process.env.CRM_PANEL_TOKEN = "";
    const { crmAuthorized } = await import("../crm");
    expect(crmAuthorized(req({ bearer: "" }))).toBe(false);
    expect(crmAuthorized(req({ header: "" }))).toBe(false);
    expect(crmAuthorized(req({}))).toBe(false);
  });
});
