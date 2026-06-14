import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Envelope encryption for secrets at rest (per-tenant Meta access tokens, API
// keys). AES-256-GCM with a master key from env. The serialized form is
// self-describing and versioned so the scheme can evolve:
//
//   v1:<iv b64>:<authTag b64>:<ciphertext b64>
//
// SECRET_ENC_KEY must be a high-entropy secret (>= 32 chars). It is stretched
// with scrypt to a 32-byte AES key. Rotate by introducing a v2 prefix + a new
// key and decrypting-old / encrypting-new lazily on read.
//
// In production, prefer wrapping SECRET_ENC_KEY itself in a cloud KMS; this
// module is the at-rest layer that makes a DB dump useless on its own.

const VERSION = "v1";
let keyCache: Buffer | null = null;

function masterKey(): Buffer {
  if (keyCache) return keyCache;
  const raw = process.env.SECRET_ENC_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("SECRET_ENC_KEY missing or too short (need >= 32 chars of entropy)");
  }
  // Fixed salt: the input is already a strong secret; scrypt here only maps it
  // to exactly 32 bytes. (Per-secret salt is unnecessary for a single env key.)
  keyCache = scryptSync(raw, "alabs-connect:secret-enc:v1", 32);
  return keyCache;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit nonce, standard for GCM
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognized secret format");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

// True if a stored value looks like our envelope (vs a legacy plaintext token).
// Lets call sites migrate gradually: decrypt if encrypted, else treat as raw.
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`) && value.split(":").length === 4;
}

// Decrypt if it's an envelope, otherwise return as-is (legacy plaintext).
export function readSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return isEncrypted(value) ? decryptSecret(value) : value;
}
