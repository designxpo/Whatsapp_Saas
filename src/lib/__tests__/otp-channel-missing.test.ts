// A configured OTP number that no longer resolves must STOP the send.
//
// credsFor answers undefined both for "never configured" and "configured, then
// deleted". If a sender takes undefined to mean "use the environment
// credentials", the code leaves from a different WABA — and templates are
// WABA-scoped, so Meta replies "(#132001) Template name does not exist in the
// translation", naming the template when the problem is the number. In wab that
// read as an international-signup bug and every signup failed for a day.
//
// resolveOtpCreds is where this is decided, and it must stay loud.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  creds: undefined as unknown,
  defaultChannel: null as string | null,
}));

vi.mock("../channels", () => ({
  credsFor: async () => h.creds,
  explicitDefaultChannel: async () => h.defaultChannel,
}));
vi.mock("../store", () => ({ getTenantSetting: async () => "", setTenantSetting: async () => undefined }));
vi.mock("../supabase", () => ({ db: () => ({}) }));
vi.mock("../whatsapp", () => ({ sendAuthTemplate: async () => ({}) }));

import { resolveOtpCreds } from "../otp";
import { DEFAULT_TENANT_ID } from "../tenant";

const CREDS = { token: "t", phoneId: "p", wabaId: "w" };

beforeEach(() => { h.creds = undefined; h.defaultChannel = null; });

describe("resolveOtpCreds", () => {
  it("errors when a configured channel no longer resolves — never falls back to env", async () => {
    const r = await resolveOtpCreds("tenant-a", "deleted-channel-id");
    expect(r.error).toMatch(/not available/i);
    expect(r.channel).toBeUndefined();
  });

  it("errors for the platform workspace too when a channel is configured but gone", async () => {
    // The platform workspace may run on env creds with NO channel set — but a
    // set-and-dead channel is a misconfiguration there as well.
    const r = await resolveOtpCreds(DEFAULT_TENANT_ID, "deleted-channel-id");
    expect(r.error).toBeTruthy();
  });

  it("uses the configured channel when it resolves", async () => {
    h.creds = CREDS;
    expect(await resolveOtpCreds("tenant-a", "ch-1")).toEqual({ channel: CREDS });
  });

  it("an UNSET channel uses the tenant's default connected number", async () => {
    h.defaultChannel = "ch-default"; h.creds = CREDS;
    expect(await resolveOtpCreds("tenant-a", "")).toEqual({ channel: CREDS });
  });

  it("a tenant with no number at all is told to connect one, not sent from the platform's", async () => {
    const r = await resolveOtpCreds("tenant-a", "");
    expect(r.error).toMatch(/no whatsapp number connected/i);
  });

  it("only the platform workspace may run on env creds with nothing configured", async () => {
    expect(await resolveOtpCreds(DEFAULT_TENANT_ID, "")).toEqual({});
  });
});
