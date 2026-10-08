import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { middleware } from "@/middleware";

beforeEach(() => {
  process.env.ADMIN_JWT_SECRET = "s".repeat(40);
});

async function requestWithToken(payload: Record<string, unknown>) {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.ADMIN_JWT_SECRET));
  return new NextRequest("https://app.example.com/api/admin/settings", {
    headers: { cookie: `wa_admin_session=${token}` },
  });
}

describe("middleware session purpose isolation", () => {
  it.each(["login_otp_pending", "login_totp_pending", "signup_otp_pending", "affiliate_session"])(
    "rejects %s tokens in the admin cookie", async (purpose) => {
      const response = await middleware(await requestWithToken({ sub: "owner@example.com", purpose }));
      expect(response.status).toBe(401);
    },
  );

  it("rejects signed tokens with no session subject", async () => {
    const response = await middleware(await requestWithToken({ email: "owner@example.com" }));
    expect(response.status).toBe(401);
  });

  it("lets a session token reach the route's live authorization check", async () => {
    const response = await middleware(await requestWithToken({ sub: "owner@example.com", t: "tenant-a" }));
    expect(response.status).toBe(200);
  });
});
