// The platform owner's address (ADMIN_USER) can't be used to create any other
// account: a session with that email gets owner powers. The refusal never says
// whose address it is.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ dbCalls: 0 }));
vi.mock("../supabase", () => ({ db: () => { h.dbCalls++; throw new Error("database must not be reached"); } }));
vi.mock("../email", () => ({ sendEmail: async () => ({ ok: true }) }));

import { isReservedEmail, RESERVED_EMAIL_MESSAGE } from "../reserved-email";
import { saveUser } from "../team";
import { checkNewWorkspace, invitePartnerUser } from "../partner-portal";
import { enrollAffiliate } from "../affiliates";
import type { Partner } from "../partners";

const OWNER = "Founder@Talko.test";
let prev: string | undefined;
beforeEach(() => { prev = process.env.ADMIN_USER; process.env.ADMIN_USER = OWNER; h.dbCalls = 0; });
afterEach(() => { if (prev === undefined) delete process.env.ADMIN_USER; else process.env.ADMIN_USER = prev; });

describe("isReservedEmail", () => {
  it("matches the owner address case-insensitively and trimmed", () => {
    expect(isReservedEmail("founder@talko.test")).toBe(true);
    expect(isReservedEmail("  FOUNDER@TALKO.TEST  ")).toBe(true);
    expect(isReservedEmail("someone@talko.test")).toBe(false);
    expect(isReservedEmail("")).toBe(false);
    expect(isReservedEmail(null)).toBe(false);
  });

  it("trims the env value too, and reserves nothing when it is unset", () => {
    process.env.ADMIN_USER = "  founder@talko.test ";
    expect(isReservedEmail("Founder@talko.test")).toBe(true);
    delete process.env.ADMIN_USER;
    expect(isReservedEmail("founder@talko.test")).toBe(false);
  });

  it("the message does not reveal whose address it is", () => {
    expect(RESERVED_EMAIL_MESSAGE).toMatch(/can't be used/);
    expect(RESERVED_EMAIL_MESSAGE.toLowerCase()).not.toMatch(/owner|admin|platform|reserved/);
  });
});

describe("account-creating paths refuse it before touching the database", () => {
  it("team members (add or change email)", async () => {
    await expect(saveUser({ email: " founder@TALKO.test", name: "x", role: "member", password: "long-enough-pw" }, "t1")).rejects.toThrow(RESERVED_EMAIL_MESSAGE);
    await expect(saveUser({ id: "u1", email: "founder@talko.test", name: "x", role: "admin" }, "t1")).rejects.toThrow(RESERVED_EMAIL_MESSAGE);
    expect(h.dbCalls).toBe(0);
  });

  it("affiliate enrollment", async () => {
    await expect(enrollAffiliate({ email: "FOUNDER@talko.test", name: "x", password: "long-enough-pw" })).rejects.toThrow(RESERVED_EMAIL_MESSAGE);
    expect(h.dbCalls).toBe(0);
  });

  it("partner-created workspaces and partner staff invites", async () => {
    const r = checkNewWorkspace({ company: "Acme", ownerName: "Asha", ownerEmail: "founder@talko.test", plan: "growth" }, ["growth"]);
    expect(r).toEqual({ ok: false, error: RESERVED_EMAIL_MESSAGE });
    expect(checkNewWorkspace({ company: "Acme", ownerName: "Asha", ownerEmail: "asha@acme.test", plan: "growth" }, ["growth"]).ok).toBe(true);
    const inv = await invitePartnerUser({ id: "p1" } as Partner, { email: "Founder@Talko.test", name: "x" }, "actor@p.test");
    expect(inv).toEqual({ error: RESERVED_EMAIL_MESSAGE });
    expect(h.dbCalls).toBe(0);
  });
});
