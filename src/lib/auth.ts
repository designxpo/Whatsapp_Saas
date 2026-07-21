import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { timingSafeEqual } from "crypto";
import { verifyPassword, getMemberAuthState } from "./team";
import { DEFAULT_TENANT_ID } from "./tenant";

const COOKIE = "wa_admin_session";

// Owner sessions carry this epoch; bump ADMIN_TOKEN_EPOCH in the environment to
// force the owner to re-authenticate everywhere (e.g. after a secret rotation).
function ownerEpoch(): number {
  return Number(process.env.ADMIN_TOKEN_EPOCH ?? "0") || 0;
}

// Constant-time string compare (avoids login timing oracles).
function strEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Pre-multitenant sessions (and the bootstrap owner) belong to the default
// tenant. Re-exported from the canonical source (./tenant) so the many
// `@/lib/auth` consumers keep importing it from here.
export { DEFAULT_TENANT_ID };

export interface SessionUser {
  email: string;
  name: string;
  role: "admin" | "member";
  tenantId: string;
  tokenVersion?: number;   // revocation epoch embedded in the JWT
}

function secret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  // HS256 needs a ≥256-bit (32-byte) key to meet its security assumptions.
  if (!s || s.length < 32) throw new Error("ADMIN_JWT_SECRET missing or too short (need ≥32 chars)");
  return new TextEncoder().encode(s);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ sub: user.email, n: user.name, r: user.role, t: user.tenantId, v: user.tokenVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

// Cookie names + JWT `purpose` claims for the two pending (email-OTP) flows.
// Defined here (not in the route files) because a Next.js route.ts file may
// only export HTTP method handlers + a few reserved config names — any other
// export fails the framework's route-type check.
export const PENDING_LOGIN_COOKIE = "wa_pending_login";
export const PENDING_LOGIN_PURPOSE = "login_otp_pending";
export const PENDING_SIGNUP_COOKIE = "wa_pending_signup";
export const PENDING_SIGNUP_PURPOSE = "signup_otp_pending";

// Short-lived tokens for two-step auth flows (email-OTP challenges on login
// and signup). Same secret/algorithm as a real session, but a distinct
// `purpose` claim and a short expiry — verifyPendingToken only accepts a
// token whose purpose matches, so a pending token can never be replayed as a
// real session (verifySession never reads the `purpose` claim, and these are
// never stored in SESSION_COOKIE).
export async function createPendingToken(payload: Record<string, unknown>, purpose: string, ttl = "10m"): Promise<string> {
  return new SignJWT({ ...payload, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function verifyPendingToken<T = Record<string, unknown>>(token: string | undefined, purpose: string): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== purpose) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") return null;
    const email = payload.sub;
    const ver = typeof payload.v === "number" ? payload.v : 0;
    const tenantId = typeof payload.t === "string" && payload.t ? payload.t : DEFAULT_TENANT_ID;

    // Owner session (env account): validated against the owner epoch so the
    // owner can be force-logged-out by bumping ADMIN_TOKEN_EPOCH.
    if (isPlatformOwnerEmail(email)) {
      if (ver !== ownerEpoch()) return null;
      return { email, name: typeof payload.n === "string" ? payload.n : "", role: "admin", tenantId, tokenVersion: ver };
    }

    // Team member: re-read live auth state so deactivation and role changes
    // take effect immediately, and a token_version bump revokes old sessions.
    const state = await getMemberAuthState(email);
    if (!state) return null;                 // deleted / deactivated → reject
    if (state.tokenVersion !== ver) return null;   // revoked (e.g. password changed)
    return { email, name: typeof payload.n === "string" ? payload.n : "", role: state.role, tenantId, tokenVersion: ver };
  } catch {
    return null;
  }
}

// Validate the OWNER credentials against env (team members live in wa_users).
// Prefers ADMIN_PASSWORD_HASH (scrypt "salt:hash", set via hashPassword) so the
// plaintext password never lives in the environment; falls back to a constant-
// time compare of the legacy ADMIN_PASSWORD. Always compares both username and
// password in constant time to avoid timing oracles.
export function checkCredentials(user: string, password: string): boolean {
  const u = process.env.ADMIN_USER;
  if (!u) return false;
  const userOk = strEq(user, u);
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const plain = process.env.ADMIN_PASSWORD;
  let passOk = false;
  if (hash) passOk = verifyPassword(password, hash);
  else if (plain) { warnPlaintextPassword(); passOk = strEq(password, plain); }
  return userOk && passOk;
}

// One-time warning when the owner password is configured in plaintext. The
// scrypt path (ADMIN_PASSWORD_HASH, set via hashPassword) keeps the password
// out of the environment entirely and should be preferred in production.
let plaintextWarned = false;
function warnPlaintextPassword(): void {
  if (plaintextWarned) return;
  plaintextWarned = true;
  console.warn("[auth] ADMIN_PASSWORD is set in plaintext — set ADMIN_PASSWORD_HASH (scrypt) instead so the password never lives in the environment.");
}

// Wrapped in React cache() so the per-request revocation DB lookup in
// verifySession runs at most once per request even when several helpers
// (requireAdmin, currentTenantId, isPlatformOwner…) all call currentUser.
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  return verifySession(token);
});

export async function requireAdmin(): Promise<boolean> {
  return (await currentUser()) !== null;
}

// True only for admins (the owner account or members with the admin role).
export async function requireRoleAdmin(): Promise<boolean> {
  return (await currentUser())?.role === "admin";
}

// The tenant the current request acts within. Returns null when unauthenticated.
// Every tenant-scoped data access (tdb(...)) MUST be keyed on this value.
export async function currentTenantId(): Promise<string | null> {
  return (await currentUser())?.tenantId ?? null;
}

// The PRODUCT OWNER (super-admin) is the env ADMIN_USER account — the only one
// who can see and control every tenant via the owner portal.
export function isPlatformOwnerEmail(email: string | null | undefined): boolean {
  const owner = process.env.ADMIN_USER;
  return !!owner && !!email && email.toLowerCase() === owner.toLowerCase();
}

export async function isPlatformOwner(): Promise<boolean> {
  return isPlatformOwnerEmail((await currentUser())?.email);
}

export const SESSION_COOKIE = COOKIE;
