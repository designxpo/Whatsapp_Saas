// Secrets at rest (channel tokens, tenant AI keys). The format must keep
// decrypting everything already stored, and must refuse a truncated GCM tag.
import { describe, it, expect, beforeAll } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "crypto";

const TEST_KEY = "test-only-key-0123456789abcdefghijklmnopqrstuvwxyz";
let mod: typeof import("../crypto");

beforeAll(async () => {
  process.env.SECRET_ENC_KEY = TEST_KEY;
  mod = await import("../crypto");
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips, including non-ASCII", () => {
    for (const s of ["EAAG-meta-token", "sk-ant-xyz", "₹ हिंदी ✓", ""]) {
      const blob = mod.encryptSecret(s);
      expect(mod.isEncrypted(blob)).toBe(true);
      expect(mod.decryptSecret(blob)).toBe(s);
    }
  });

  it("always writes a full 16-byte tag", () => {
    const tag = Buffer.from(mod.encryptSecret("x").split(":")[2], "base64");
    expect(tag.length).toBe(16);
  });

  it("still decrypts a blob made the way stored secrets were made", () => {
    // Built by hand with the same derivation and default (16-byte) tag, so a
    // change that broke existing rows would fail here.
    const key = scryptSync(TEST_KEY, "alabs-connect:secret-enc:v1", 32);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([c.update("legacy-token", "utf8"), c.final()]);
    const blob = `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
    expect(mod.decryptSecret(blob)).toBe("legacy-token");
  });

  it("refuses a truncated tag", () => {
    const [v, iv, tag, ct] = mod.encryptSecret("secret").split(":");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    expect(() => mod.decryptSecret([v, iv, short, ct].join(":"))).toThrow();
  });

  it("refuses a tampered ciphertext", () => {
    const [v, iv, tag, ct] = mod.encryptSecret("secret").split(":");
    const bad = Buffer.from(ct, "base64"); bad[0] ^= 1;
    expect(() => mod.decryptSecret([v, iv, tag, bad.toString("base64")].join(":"))).toThrow();
  });
});
