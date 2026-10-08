import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pending: vi.fn(), send: vi.fn(), verify: vi.fn(), createTenant: vi.fn(), database: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth", () => ({
  isPlatformOwnerEmail: (email: string) => email.toLowerCase() === process.env.ADMIN_USER?.toLowerCase(),
  verifyPendingToken: mocks.pending, createPendingToken: vi.fn(), createSession: vi.fn(),
  SESSION_COOKIE: "wa_admin_session", PENDING_SIGNUP_COOKIE: "wa_pending_signup", PENDING_SIGNUP_PURPOSE: "signup_otp_pending",
}));
vi.mock("@/lib/supabase", () => ({ db: mocks.database }));
vi.mock("@/lib/flags", () => ({ getFlag: async () => true }));
vi.mock("@/lib/loginthrottle", () => ({ loginKey: () => "signup", loginThrottle: async () => ({ allowed: true }), recordLoginFailure: async () => undefined }));
vi.mock("@/lib/emailotp", () => ({ sendEmailOtp: mocks.send, verifyEmailOtp: mocks.verify }));
vi.mock("@/lib/tenants", () => ({ createTenantFromSignup: mocks.createTenant }));
vi.mock("@/lib/devices", () => ({ trustDevice: vi.fn(), newDeviceToken: vi.fn(), DEVICE_COOKIE: "device", DEVICE_COOKIE_MAX_AGE: 60 }));

import { POST as signup } from "@/app/api/signup/route";
import { POST as completeSignup } from "@/app/api/signup/verify-otp/route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_USER = "Owner@example.com";
});

function request(body: Record<string, unknown>) {
  return new Request("https://app.example.com/api/signup", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

describe("self-serve signup cannot create platform owner sessions", () => {
  it("rejects the reserved owner email before accessing the database or sending a code", async () => {
    const response = await signup(request({ company: "Company", ownerName: "Owner", ownerEmail: "OWNER@example.com", password: "long-enough", acceptTerms: true }));
    expect(response.status).toBe(400);
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([{ code: "1234" }, { resend: true }])("rejects a previously issued owner signup token: %j", async (body) => {
    mocks.pending.mockResolvedValue({ ownerEmail: "owner@example.com", ownerName: "Owner", company: "Company", password: "encrypted" });
    const response = await completeSignup(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toContain("wa_pending_signup=");
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.createTenant).not.toHaveBeenCalled();
  });
});
