// WhatsApp OTP service (multi-tenant) — each tenant generates, delivers, and
// verifies login codes over its own WhatsApp number(s). Codes go out as Meta
// AUTHENTICATION templates; only a salted hash is ever stored, and the plaintext
// code never appears in logs or API responses.
//
// Tenancy: every function is scoped by tenantId. The public endpoints resolve
// the tenant from a per-tenant API key (apiKeyTenant); this module never does
// auth. The stored hash is peppered with a single global env secret
// (OTP_HASH_SECRET) — a pepper only, shared across tenants, never an auth token.
// The tenant id is folded into the hash so a code is bound to its tenant.

import { createHash, randomInt, timingSafeEqual } from "crypto";
import { db } from "./supabase";
import { tdb } from "./tenantdb";
import { getTenantSetting, setTenantSetting } from "./store";
import { credsFor, explicitDefaultChannel, type ChannelCreds } from "./channels";
import { DEFAULT_TENANT_ID } from "./tenant";
import { sendAuthTemplate } from "./whatsapp";

export const OTP_COOLDOWN_SECONDS = 45;   // min gap between sends to one phone
export const OTP_DAILY_CAP = 10;          // sends per phone per calendar day
export const OTP_MAX_ATTEMPTS = 5;        // wrong guesses before the code dies
export const OTP_EXPIRY_MINUTES = 10;     // matches the template's footer copy

// Settings keys (wa_settings, tenant-scoped) — configured from Settings → OTP.
export const OTP_CHANNEL_KEY = "otp_channel";     // default channel id, "" = primary/env
export const OTP_ROUTES_KEY = "otp_routes";       // area → number map (multi-number)
export const OTP_TEMPLATE_KEY = "otp_template";   // template name
export const OTP_TEMPLATE_DEFAULT = "login_otp";
export const OTP_TEMPLATE_LANG = "en_US";

// Area → number routes. The website sends { area } and the OTP leaves from that
// area's number; an absent area uses the default (OTP_CHANNEL_KEY). Each area's
// number is a WhatsApp channel id — the auth template must exist on its WABA.
export interface OtpRoute { area: string; channelId: string }

export async function getOtpRoutes(tenantId: string): Promise<OtpRoute[]> {
  const raw = await getTenantSetting<OtpRoute[]>(tenantId, OTP_ROUTES_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && typeof r.area === "string" && r.area.trim() && typeof r.channelId === "string" && r.channelId)
    .map(r => ({ area: r.area.trim(), channelId: r.channelId }));
}

export async function setOtpRoutes(tenantId: string, routes: OtpRoute[]): Promise<void> {
  const seen = new Set<string>();
  const clean = (routes ?? [])
    .filter(r => r && r.area?.trim() && r.channelId)
    .map(r => ({ area: r.area.trim(), channelId: r.channelId }))
    .filter(r => { const k = r.area.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  await setTenantSetting(tenantId, OTP_ROUTES_KEY, clean);
}

// 4-digit code with full 10^4 range (leading zeros allowed), crypto-random.
export function newOtpCode(): string {
  return String(randomInt(0, 10_000)).padStart(4, "0");
}

// The secret peppers the hash, so a leaked table alone can't be brute-forced
// offline against plain sha256(code) rainbow lookups. The tenant id is folded
// in so a code is cryptographically bound to the tenant it was issued for.
export function hashOtp(tenantId: string, phone: string, code: string, secret: string): string {
  return createHash("sha256").update(`${tenantId}:${phone}:${code}:${secret}`).digest("hex");
}

// Constant-time equality over hex strings of possibly different lengths.
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Global pepper for the stored hash. NOT an auth token — auth is the per-tenant
// API key resolved in the route. Falls back to the legacy OTP_API_SECRET name so
// an existing deployment keeps verifying codes issued before the rename.
export function otpPepper(): string {
  return process.env.OTP_HASH_SECRET ?? process.env.OTP_API_SECRET ?? "";
}

const digits = (p: string) => (p || "").replace(/\D/g, "");
const today = () => new Date().toISOString().slice(0, 10);

export interface IssueResult {
  success?: boolean;
  error?: string;
  status?: number;              // suggested HTTP status for the error
  retryAfterSeconds?: number;   // present on cooldown rejections
}

// Maps a Postgres/PostgREST "object missing" error to the apply-migration hint.
function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";  // table / function / not-in-cache
}

// Resolve the sending credentials for a tenant's OTP — LOUDLY. In a multi-tenant
// app the env META_WA_* creds are the PLATFORM's number, so an unresolvable
// channel must be an error, never a silent fall-through to env (a tenant's login
// codes leaving from the shared platform number). A configured id that no longer
// resolves (deleted / foreign) errors; an empty id means "workspace default" and
// uses the tenant's default WhatsApp channel. Only the platform workspace
// (default tenant) may run on env creds with no channels connected.
export async function resolveOtpCreds(tenantId: string, channelId: string): Promise<{ channel?: ChannelCreds; error?: string }> {
  if (channelId) {
    const channel = await credsFor(channelId, tenantId);
    if (!channel) return { error: "OTP number is not available — pick a valid number in Settings → OTP service" };
    return { channel };
  }
  const def = await explicitDefaultChannel(tenantId);
  if (def) {
    const channel = await credsFor(def, tenantId);
    if (channel) return { channel };
  }
  if (tenantId !== DEFAULT_TENANT_ID) return { error: "No WhatsApp number connected — add one in Settings before using the OTP service" };
  return {};  // platform workspace: env single-number mode
}

// Generate + store + send one OTP for a tenant. `opts.area` routes to that
// area's number (multi-number); `opts.channelId` pins a number directly; neither
// → the tenant's default number. The cooldown + daily cap are enforced by the
// otp_reserve_send DB function under a row lock, so concurrent bursts can't
// bypass them. The plaintext code lives only in this stack frame.
export async function issueOtp(tenantId: string, rawPhone: string, opts?: { area?: string; channelId?: string }): Promise<IssueResult> {
  const phone = digits(rawPhone);
  if (phone.length < 8 || phone.length > 15) return { error: "phone must be 8–15 digits", status: 400 };

  // Resolve the sending number BEFORE reserving, so a bad area doesn't burn a
  // send slot. An explicit channelId wins; else an area is looked up (unknown
  // area is a loud 400, never a silent send from the wrong/default number);
  // else the tenant's default number.
  let channelId = (opts?.channelId ?? "").trim();
  if (!channelId && opts?.area?.trim()) {
    const area = opts.area.trim().toLowerCase();
    const match = (await getOtpRoutes(tenantId)).find(r => r.area.toLowerCase() === area);
    if (!match) return { error: `OTP area "${opts.area.trim()}" is not configured`, status: 400 };
    channelId = match.channelId;
  }
  if (!channelId) channelId = await getTenantSetting<string>(tenantId, OTP_CHANNEL_KEY, "");

  // Resolve creds BEFORE reserving (a misconfigured number doesn't burn a send
  // slot) and loudly — never a silent fall-through to the platform env number.
  const creds = await resolveOtpCreds(tenantId, channelId);
  if (creds.error) return { error: creds.error, status: 400 };

  const now = new Date();
  const code = newOtpCode();
  // Reserve atomically BEFORE calling Meta, so a failing burst still honors the
  // cooldown and the row already carries the code we're about to send.
  let gate: { allowed?: boolean; retry_after?: number; reason?: string } | undefined;
  try {
    const { data, error } = await db().rpc("otp_reserve_send", {
      p_tenant: tenantId,
      p_phone: phone,
      p_hash: hashOtp(tenantId, phone, code, otpPepper()),
      p_expires: new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60_000).toISOString(),
      p_cooldown_s: OTP_COOLDOWN_SECONDS,
      p_daily_cap: OTP_DAILY_CAP,
      p_now: now.toISOString(),
    });
    if (error) throw error;
    gate = Array.isArray(data) ? data[0] : data;
  } catch (err) {
    if (isMissingObject(err)) return { error: "OTP store not ready — apply migration 0076_wa_otp.sql", status: 503 };
    return { error: "OTP store unavailable", status: 503 };
  }

  if (!gate?.allowed) {
    if (gate?.reason === "cooldown") return { error: "resend too soon", status: 429, retryAfterSeconds: gate.retry_after };
    if (gate?.reason === "daily_cap") return { error: "daily OTP limit reached for this phone", status: 429 };
    return { error: "OTP not allowed right now", status: 429 };
  }

  const template = await getTenantSetting<string>(tenantId, OTP_TEMPLATE_KEY, OTP_TEMPLATE_DEFAULT);
  const r = await sendAuthTemplate(phone, template, OTP_TEMPLATE_LANG, code, creds.channel);
  if (r.error) {
    console.warn(`[otp] send failed for …${phone.slice(-4)}: ${r.error}`);
    return { error: `send failed: ${r.error}`, status: 502 };
  }
  console.log(JSON.stringify({ tag: "otp_sent", tenant: tenantId, phone: `…${phone.slice(-4)}`, id: r.id }));
  return { success: true };
}

export interface VerifyResult { valid: boolean; reason?: string }

// Check a submitted code for a tenant. otp_claim_attempt atomically checks
// expiry + the attempt cap and increments attempts under a row lock BEFORE we
// compare, so concurrent verifies can't test more than OTP_MAX_ATTEMPTS guesses.
// The hash comparison stays here and is constant-time; only the hash leaves the
// DB. Single-use: a match blanks the hash.
export async function verifyOtp(tenantId: string, rawPhone: string, code: string): Promise<VerifyResult> {
  const phone = digits(rawPhone);
  const submitted = (code || "").trim();
  if (!phone || !/^\d{4,8}$/.test(submitted)) return { valid: false, reason: "bad_input" };

  let claim: { ok?: boolean; out_hash?: string; reason?: string } | undefined;
  try {
    const { data, error } = await db().rpc("otp_claim_attempt", {
      p_tenant: tenantId, p_phone: phone, p_max: OTP_MAX_ATTEMPTS, p_now: new Date().toISOString(),
    });
    if (error) throw error;
    claim = Array.isArray(data) ? data[0] : data;
  } catch { return { valid: false, reason: "store_unavailable" }; }

  if (!claim?.ok) return { valid: false, reason: claim?.reason ?? "no_active_code" };

  const match = safeEqual(hashOtp(tenantId, phone, submitted, otpPepper()), claim.out_hash ?? "");
  if (!match) return { valid: false, reason: "incorrect" };
  // Consume the code (single-use). The attempt slot was already claimed.
  await tdb(tenantId).from("wa_otp_codes").update({ code_hash: "" }).eq("phone", phone).then(undefined, () => undefined);
  return { valid: true };
}

// Settings-card status for a tenant: is everything wired? (Pepper, table,
// channel, template name, today's volume, routes.) Read-only.
export async function otpStatus(tenantId: string): Promise<{
  secretSet: boolean; tableReady: boolean; channelId: string; template: string; sendsToday: number; routes: OtpRoute[];
}> {
  let tableReady = true, sendsToday = 0;
  try {
    const { data, error } = await tdb(tenantId).from("wa_otp_codes").select("sends_today").eq("sends_day", today());
    if (error) throw error;
    const rows = (data ?? []) as unknown as { sends_today?: number }[];
    sendsToday = rows.reduce((n, r) => n + (r.sends_today ?? 0), 0);
  } catch { tableReady = false; }
  return {
    secretSet: !!otpPepper(),
    tableReady,
    channelId: await getTenantSetting<string>(tenantId, OTP_CHANNEL_KEY, ""),
    template: await getTenantSetting<string>(tenantId, OTP_TEMPLATE_KEY, OTP_TEMPLATE_DEFAULT),
    sendsToday,
    routes: await getOtpRoutes(tenantId),
  };
}
