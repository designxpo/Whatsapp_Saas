import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.ADMIN_JWT_SECRET = "test-secret-that-is-long-enough-32+chars";

// In-memory stand-in for wa_user_2fa, so the enrol → confirm → verify flow is
// exercised end to end rather than each function in isolation. The parts that
// matter here are the ones a unit test of a single function would miss: that a
// backup code is really consumed, and that a spent TOTP step really cannot come
// back.
const H = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), fail: null as string | null }));

vi.mock("../supabase", () => {
  const builder = () => {
    const state: { op: string; payload?: Record<string, unknown>; email?: string } = { op: "select" };
    const run = async () => {
      if (H.fail) return { data: null, error: { code: H.fail, message: "db said no" } };
      if (state.op === "upsert") { H.rows.set(state.payload!.email as string, { ...state.payload }); return { data: null, error: null }; }
      if (state.op === "update") { const cur = H.rows.get(state.email!); if (cur) H.rows.set(state.email!, { ...cur, ...state.payload }); return { data: null, error: null }; }
      if (state.op === "delete") { H.rows.delete(state.email!); return { data: null, error: null }; }
      return { data: [...H.rows.values()], error: null };
    };
    const b: Record<string, unknown> = {
      select() { state.op = "select"; return b; },
      upsert(p: Record<string, unknown>) { state.op = "upsert"; state.payload = p; return b; },
      update(p: Record<string, unknown>) { state.op = "update"; state.payload = p; return b; },
      delete() { state.op = "delete"; return b; },
      eq(_c: string, v: string) { state.email = v; return b; },
      maybeSingle() {
        if (H.fail) return Promise.resolve({ data: null, error: { code: H.fail, message: "db said no" } });
        return Promise.resolve({ data: H.rows.get(state.email!) ?? null, error: null });
      },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) { return run().then(res, rej); },
    };
    return b;
  };
  return { db: () => ({ from: () => builder() }) };
});

const { beginEnrolment, confirmEnrolment, verifySecondFactor, twoFactorStatus, resetTwoFactor, encryptSecret, decryptSecret, generateBackupCodes, normaliseBackupCode } = await import("../twofactor");
const { totpAt, stepAt } = await import("../totp");

const EMAIL = "priyesh@scaletrix.ai";
const codeNow = (secret: string) => totpAt(secret, stepAt(Date.now()));

beforeEach(() => { H.rows.clear(); H.fail = null; });

describe("secret encryption at rest", () => {
  it("round-trips", () => {
    expect(decryptSecret(encryptSecret("JBSWY3DPEHPK3PXP"))).toBe("JBSWY3DPEHPK3PXP");
  });

  it("produces different ciphertext each time, so equal secrets are not visibly equal in the table", () => {
    expect(encryptSecret("SAME")).not.toBe(encryptSecret("SAME"));
  });

  it("refuses to decrypt tampered ciphertext instead of returning garbage", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP").split(".");
    enc[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(enc.join("."))).toThrow();
  });

  it("never stores the secret in a form the database can read", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    const stored = H.rows.get(EMAIL)!.secret as string;
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
  });
});

describe("backup codes", () => {
  it("are unambiguous to read off a screen — no I, O, 0 or 1", () => {
    for (const c of generateBackupCodes(50)) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("are all different", () => {
    const codes = generateBackupCodes(50);
    expect(new Set(codes).size).toBe(50);
  });

  it("are accepted however they get typed back", () => {
    expect(normaliseBackupCode("abcd-2345")).toBe("ABCD2345");
    expect(normaliseBackupCode("ABCD 2345")).toBe("ABCD2345");
    expect(normaliseBackupCode("abcd2345")).toBe("ABCD2345");
  });
});

describe("enrolment", () => {
  it("does not count as protected until a real code proves the app works", async () => {
    await beginEnrolment(EMAIL);
    expect((await twoFactorStatus(EMAIL)).enrolled).toBe(false);
    // An abandoned setup must not be usable as a second factor either.
    expect(await verifySecondFactor(EMAIL, "000000")).toBe("bad");
  });

  it("rejects a wrong first code and stays unconfirmed", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    const wrong = codeNow(secret) === "000000" ? "111111" : "000000";
    expect((await confirmEnrolment(EMAIL, wrong)).ok).toBe(false);
    expect((await twoFactorStatus(EMAIL)).enrolled).toBe(false);
  });

  it("confirms with the right code and hands back ten single-use codes", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    const { ok, backupCodes } = await confirmEnrolment(EMAIL, codeNow(secret));
    expect(ok).toBe(true);
    expect(backupCodes).toHaveLength(10);
    const status = await twoFactorStatus(EMAIL);
    expect(status.enrolled).toBe(true);
    expect(status.backupRemaining).toBe(10);
  });

  it("refuses to quietly re-enrol an account that is already protected", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    await confirmEnrolment(EMAIL, codeNow(secret));
    // Otherwise anyone holding a stolen password could swap the second factor
    // for their own authenticator and lock the real owner out.
    await expect(beginEnrolment(EMAIL)).rejects.toThrow(/already has two-factor/i);
  });
});

describe("verification", () => {
  it("accepts a live authenticator code", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    await confirmEnrolment(EMAIL, codeNow(secret));
    // The confirming code is burned, so verify with the next step's code.
    const next = totpAt(secret, stepAt(Date.now()) + 1);
    expect(await verifySecondFactor(EMAIL, next)).toBe("ok");
  });

  it("will not take the same code twice", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    await confirmEnrolment(EMAIL, codeNow(secret));
    const next = totpAt(secret, stepAt(Date.now()) + 1);
    expect(await verifySecondFactor(EMAIL, next)).toBe("ok");
    expect(await verifySecondFactor(EMAIL, next)).toBe("bad");
  });

  it("accepts a backup code, then never again", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    const { backupCodes } = await confirmEnrolment(EMAIL, codeNow(secret));
    const code = backupCodes![0];
    expect(await verifySecondFactor(EMAIL, code)).toBe("ok-backup");
    expect(await verifySecondFactor(EMAIL, code)).toBe("bad");
    expect((await twoFactorStatus(EMAIL)).backupRemaining).toBe(9);
  });

  it("spends only the code that was used, leaving the other nine", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    const { backupCodes } = await confirmEnrolment(EMAIL, codeNow(secret));
    await verifySecondFactor(EMAIL, backupCodes![3]);
    expect(await verifySecondFactor(EMAIL, backupCodes![7])).toBe("ok-backup");
    expect((await twoFactorStatus(EMAIL)).backupRemaining).toBe(8);
  });

  it("rejects an unknown account", async () => {
    expect(await verifySecondFactor("nobody@example.com", "000000")).toBe("bad");
  });
});

describe("admin reset (the lost-phone path)", () => {
  it("takes the account back to enrolment", async () => {
    const { secret } = await beginEnrolment(EMAIL);
    await confirmEnrolment(EMAIL, codeNow(secret));
    await resetTwoFactor(EMAIL);
    expect((await twoFactorStatus(EMAIL)).enrolled).toBe(false);
    await expect(beginEnrolment(EMAIL)).resolves.toHaveProperty("secret");
  });
});

// Deploying the code before applying migration 0117 must leave sign-in exactly
// as it was — password plus the emailed new-device code — rather than breaking
// it, and must not look like an authenticator is on when it is not.
describe("migration 0117 not applied", () => {
  it("reports unavailable rather than pretending nobody is enrolled", async () => {
    H.fail = "42P01";
    const status = await twoFactorStatus(EMAIL);
    expect(status.available).toBe(false);
    expect(status.enrolled).toBe(false);
  });

  it("refuses to start enrolment with a message naming the migration", async () => {
    H.fail = "42P01";
    await expect(beginEnrolment(EMAIL)).rejects.toThrow(/0117/);
  });
});

// A table that exists but will not answer is an incident, not a deployment
// step. Reporting it as "2FA unavailable" would let anyone who can provoke a
// database error — or just catch it mid-blip — sign in on a password alone.
describe("the table is there but erroring", () => {
  it("throws rather than reporting 2FA as unavailable", async () => {
    H.fail = "57014";   // query_canceled — a real, transient Postgres error
    await expect(twoFactorStatus(EMAIL)).rejects.toThrow(/two-factor lookup failed/);
  });

  it("will not verify a second factor either", async () => {
    H.fail = "08006";   // connection_failure
    await expect(verifySecondFactor(EMAIL, "000000")).rejects.toThrow();
  });
});
