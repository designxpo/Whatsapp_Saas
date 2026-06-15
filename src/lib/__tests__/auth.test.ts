import { describe, it, expect, beforeEach, vi } from "vitest";

// auth.ts imports next/headers (only used inside currentUser, which we don't
// call here). Stub it so importing the module is safe under vitest.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { createSession, verifySession, checkCredentials, DEFAULT_TENANT_ID } from "@/lib/auth";

const OWNER = "owner@alabs.local";

beforeEach(() => {
  process.env.ADMIN_JWT_SECRET = "x".repeat(40);   // ≥32 chars
  process.env.ADMIN_USER = OWNER;
  delete process.env.ADMIN_TOKEN_EPOCH;
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_PASSWORD;
});

describe("JWT session (owner path)", () => {
  it("round-trips a valid owner session with its tenant", async () => {
    const token = await createSession({ email: OWNER, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID, tokenVersion: 0 });
    const u = await verifySession(token);
    expect(u?.email).toBe(OWNER);
    expect(u?.role).toBe("admin");
    expect(u?.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("rejects a tampered token", async () => {
    const token = await createSession({ email: OWNER, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID, tokenVersion: 0 });
    expect(await verifySession(token + "x")).toBeNull();
  });

  it("rejects an empty/undefined token", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("")).toBeNull();
  });

  it("revokes the owner when the token epoch is stale", async () => {
    const token = await createSession({ email: OWNER, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID, tokenVersion: 0 });
    process.env.ADMIN_TOKEN_EPOCH = "3";        // bump epoch → old token (v=0) invalid
    expect(await verifySession(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSession({ email: OWNER, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID, tokenVersion: 0 });
    process.env.ADMIN_JWT_SECRET = "y".repeat(40);
    expect(await verifySession(token)).toBeNull();
  });
});

describe("JWT secret floor", () => {
  it("refuses to mint a session with a secret shorter than 32 chars", async () => {
    process.env.ADMIN_JWT_SECRET = "tooshort";
    await expect(createSession({ email: OWNER, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID })).rejects.toThrow();
  });
});

describe("checkCredentials (owner)", () => {
  it("accepts the right user + plaintext password", () => {
    process.env.ADMIN_PASSWORD = "letmein";
    expect(checkCredentials(OWNER, "letmein")).toBe(true);
  });
  it("rejects a wrong password", () => {
    process.env.ADMIN_PASSWORD = "letmein";
    expect(checkCredentials(OWNER, "nope")).toBe(false);
  });
  it("rejects a wrong username", () => {
    process.env.ADMIN_PASSWORD = "letmein";
    expect(checkCredentials("intruder@x.com", "letmein")).toBe(false);
  });
  it("prefers ADMIN_PASSWORD_HASH when set", async () => {
    const { hashPassword } = await import("@/lib/team");
    process.env.ADMIN_PASSWORD_HASH = hashPassword("hashed-secret");
    expect(checkCredentials(OWNER, "hashed-secret")).toBe(true);
    expect(checkCredentials(OWNER, "hashed-secret-wrong")).toBe(false);
  });
});
