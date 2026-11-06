// Every token the app signs shares ADMIN_JWT_SECRET. An affiliate signup (public,
// no approval) returned a token whose signature passed the /api/admin gate, the
// routes found no workspace for it, and ~170 handlers then fell back to the
// platform's own Default workspace. These tests pin the three layers of the fix:
// the gate only accepts workspace sessions, verifySession only accepts
// workspace sessions, and no admin route falls back to the Default workspace.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/team", () => ({
  verifyPassword: () => false,
  getMemberAuthState: async () => null,
  getMemberIdentity: async () => null,
}));

import { createSession, verifySession, createAffiliateSession, createPendingToken, PENDING_LOGIN_PURPOSE, DEFAULT_TENANT_ID } from "@/lib/auth";
import { isWorkspaceSessionClaims } from "@/lib/session-claims";
import { decodeJwt } from "jose";

const OWNER = "owner@talko.test";

beforeEach(() => {
  process.env.ADMIN_JWT_SECRET = "s".repeat(48);
  process.env.ADMIN_USER = OWNER;
  delete process.env.ADMIN_TOKEN_EPOCH;
});

describe("which tokens count as a workspace session", () => {
  it("a real workspace session does", async () => {
    const t = await createSession({ email: OWNER, name: "Owner", role: "admin", tenantId: DEFAULT_TENANT_ID, tokenVersion: 0 });
    expect(isWorkspaceSessionClaims(decodeJwt(t))).toBe(true);
    expect((await verifySession(t))?.tenantId).toBe(DEFAULT_TENANT_ID);
  });

  it("an affiliate session does not, even though its signature is valid", async () => {
    const t = await createAffiliateSession({ affiliateId: "6f1c2a8e-0000-4000-8000-000000000000", email: OWNER, name: "x" });
    expect(isWorkspaceSessionClaims(decodeJwt(t))).toBe(false);
    expect(await verifySession(t)).toBeNull();
  });

  it("a half-finished login (password right, email code not entered) does not", async () => {
    const t = await createPendingToken({ email: OWNER, tenantId: DEFAULT_TENANT_ID }, PENDING_LOGIN_PURPOSE);
    expect(isWorkspaceSessionClaims(decodeJwt(t))).toBe(false);
    expect(await verifySession(t)).toBeNull();
  });

  it("a partner-portal session shape does not", () => {
    expect(isWorkspaceSessionClaims({ sub: "a1b2", pid: "p", email: OWNER, v: 0, purpose: "partner_session" })).toBe(false);
  });

  it("anything with a purpose claim, a non-email subject or no workspace does not", () => {
    expect(isWorkspaceSessionClaims({ sub: OWNER, t: DEFAULT_TENANT_ID, purpose: "anything" })).toBe(false);
    expect(isWorkspaceSessionClaims({ sub: "6f1c2a8e-uuid", t: DEFAULT_TENANT_ID })).toBe(false);
    expect(isWorkspaceSessionClaims({ sub: OWNER })).toBe(false);
    expect(isWorkspaceSessionClaims({ t: DEFAULT_TENANT_ID })).toBe(false);
  });
});

describe("no admin route falls back to the Default workspace", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }

  it("never pairs currentTenantId() with a DEFAULT_TENANT_ID fallback", () => {
    const offenders = walk(join(process.cwd(), "src/app/api"))
      .filter(f => /currentTenantId\(\)\)?\s*(\?\?|\|\|)\s*DEFAULT_TENANT_ID/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the middleware gate checks the token kind, not just the signature", () => {
    const src = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(src).toMatch(/return isWorkspaceSessionClaims\(payload\)/);
    // API paths with a dot in the last segment still go through the gate.
    expect(src).toMatch(/"\/api\/:path\*"/);
  });
});
