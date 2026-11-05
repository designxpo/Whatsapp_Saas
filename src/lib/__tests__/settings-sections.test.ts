// Settings shows one section at a time, and LeadSquared reads as connected
// whichever way a workspace connected it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const TAB = readFileSync(`${process.cwd()}/src/app/admin/_tabs/SettingsTab.tsx`, "utf8");
const render = TAB.slice(TAB.indexOf("<SettingsSectionBar section={section}"), TAB.indexOf("<SettingsRail goTo={goTo} />"));

describe("Settings is split into sections", () => {
  it("every card sits inside a section, none loose under the bar", () => {
    const cards = ["<UsageCard />", "<ChannelsManager />", "<TeamManager />", "<ActivityLog />", "<CannedTemplatesCard />", "<VoiceSettingsCard />", "<ApiKeysCard />", "<OtpServiceCard />", "<QrTool />"];
    const opens = [...render.matchAll(/\{section === "(\w+)" && \(<>/g)].map(m => ({ name: m[1], at: m.index! }));
    expect(opens.map(o => o.name)).toEqual(["general", "numbers", "team", "crm", "automation", "replies", "privacy"]);
    for (const card of cards) {
      const at = render.indexOf(card);
      expect(at, card).toBeGreaterThan(opens[0].at);
    }
  });

  it("the section is kept in the address, and members never land on an admin one", () => {
    expect(TAB).toMatch(/const SECTION_PARAM = "section"/);
    expect(TAB).toMatch(/window\.history\.replaceState\(window\.history\.state/);
    expect(TAB).toMatch(/if \(!isAdmin && SETTINGS_SECTIONS\.find\(x => x\.key === section\)\?\.adminOnly\) setState\("general"\)/);
  });
});

const h = vi.hoisted(() => ({
  hub: null as null | { id: string; kind: string; active: boolean; config: Record<string, unknown> },
  hubSecret: "",
  settings: {} as Record<string, string>,
  secrets: {} as Record<string, string>,
}));
vi.mock("../integrations", () => ({
  listIntegrations: async () => (h.hub ? [h.hub] : []),
  getIntegrationSecret: async () => h.hubSecret,
  setIntegrationError: async () => undefined,
}));
vi.mock("../store", () => ({
  getTenantSetting: async (_t: string, k: string, d: unknown) => h.settings[k] ?? d,
  getTenantSecret: async (_t: string, k: string) => h.secrets[k] ?? null,
}));
vi.mock("../supabase", () => ({ db: () => ({}) }));

describe("where a workspace's LeadSquared comes from", () => {
  beforeEach(() => {
    h.hub = null; h.hubSecret = ""; h.settings = {}; h.secrets = {};
    delete process.env.LSQ_ACCESS_KEY; delete process.env.LSQ_SECRET_KEY; delete process.env.LSQ_API_HOST; delete process.env.LSQ_ACTIVITY_CODE;
  });

  it("the Integrations hub", async () => {
    h.hub = { id: "i1", kind: "leadsquared", active: true, config: { host: "https://api-in21.leadsquared.com", activityCode: "210" } };
    h.hubSecret = JSON.stringify({ accessKey: "a", secretKey: "b" });
    const { lsqConnection } = await import("../leadsquared");
    expect(await lsqConnection("t-1")).toEqual({ connected: true, via: "hub" });
  });

  it("older workspace settings still count as connected", async () => {
    const { lsqConnection, LSQ_KEYS } = await import("../leadsquared");
    h.secrets = { [LSQ_KEYS.accessKey]: "a", [LSQ_KEYS.secretKey]: "b" };
    h.settings = { [LSQ_KEYS.host]: "https://api-in21.leadsquared.com", [LSQ_KEYS.activityCode]: "210" };
    expect(await lsqConnection("t-1")).toEqual({ connected: true, via: "settings" });
  });

  it("server keys only for the default workspace, never another", async () => {
    Object.assign(process.env, { LSQ_ACCESS_KEY: "a", LSQ_SECRET_KEY: "b", LSQ_API_HOST: "https://api-in21.leadsquared.com", LSQ_ACTIVITY_CODE: "210" });
    const { lsqConnection } = await import("../leadsquared");
    const { DEFAULT_TENANT_ID } = await import("../tenant");
    expect(await lsqConnection(DEFAULT_TENANT_ID)).toEqual({ connected: true, via: "server" });
    expect(await lsqConnection("t-other")).toEqual({ connected: false, via: null });
  });

  it("nothing set is not connected", async () => {
    const { lsqConnection } = await import("../leadsquared");
    expect(await lsqConnection("t-1")).toEqual({ connected: false, via: null });
  });

  it("both screens use that answer", () => {
    const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
    expect(read("src/app/api/admin/integrations/route.ts")).toMatch(/leadsquared: await lsqConnection\(tid\)/);
    expect(read("src/app/admin/_tabs/IntegrationsTab.tsx")).toMatch(/lsq\.connected \? 1 : 0/);
    expect(TAB).toMatch(/setLsqConn\(d\?\.leadsquared \?\? null\)/);
  });
});
