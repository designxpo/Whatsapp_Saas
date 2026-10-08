import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("@/lib/otp", () => ({
  newOtpCode: () => "1234", otpPepper: () => "pepper",
  safeEqual: (a: string, b: string) => a === b,
}));
import { hashEmailOtp, verifyEmailOtp } from "@/lib/emailotp";

const hash = hashEmailOtp("owner@example.com", "login", "1234", "pepper");
const sentAt = "2026-10-08T10:00:00.123456+00:00";
const claim = { ok: true, out_hash: hash, out_sent_at: sentAt, reason: "claimed" };

beforeEach(() => { rpc.mockReset(); });

describe("email OTP atomic consumption", () => {
  it("authorizes only one verifier after both claimed the same correct code", async () => {
    let claims = 0;
    let consumed = false;
    let release!: () => void;
    const bothClaimed = new Promise<void>((resolve) => { release = resolve; });
    rpc.mockImplementation(async (name, args) => {
      if (name === "email_otp_claim_attempt_v2") {
        if (++claims === 2) release();
        await bothClaimed;
        return { data: [claim], error: null };
      }
      expect(name).toBe("email_otp_consume_if_matches");
      expect(args).toMatchObject({ p_email: "owner@example.com", p_purpose: "login", p_hash: hash, p_sent_at: sentAt });
      const won = !consumed;
      consumed = true;
      return { data: won, error: null };
    });
    const results = await Promise.all([
      verifyEmailOtp(" OWNER@example.com ", "login", "1234"),
      verifyEmailOtp("owner@example.com", "login", "1234"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
  });

  it("does not authorize a replaced issuance even when its digits are identical", async () => {
    rpc.mockResolvedValueOnce({ data: [claim], error: null });
    rpc.mockImplementationOnce(async (name, args) => {
      expect(name).toBe("email_otp_consume_if_matches");
      expect(args.p_sent_at).toBe(sentAt);
      // The database rejects the stale timestamp; the new issuance remains active.
      return { data: false, error: null };
    });
    expect((await verifyEmailOtp("owner@example.com", "login", "1234")).ok).toBe(false);
  });

  it.each([false, null, "true", []])("requires a real boolean consume success: %j", async (data) => {
    rpc.mockResolvedValueOnce({ data: claim, error: null });
    rpc.mockResolvedValueOnce({ data, error: null });
    expect((await verifyEmailOtp("owner@example.com", "login", "1234")).ok).toBe(false);
  });

  it.each(["PGRST202", "08006"])("fails closed when the consume store returns %s", async (code) => {
    rpc.mockResolvedValueOnce({ data: [claim], error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { code } });
    expect(await verifyEmailOtp("owner@example.com", "login", "1234")).toEqual({ ok: false, error: "OTP store unavailable" });
  });

  it("fails closed on a rejected consume request", async () => {
    rpc.mockResolvedValueOnce({ data: [claim], error: null });
    rpc.mockRejectedValueOnce(new Error("network failure"));
    expect((await verifyEmailOtp("owner@example.com", "login", "1234")).ok).toBe(false);
  });

  it("does not consume a wrong code", async () => {
    rpc.mockResolvedValueOnce({ data: [claim], error: null });
    expect(await verifyEmailOtp("owner@example.com", "login", "9999")).toEqual({ ok: false, error: "Incorrect code" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete issuance metadata rather than using the old unsafe consume", async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...claim, out_sent_at: undefined }], error: null });
    expect((await verifyEmailOtp("owner@example.com", "login", "1234")).ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
