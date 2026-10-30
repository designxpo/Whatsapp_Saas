// White-label, Phase 5: a partner's own Meta app.
//
// With it, a partner's customers connect Instagram and Facebook through the
// partner's app, so Meta's permission screens show the partner's name instead
// of "Talko.AI". The app is the partner's, but Talko keeps control:
//   - its secrets are entered once, checked against Meta, stored encrypted and
//     never shown again (no API returns them);
//   - Talko subscribes the app's webhooks itself, to Talko's endpoints with
//     ?app=<partner id>, verified with this app's secret;
//   - those events reach only the partner's own workspaces: the partner holds
//     its app's secret, so it could sign anything (partnerScope);
//   - a daily check confirms the webhooks still point at Talko and, when
//     TALKO_META_ADMIN_ID is set, that Talko is still an admin of the app;
//     a problem is recorded, audited and emailed to the platform owner;
//   - `active` off moves the partner's customers back to Talko's app in one step.
// Without an active partner app, everything uses Talko's own app exactly as
// before (the callers fall back to their env credentials). WhatsApp always uses
// Talko's app: its signup configuration lives there, and its events (delivery
// receipts by message id, number health by account) can't be fenced to one
// partner's workspaces.

import crypto from "crypto";
import { db } from "./supabase";
import { encryptSecret, readSecret } from "./crypto";
import { getPartner, partnerAudit, type Partner } from "./partners";
import { sendEmail } from "./email";
import { verifyMetaSignature } from "./apiauth";
import { partnerOrigin, whiteLabelConfig } from "./whitelabel";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;
const DAY = 86_400_000;

interface StoredApp {
  appId?: string; appSecretEnc?: string; igAppId?: string; igAppSecretEnc?: string; fbConfigId?: string;
  verifyToken?: string; active?: boolean; status?: "none" | "ok" | "problem"; problems?: string[]; checkedAt?: string;
}
/** What may leave the server. */
export interface PartnerMetaAppPublic {
  appId: string | null; igAppId: string | null; fbConfigId: string | null; active: boolean;
  status: "none" | "ok" | "problem"; problems: string[]; checkedAt: string | null; hasSecrets: boolean;
}
export interface PartnerMetaCreds { partnerId: string; appId: string; appSecret: string; igAppId: string | null; igAppSecret: string | null; fbConfigId: string | null }

async function stored(partnerId: string): Promise<StoredApp> {
  const { data } = await db().from("wa_partners").select("meta_app").eq("id", partnerId).maybeSingle();
  return ((data as { meta_app?: StoredApp } | null)?.meta_app ?? {}) as StoredApp;
}

export function publicMetaApp(a: StoredApp): PartnerMetaAppPublic {
  return {
    appId: a.appId ?? null, igAppId: a.igAppId ?? null, fbConfigId: a.fbConfigId ?? null, active: !!a.active,
    status: a.status ?? "none", problems: a.problems ?? [], checkedAt: a.checkedAt ?? null, hasSecrets: !!a.appSecretEnc,
  };
}
export async function getPartnerMetaApp(partnerId: string): Promise<PartnerMetaAppPublic> { return publicMetaApp(await stored(partnerId)); }
/** Owner only: the token to paste if a webhook has to be added by hand in Meta's dashboard. */
export async function partnerVerifyToken(partnerId: string): Promise<string | null> { return (await stored(partnerId)).verifyToken ?? null; }

/** Talko's own address for Meta to call, with this partner's marker. */
export function partnerWebhookUrl(partnerId: string, kind: "instagram" | "messenger"): string {
  const host = process.env.NEXT_PUBLIC_APP_HOST || "app.thetalko.in";
  return `https://${host}/api/webhooks/${kind}?app=${encodeURIComponent(partnerId)}`;
}

/**
 * What the partner allows in its Meta app: every address its portal answers
 * on (the sub-address, and its own domain once added). Pure.
 */
export function partnerMetaSetup(p: Pick<Partner, "slug" | "customDomain">): { instagramRedirects: string[]; jsSdkDomains: string[] } {
  const origins = [partnerOrigin(p.slug, whiteLabelConfig()), ...(p.customDomain ? [`https://${p.customDomain}`] : [])];
  return { instagramRedirects: origins.map(o => `${o}/api/admin/onboarding/instagram/callback`), jsSdkDomains: origins.map(o => new URL(o).host) };
}

const ID_RE = /^\d{6,20}$/;

/** Check the app against Meta, then store it (secrets encrypted). Inactive until switched on. */
export async function savePartnerMetaApp(
  partnerId: string, input: { appId?: string; appSecret?: string; igAppId?: string; igAppSecret?: string; fbConfigId?: string }, actor: string,
): Promise<{ error?: string; appName?: string }> {
  const appId = (input.appId ?? "").trim(), appSecret = (input.appSecret ?? "").trim();
  const igAppId = (input.igAppId ?? "").trim(), igAppSecret = (input.igAppSecret ?? "").trim(), fbConfigId = (input.fbConfigId ?? "").trim();
  const cur = await stored(partnerId);
  if (!ID_RE.test(appId)) return { error: "The App ID is the number at the top of the app's Meta dashboard." };
  const secret = appSecret || (cur.appId === appId ? readSecret(cur.appSecretEnc ?? null) ?? "" : "");
  if (!secret) return { error: "Paste the App Secret (App settings → Basic)." };
  if (igAppId && !ID_RE.test(igAppId)) return { error: "The Instagram App ID is a number (Instagram → API setup with Instagram login)." };
  if (fbConfigId && !ID_RE.test(fbConfigId)) return { error: "The Facebook Login for Business configuration ID is a number." };
  const igSecret = igAppSecret || (cur.igAppId === igAppId ? readSecret(cur.igAppSecretEnc ?? null) ?? "" : "");
  if (igAppId && !igSecret) return { error: "Paste the Instagram App Secret too." };
  const r = await fetch(`${GRAPH}/${appId}?fields=name&access_token=${encodeURIComponent(`${appId}|${secret}`)}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) as { name?: string; error?: { message?: string } } : null;
  if (!r || !r.ok || !j?.name) return { error: `Meta didn't accept this App ID and secret${j?.error?.message ? `: ${j.error.message}` : "."}` };
  const next: StoredApp = {
    ...cur, appId, appSecretEnc: encryptSecret(secret), fbConfigId: fbConfigId || undefined,
    igAppId: igAppId || undefined, igAppSecretEnc: igAppId ? encryptSecret(igSecret) : undefined,
    verifyToken: cur.verifyToken || crypto.randomBytes(24).toString("base64url"),
    active: cur.appId === appId ? !!cur.active : false,
    status: cur.appId === appId ? cur.status : "none",
    problems: cur.appId === appId ? cur.problems : [],
    checkedAt: cur.appId === appId ? cur.checkedAt : undefined,
  };
  const { error } = await db().from("wa_partners").update({ meta_app: next }).eq("id", partnerId);
  if (error) throw error;
  await partnerAudit(partnerId, actor, "meta.app_saved", null, `${j.name} (${appId})`);
  return { appName: j.name };
}

/** One switch: the partner's customers connect through its app (on) or Talko's (off). */
export async function setPartnerMetaActive(partnerId: string, active: boolean, actor: string): Promise<{ error?: string }> {
  const cur = await stored(partnerId);
  if (active && (!cur.appId || !cur.appSecretEnc)) return { error: "Save the partner's App ID and secret first." };
  const { error } = await db().from("wa_partners").update({ meta_app: { ...cur, active } }).eq("id", partnerId);
  if (error) throw error;
  await partnerAudit(partnerId, actor, active ? "meta.app_on" : "meta.app_off", null, active ? "customers connect through the partner's app" : "customers connect through Talko's app");
  return {};
}

/** Server-only secrets for a partner app (null unless saved). */
export async function partnerMetaCreds(partnerId: string): Promise<PartnerMetaCreds | null> {
  const a = await stored(partnerId);
  const appSecret = readSecret(a.appSecretEnc ?? null);
  if (!a.appId || !appSecret) return null;
  return { partnerId, appId: a.appId, appSecret, igAppId: a.igAppId ?? null, igAppSecret: readSecret(a.igAppSecretEnc ?? null), fbConfigId: a.fbConfigId ?? null };
}

/**
 * The partner app a workspace's customers connect through, or null for Talko's
 * own app. Null while white-label is off, for any workspace without a partner,
 * and for a partner whose app is switched off.
 */
export async function metaCredsForTenant(tenantId: string | null | undefined): Promise<PartnerMetaCreds | null> {
  if (!whiteLabelConfig().enabled || !tenantId) return null;
  try {
    const { data: t } = await db().from("tenants").select("partner_id").eq("id", tenantId).maybeSingle();
    const pid = (t as { partner_id?: string | null } | null)?.partner_id;
    if (!pid) return null;
    const a = await stored(pid);
    return a.active ? await partnerMetaCreds(pid) : null;
  } catch { return null; }
}

// ── Webhooks marked ?app=<partner id> ───────────────────────────────────────

/** Signature check for a webhook from a partner's app. Fails closed. */
export async function verifyPartnerWebhook(partnerId: string, raw: string, sigHeader: string | null, kind: "instagram" | "messenger"): Promise<boolean> {
  if (!whiteLabelConfig().enabled || !/^[0-9a-f-]{36}$/i.test(partnerId)) return false;
  const c = await partnerMetaCreds(partnerId).catch(() => null);
  if (!c) return false;
  // Instagram-login webhooks are signed with the Instagram app secret.
  const secrets = kind === "instagram" ? [c.igAppSecret, c.appSecret] : [c.appSecret];
  return secrets.some(s => !!s && verifyMetaSignature(raw, sigHeader, s));
}

/**
 * For events from a partner's app: may they reach this workspace? Only the
 * partner's own. Memoised per webhook call.
 */
export function partnerScope(partnerId: string): (tenantId: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return tenantId => {
    if (!seen.has(tenantId)) {
      seen.set(tenantId, Promise.resolve(db().from("tenants").select("partner_id").eq("id", tenantId).maybeSingle())
        .then(({ data }) => (data as { partner_id?: string | null } | null)?.partner_id === partnerId, () => false));
    }
    return seen.get(tenantId)!;
  };
}

/** hub.verify_token check when Meta first subscribes a partner app's webhook. */
export async function partnerVerifyTokenOk(partnerId: string, token: string | null): Promise<boolean> {
  if (!whiteLabelConfig().enabled || !token || !/^[0-9a-f-]{36}$/i.test(partnerId)) return false;
  const a = await stored(partnerId).catch(() => ({} as StoredApp));
  if (!a.verifyToken) return false;
  const x = Buffer.from(token), y = Buffer.from(a.verifyToken);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── Talko sets up, and keeps checking, the app's webhooks ───────────────────

const SUBSCRIPTIONS: { object: string; kind: "instagram" | "messenger"; fields: string; core: string }[] = [
  // The same fields subscribePageToApp / subscribeIgToApp ask for; `core` alone
  // if Meta refuses the full set (as those do for a missing comments permission).
  { object: "page", kind: "messenger", fields: "messages,messaging_postbacks,messaging_optins,message_deliveries,feed,leadgen", core: "messages,messaging_postbacks,messaging_optins,message_deliveries" },
  { object: "instagram", kind: "instagram", fields: "messages,messaging_postbacks,comments", core: "messages,messaging_postbacks" },
];

export async function subscribePartnerWebhooks(partnerId: string, actor: string): Promise<{ results: { object: string; ok: boolean; detail?: string }[] }> {
  const c = await partnerMetaCreds(partnerId);
  const a = await stored(partnerId);
  if (!c || !a.verifyToken) return { results: [{ object: "app", ok: false, detail: "Save the app first." }] };
  const appToken = `${c.appId}|${c.appSecret}`;
  const results: { object: string; ok: boolean; detail?: string }[] = [];
  const subscribe = async (s: (typeof SUBSCRIPTIONS)[number], fields: string) => {
    const body = new URLSearchParams({ object: s.object, callback_url: partnerWebhookUrl(partnerId, s.kind), verify_token: a.verifyToken!, fields, include_values: "true", access_token: appToken });
    const r = await fetch(`${GRAPH}/${c.appId}/subscriptions`, { method: "POST", body, signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } } : null;
    return { ok: !!j?.success, detail: j?.error?.message };
  };
  for (const s of SUBSCRIPTIONS) {
    const full = await subscribe(s, s.fields);
    const r = full.ok ? full : await subscribe(s, s.core);
    results.push({ object: s.object, ok: r.ok, detail: r.ok && !full.ok ? `messages only: ${full.detail ?? "Meta refused comments"}` : r.detail });
  }
  await partnerAudit(partnerId, actor, "meta.webhooks_subscribed", null, results.map(r => `${r.object}:${r.ok ? "ok" : "failed"}`).join(", "));
  await checkPartnerMetaApp(partnerId);
  return { results };
}

/** Compare what Meta has with what Talko expects. Pure: the problems to report. */
export function metaAppProblems(
  partnerId: string,
  subs: { object: string; callback_url?: string; active?: boolean }[] | null,
  roles: { user?: string; role?: string }[] | null,
  talkoAdminId: string | null,
): string[] {
  const problems: string[] = [];
  if (!subs) problems.push("Meta didn't answer with the app's webhooks. Check the App ID and secret.");
  else {
    for (const s of SUBSCRIPTIONS) {
      const found = subs.find(x => x.object === s.object);
      const expected = partnerWebhookUrl(partnerId, s.kind);
      if (!found) problems.push(`No ${s.object} webhook. Run "Set up webhooks".`);
      else if (found.callback_url !== expected) problems.push(`The ${s.object} webhook points somewhere else (${found.callback_url ?? "unknown"}).`);
      else if (found.active === false) problems.push(`The ${s.object} webhook is switched off.`);
    }
  }
  if (talkoAdminId) {
    if (!roles) problems.push("Couldn't read the app's roles.");
    else if (!roles.some(r => r.user === talkoAdminId && r.role === "administrators")) problems.push("Talko is no longer an admin of this app.");
  }
  return problems;
}

export async function checkPartnerMetaApp(partnerId: string): Promise<PartnerMetaAppPublic> {
  const c = await partnerMetaCreds(partnerId);
  const cur = await stored(partnerId);
  if (!c) return publicMetaApp(cur);
  const appToken = encodeURIComponent(`${c.appId}|${c.appSecret}`);
  const get = async (path: string) => {
    const r = await fetch(`${GRAPH}/${c.appId}/${path}?access_token=${appToken}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) as { data?: unknown[] } | null : null;
    return j?.data ?? null;
  };
  const talkoAdmin = (process.env.TALKO_META_ADMIN_ID || "").trim() || null;
  const [subs, roles] = await Promise.all([get("subscriptions"), talkoAdmin ? get("roles") : Promise.resolve(null)]);
  const problems = metaAppProblems(partnerId, subs as never, roles as never, talkoAdmin);
  const status = problems.length ? "problem" : "ok";
  const next: StoredApp = { ...cur, status, problems, checkedAt: new Date().toISOString() };
  await db().from("wa_partners").update({ meta_app: next }).eq("id", partnerId);
  if (status !== (cur.status ?? "none")) {
    await partnerAudit(partnerId, "meta-check", status === "ok" ? "meta.app_ok" : "meta.app_problem", null, problems.join(" "));
    if (status === "problem" && process.env.ADMIN_USER) {
      const p = await getPartner(partnerId);
      await sendEmail({
        to: process.env.ADMIN_USER, subject: `Partner Meta app needs attention: ${p?.name ?? partnerId}`, type: "platform_alert",
        html: `<p>${(p?.name ?? partnerId).replace(/</g, "&lt;")}'s Meta app failed its check:</p><ul>${problems.map(x => `<li>${x.replace(/</g, "&lt;")}</li>`).join("")}</ul><p>Open Owner Portal → Partners to fix it, or switch the partner back to Talko's app.</p>`,
        text: `${p?.name ?? partnerId}'s Meta app failed its check:\n- ${problems.join("\n- ")}`,
      }).catch(() => undefined);
    }
  }
  return publicMetaApp(next);
}

/** Cron: each partner app checked about once a day. */
export async function drainPartnerMetaChecks(max = 3): Promise<number> {
  if (!whiteLabelConfig().enabled) return 0;
  const { data } = await db().from("wa_partners").select("id,meta_app").neq("status", "closed");
  let n = 0;
  for (const r of (data ?? []) as { id: string; meta_app: StoredApp | null }[]) {
    if (n >= max) break;
    const a = r.meta_app ?? {};
    if (!a.appId || !a.appSecretEnc) continue;
    if (a.checkedAt && Date.now() - Date.parse(a.checkedAt) < DAY) continue;
    await checkPartnerMetaApp(r.id).catch(e => console.error("[partner-meta] check", r.id, e));
    n++;
  }
  return n;
}
