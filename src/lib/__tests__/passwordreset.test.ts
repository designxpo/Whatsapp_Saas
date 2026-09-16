import { describe, it, expect, beforeEach, vi } from "vitest";

const H = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  sent: [] as { email: string; purpose: string }[],
  codeOk: true,
}));

vi.mock("../emailotp", () => ({
  sendEmailOtp: async (email: string, purpose: string) => { H.sent.push({ email, purpose }); return { ok: true }; },
  verifyEmailOtp: async () => ({ ok: H.codeOk }),
}));

vi.mock("../supabase", () => {
  const builder = () => {
    const state: { op: string; payload?: Record<string, unknown>; key?: string } = { op: "select" };
    const run = async () => {
      if (state.op === "update") {
        for (const [k, v] of H.users) if (v.id === state.key) H.users.set(k, { ...v, ...state.payload });
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select() { state.op = "select"; return b; },
      update(p: Record<string, unknown>) { state.op = "update"; state.payload = p; return b; },
      eq(_c: string, v: string) { state.key = v; return b; },
      maybeSingle() { return Promise.resolve({ data: H.users.get(state.key!) ?? null, error: null }); },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return run().then(res, rej); },
    };
    return b;
  };
  return { db: () => ({ from: () => builder() }) };
});

const { sendResetCode, resetPassword } = await import("../passwordreset");
const { verifyPassword } = await import("../team");

const EMAIL = "member@acme.test";
const seed = (email = EMAIL, active = true) => H.users.set(email, { id: `u-${email}`, email, token_version: 3, password_hash: "old", active });

beforeEach(() => {
  H.users.clear(); H.sent = []; H.codeOk = true;
  process.env.ADMIN_USER = "owner@talko.test";
});

// Email, not WhatsApp. The WhatsApp OTP service here belongs to the TENANT —
// their connected number, their approved template, their quota — so platform
// sign-in cannot depend on it, and must not spend it.
describe("the reset code goes by email", () => {
  it("sends with its own purpose, not the sign-in one", async () => {
    seed();
    await sendResetCode(EMAIL);
    expect(H.sent).toEqual([{ email: EMAIL, purpose: "reset" }]);
  });

  it("sends nothing for an unknown address", async () => {
    await sendResetCode("nobody@acme.test");
    expect(H.sent).toHaveLength(0);
  });

  // The platform owner's password lives in ADMIN_PASSWORD_HASH, where nothing
  // here can write it — a code would lead nowhere at all.
  it("sends nothing for the platform owner", async () => {
    seed("owner@talko.test");
    await sendResetCode("owner@talko.test");
    expect(H.sent).toHaveLength(0);
  });

  it("sends nothing for a deactivated member", async () => {
    seed(EMAIL, false);
    await sendResetCode(EMAIL);
    expect(H.sent).toHaveLength(0);
  });
});

describe("resetting", () => {
  beforeEach(() => seed());

  it("sets the new password and leaves the old one invalid", async () => {
    expect(await resetPassword(EMAIL, "1234", "a-brand-new-password")).toBe("ok");
    const hash = H.users.get(EMAIL)!.password_hash as string;
    expect(verifyPassword("a-brand-new-password", hash)).toBe(true);
    expect(verifyPassword("old", hash)).toBe(false);
  });

  it("bumps token_version, killing every session from before the reset", async () => {
    // If the reason for resetting was that somebody else had the password,
    // leaving their session alive would defeat the point.
    await resetPassword(EMAIL, "1234", "a-brand-new-password");
    expect(H.users.get(EMAIL)!.token_version).toBe(4);
  });

  it("refuses a wrong code and changes nothing", async () => {
    H.codeOk = false;
    expect(await resetPassword(EMAIL, "0000", "a-brand-new-password")).toBe("bad-code");
    expect(H.users.get(EMAIL)!.password_hash).toBe("old");
  });

  it("refuses a short password before spending the code", async () => {
    expect(await resetPassword(EMAIL, "1234", "short")).toBe("weak-password");
    expect(H.users.get(EMAIL)!.password_hash).toBe("old");
  });

  it("cannot reset the platform owner or a deactivated member", async () => {
    seed("owner@talko.test");
    expect(await resetPassword("owner@talko.test", "1234", "a-brand-new-password")).toBe("no-account");
    seed(EMAIL, false);
    expect(await resetPassword(EMAIL, "1234", "a-brand-new-password")).toBe("no-account");
    expect(H.users.get(EMAIL)!.password_hash).toBe("old");
  });
});
