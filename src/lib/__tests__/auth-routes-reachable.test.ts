import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// In the sibling internal repo this exact gate locked the whole portal out of
// production: middleware exempted only the single path "/api/admin/login", so
// every step-TWO route of the login flow was answered 401 before its handler
// ran. Nobody could sign in at all, and existing cookies kept working so it did
// not surface until the next person tried.
//
// This repo is safer by construction — it exempts the whole /api/admin/login
// PREFIX — but that safety is a one-line implementation detail, and a new
// sign-in step placed anywhere else under /api/admin/* would 401 exactly the
// same way. So both halves are asserted: that the prefix rule is still what the
// middleware does, and that every route the signed-out login page calls sits
// under it.

const ROOT = join(__dirname, "../../..");
const middleware = readFileSync(join(ROOT, "src/middleware.ts"), "utf8");

// Everything the login page can call before a session exists.
const SIGN_IN_STEPS = [
  "/api/admin/login",
  "/api/admin/login/verify-otp",
  "/api/admin/login/totp",
  "/api/admin/login/passkey/options",
  "/api/admin/login/passkey/verify",
  "/api/admin/login/forgot",
  "/api/admin/login/forgot/verify",
];

describe("the login flow is reachable without a session", () => {
  it("middleware still exempts the whole /api/admin/login prefix", () => {
    expect(middleware).toContain('!pathname.startsWith("/api/admin/login")');
  });

  for (const path of SIGN_IN_STEPS) {
    it(`${path} exists and is under the exempt prefix`, () => {
      expect(path.startsWith("/api/admin/login")).toBe(true);
      expect(existsSync(join(ROOT, "src/app", path, "route.ts")), `${path} has no route.ts`).toBe(true);
    });
  }

  it("every /api/ path the login page calls is under the exempt prefix", () => {
    const page = readFileSync(join(ROOT, "src/app/login/page.tsx"), "utf8");
    const called = [...page.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]);
    expect(called.length).toBeGreaterThan(0);
    for (const p of called) {
      expect(p.startsWith("/api/admin/login"), `login page calls ${p}, which needs a session`).toBe(true);
    }
  });

  // The other half of the rule: enrolment and management are NOT sign-in steps
  // and must stay behind the gate, or anyone could add a passkey to any account.
  it("keeps enrolment and management behind the session gate", () => {
    for (const p of ["/api/admin/2fa", "/api/admin/2fa/setup", "/api/admin/2fa/confirm",
                     "/api/admin/passkeys", "/api/admin/passkeys/options", "/api/admin/passkeys/verify"]) {
      expect(p.startsWith("/api/admin/login")).toBe(false);
      expect(existsSync(join(ROOT, "src/app", p, "route.ts")), `${p} has no route.ts`).toBe(true);
    }
  });
});
