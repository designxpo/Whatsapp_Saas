import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE = "wa_admin_session";

export interface SessionUser {
  email: string;
  name: string;
  role: "admin" | "member";
}

function secret(): Uint8Array {
  const s = process.env.ADMIN_JWT_SECRET;
  if (!s || s.length < 16) throw new Error("ADMIN_JWT_SECRET missing or too short");
  return new TextEncoder().encode(s);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ sub: user.email, n: user.name, r: user.role })
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
    };
  } catch {
    return null;
  }
}

// Validate the OWNER credentials against env (team members live in wa_users).
export function checkCredentials(user: string, password: string): boolean {
  const u = process.env.ADMIN_USER, p = process.env.ADMIN_PASSWORD;
  return !!u && !!p && user === u && password === p;
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

export const SESSION_COOKIE = COOKIE;
