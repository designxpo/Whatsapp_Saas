// Trusted-device tracking for login 2FA. A device becomes "trusted" (skips the
// email-OTP challenge) once it has completed one — recorded here, keyed by
// email + an opaque random token carried in a long-lived cookie. Keyed by
// email rather than a user id: the platform owner is an env account with no
// `wa_users` row, so email is the only identity both account types share.

import { randomBytes } from "crypto";
import { db } from "./supabase";

export const DEVICE_COOKIE = "wa_device_id";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;   // 180 days

export function newDeviceToken(): string {
  return randomBytes(24).toString("hex");
}

export async function isTrustedDevice(rawEmail: string, deviceToken: string | undefined): Promise<boolean> {
  if (!deviceToken) return false;
  const email = rawEmail.trim().toLowerCase();
  try {
    const { data, error } = await db()
      .from("trusted_devices")
      .select("device_token")
      .eq("email", email)
      .eq("device_token", deviceToken)
      .maybeSingle();
    if (error || !data) return false;
    // Best-effort touch — never blocks the login on failure.
    db().from("trusted_devices").update({ last_seen_at: new Date().toISOString() }).eq("email", email).eq("device_token", deviceToken).then(undefined, () => undefined);
    return true;
  } catch {
    return false;
  }
}

export async function trustDevice(rawEmail: string, deviceToken: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  await db()
    .from("trusted_devices")
    .upsert({ email, device_token: deviceToken, last_seen_at: new Date().toISOString() }, { onConflict: "email,device_token" })
    .then(undefined, () => undefined);   // best-effort — a failed insert just means the NEXT login re-challenges, never blocks THIS one
}
