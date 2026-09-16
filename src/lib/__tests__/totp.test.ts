import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, generateSecret, hotp, provisioningUri, stepAt, totpAt, verifyTotp } from "../totp";

// RFC 6238 Appendix B publishes test vectors for exactly this algorithm. Since
// this file implements TOTP by hand rather than taking an npm dependency, those
// vectors ARE the correctness argument — if these pass, the implementation is
// the standard one and every authenticator app will agree with it.
//
// The RFC's SHA-1 seed is the ASCII string "12345678901234567890" (20 bytes),
// which in base32 is GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ. The published codes are
// 8 digits; real enrolment uses 6, which is the same computation truncated.
const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("RFC 6238 test vectors (SHA-1, 8 digits)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [unix, expected] of vectors) {
    it(`T=${unix} → ${expected}`, () => {
      expect(totpAt(RFC_SEED, Math.floor(unix / 30), 8)).toBe(expected);
    });
  }

  it("agrees with the RFC seed decoded back to the original ASCII", () => {
    expect(base32Decode(RFC_SEED).toString("utf8")).toBe("12345678901234567890");
  });
});

// RFC 4226 Appendix D, the HOTP vectors TOTP is built on.
describe("RFC 4226 HOTP vectors", () => {
  const key = Buffer.from("12345678901234567890", "utf8");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  it("produces the published sequence for counters 0-9", () => {
    expect(expected.map((_, c) => hotp(key, c))).toEqual(expected);
  });
});

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const hex of ["00", "ff", "0102030405", "deadbeef", "000102030405060708090a0b0c0d0e0f10111213"]) {
      const buf = Buffer.from(hex, "hex");
      expect(base32Decode(base32Encode(buf))).toEqual(buf);
    }
  });

  it("accepts what people actually paste — lowercase, spaced, dashed", () => {
    const spaced = "gezd gnbv-gy3t qojq gezd gnbv gy3t qojq";
    expect(base32Decode(spaced)).toEqual(base32Decode(RFC_SEED));
  });

  it("refuses a secret that is not base32 rather than silently decoding junk", () => {
    expect(() => base32Decode("not-a-secret!")).toThrow();
  });

  it("generates a 160-bit secret, as RFC 4226 recommends", () => {
    expect(base32Decode(generateSecret()).length).toBe(20);
    expect(generateSecret()).not.toBe(generateSecret());
  });
});

describe("verification window", () => {
  const now = 1_700_000_000_000;      // fixed instant
  const step = stepAt(now);

  it("accepts the code for right now", () => {
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step), { now }).ok).toBe(true);
  });

  it("accepts one step either side, for clock drift between phone and server", () => {
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step - 1), { now }).ok).toBe(true);
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step + 1), { now }).ok).toBe(true);
  });

  it("rejects codes further out than that", () => {
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step - 2), { now }).ok).toBe(false);
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step + 2), { now }).ok).toBe(false);
  });

  it("reports which step matched, so the caller can burn it", () => {
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step - 1), { now }).step).toBe(step - 1);
  });

  it("rejects wrong-length input without doing any crypto", () => {
    expect(verifyTotp(RFC_SEED, "12345", { now }).ok).toBe(false);
    expect(verifyTotp(RFC_SEED, "", { now }).ok).toBe(false);
    expect(verifyTotp(RFC_SEED, "1234567", { now }).ok).toBe(false);
  });
});

// The replay guard is the reason a stolen code is worth nothing a second later.
// Without it, one 6-digit code stays valid for up to 90 seconds — long enough
// for anyone who saw it (a phishing proxy, a shoulder, a log line) to reuse it.
describe("replay guard", () => {
  const now = 1_700_000_000_000;
  const step = stepAt(now);

  it("refuses a code whose step has already been spent", () => {
    const code = totpAt(RFC_SEED, step);
    expect(verifyTotp(RFC_SEED, code, { now }).ok).toBe(true);
    expect(verifyTotp(RFC_SEED, code, { now, minStep: step }).ok).toBe(false);
  });

  it("refuses the PREVIOUS step too once a later one is spent, not just the same one", () => {
    // Drift means step-1 is otherwise acceptable; after spending `step` it must
    // not be, or the window becomes a replay hole in the other direction.
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step - 1), { now, minStep: step }).ok).toBe(false);
  });

  it("still accepts the NEXT code, so the user is not locked out for a minute", () => {
    expect(verifyTotp(RFC_SEED, totpAt(RFC_SEED, step + 1), { now, minStep: step }).ok).toBe(true);
  });
});

describe("provisioning URI", () => {
  const uri = provisioningUri("ABCDEFGH", "priyesh@scaletrix.ai");

  it("carries everything an authenticator needs", () => {
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=ABCDEFGH");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("percent-encodes the issuer instead of turning its space into a plus", () => {
    // URLSearchParams would emit "Talko+AI", which several apps display
    // literally, so the account shows up in the list with a plus sign in it.
    expect(uri).toContain("Talko%20AI");
    expect(uri).not.toContain("Talko+AI");
  });

  it("names the brand the customer actually signed up to", () => {
    // This is the label a person sees in Google Authenticator forever after,
    // beside a six-digit code and nothing else explaining what it unlocks. It
    // defaulted to the repository's old internal name, so every enrolment was
    // filed under a product that does not exist publicly. Pinned in both
    // places the issuer appears: the label prefix and the issuer parameter.
    expect(uri).toContain("otpauth://totp/Talko%20AI:");
    expect(uri).toContain("issuer=Talko%20AI");
    expect(uri).not.toMatch(/alabs/i);
  });

  it("encodes the account so an email's @ cannot break the label", () => {
    expect(uri).toContain("priyesh%40scaletrix.ai");
  });
});
