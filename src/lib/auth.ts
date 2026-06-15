import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";
import { verifyPassword } from "./team";

const COOKIE = "wa_admin_session";

// Constant-time string compare (avoids login timing oracles).
function strEq(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Pre-multitenant sessions (and the bootstrap owner) belong to the default tenant.
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export interface SessionUser {
  email: string;
  name: string;
  role: "admin" | "member";
  tenantId: string;
}

function secret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  // HS256 needs a ≥256-bit (32-byte) key to meet its security assumptions.
  if (!s || s.length < 32) throw new Error("ADMIN_JWT_SECRET missing or too short (need ≥32 chars)");
  return new TextEncoder().encode(s);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ sub: user.email, n: user.name, r: user.role, t: user.tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string") return null;
    return {
      email: payload.sub,
      name: typeof payload.n === "string" ? payload.n : "",
      // Sessions minted before roles existed are owner sessions → admin.
      role: payload.r === "member" ? "member" : "admin",
      // Sessions minted before multi-tenancy belong to the default tenant.
      tenantId: typeof payload.t === "string" && payload.t ? payload.t : DEFAULT_TENANT_ID,
    };
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
  else if (plain) passOk = strEq(password, plain);
  return userOk && passOk;
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return verifySession(token);
}

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
