// White-label, Phase 6: a partner's own portal domain (through Vercel) and
// own sending domain (through Resend).
//
// Portal domain: added to this Vercel project by API (VERCEL_TOKEN,
// VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID). The partner points a CNAME at
// Vercel; once Vercel reports the domain verified and correctly configured,
// domain_status becomes 'verified' and only then does the portal answer there
// (brand-lookup.ts brandForDomain). Vercel issues the HTTPS certificate.
// Sending domain: created in Resend (RESEND_API_KEY); the partner adds the
// records Resend returns; once Resend says verified, emails to its customers go
// from no-reply@<that domain>.
//
// Both are owner-controlled from the Partners page; the partner dashboard shows
// the status and the DNS records to add.

import { db } from "./supabase";
import { getPartner, partnerAudit, type Partner } from "./partners";
import { isTalkoHost, whiteLabelConfig } from "./whitelabel";

const VERCEL = "https://api.vercel.com";
const RESEND = "https://api.resend.com";
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function vercelConfigured(): boolean { return !!process.env.VERCEL_TOKEN && !!process.env.VERCEL_PROJECT_ID; }
function vercelUrl(path: string): string {
  const team = process.env.VERCEL_TEAM_ID ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";
  return `${VERCEL}${path}${team}`;
}
async function vercel<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T }> {
  const r = await fetch(vercelUrl(path), { ...init, headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  return { ok: r.ok, status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

/** A domain a partner may use for its portal. Pure. */
export function checkPortalDomain(input: string): { ok: true; domain: string } | { ok: false; error: string } {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!HOST_RE.test(d)) return { ok: false, error: "Enter a domain like portal.yourbrand.com." };
  if (isTalkoHost(d, whiteLabelConfig())) return { ok: false, error: "That address belongs to Talko. Use the partner's own domain." };
  if (d.split(".").length < 3) return { ok: false, error: "Use a subdomain, like portal.yourbrand.com, so the partner's main website keeps working." };
  return { ok: true, domain: d };
}

type VercelDomain = { name?: string; verified?: boolean; verification?: { type: string; domain: string; value: string; reason?: string }[]; error?: { message?: string } };

export async function setPortalDomain(partnerId: string, input: string, actor: string): Promise<{ error?: string }> {
  if (!vercelConfigured()) return { error: "Connecting domains needs VERCEL_TOKEN and VERCEL_PROJECT_ID set in Vercel's environment." };
  const c = checkPortalDomain(input);
  if (!c.ok) return { error: c.error };
  const partner = await getPartner(partnerId);
  if (!partner) return { error: "Partner not found." };
  if (partner.customDomain && partner.customDomain !== c.domain) return { error: "Remove the current domain first." };
  const add = await vercel<VercelDomain>(`/v10/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID!)}/domains`, { method: "POST", body: JSON.stringify({ name: c.domain }) });
  // 409: already on this project (a retry) — fine. Anything else is a real refusal.
  if (!add.ok && add.status !== 409) return { error: `Vercel refused the domain: ${add.body.error?.message ?? `HTTP ${add.status}`}` };
  const { error } = await db().from("wa_partners").update({ custom_domain: c.domain, domain_status: "pending", domain_detail: {} }).eq("id", partnerId);
  if (error) {
    if (error.code === "23505") return { error: "Another partner already uses that domain." };
    throw error;
  }
  await partnerAudit(partnerId, actor, "domain.added", null, c.domain);
  await checkPortalDomain_(partnerId);
  return {};
}

/** Ask Vercel whether the domain is verified and pointed correctly; store what to fix. */
async function checkPortalDomain_(partnerId: string): Promise<Partner["domainStatus"]> {
  const p = await getPartner(partnerId);
  if (!p?.customDomain || !vercelConfigured()) return p?.domainStatus ?? "none";
  const project = encodeURIComponent(process.env.VERCEL_PROJECT_ID!);
  const name = encodeURIComponent(p.customDomain);
  let d = await vercel<VercelDomain>(`/v9/projects/${project}/domains/${name}`);
  if (d.ok && d.body.verified === false) {
    await vercel(`/v9/projects/${project}/domains/${name}/verify`, { method: "POST" });
    d = await vercel<VercelDomain>(`/v9/projects/${project}/domains/${name}`);
  }
  const cfg = await vercel<{ misconfigured?: boolean }>(`/v6/domains/${name}/config`);
  const verified = d.ok && d.body.verified === true && cfg.ok && cfg.body.misconfigured === false;
  const status: Partner["domainStatus"] = verified ? "verified" : d.ok ? "pending" : "error";
  const detail = {
    checkedAt: new Date().toISOString(),
    // What the partner adds at their DNS provider.
    records: [
      { type: "CNAME", name: p.customDomain, value: "cname.vercel-dns.com" },
      ...((d.body.verification ?? []).map(v => ({ type: v.type, name: v.domain, value: v.value }))),
    ],
    problem: verified ? null : !d.ok ? (d.body.error?.message ?? `Vercel HTTP ${d.status}`) : cfg.body.misconfigured ? "The DNS record isn't pointing at Vercel yet." : "Waiting for Vercel to verify the domain.",
  };
  await db().from("wa_partners").update({ domain_status: status, domain_detail: detail }).eq("id", partnerId);
  if (status === "verified" && p.domainStatus !== "verified") await partnerAudit(partnerId, "domains", "domain.verified", null, p.customDomain);
  return status;
}
export const recheckPortalDomain = checkPortalDomain_;

export async function removePortalDomain(partnerId: string, actor: string): Promise<{ error?: string }> {
  const p = await getPartner(partnerId);
  if (!p?.customDomain) return {};
  if (vercelConfigured()) {
    await vercel(`/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID!)}/domains/${encodeURIComponent(p.customDomain)}`, { method: "DELETE" }).catch(() => undefined);
  }
  await db().from("wa_partners").update({ custom_domain: null, domain_status: "none", domain_detail: {} }).eq("id", partnerId);
  await partnerAudit(partnerId, actor, "domain.removed", null, p.customDomain);
  return {};
}

// ── Sending domain (Resend) ─────────────────────────────────────────────────

type ResendDomain = { id?: string; name?: string; status?: string; records?: { record?: string; name?: string; type?: string; value?: string; priority?: number; status?: string }[]; message?: string };
async function resend<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T }> {
  const r = await fetch(`${RESEND}${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  return { ok: r.ok, status: r.status, body: (await r.json().catch(() => ({}))) as T };
}

export async function setEmailDomain(partnerId: string, input: string, actor: string): Promise<{ error?: string }> {
  if (!process.env.RESEND_API_KEY) return { error: "RESEND_API_KEY isn't set." };
  const name = input.trim().toLowerCase().replace(/^@/, "");
  if (!HOST_RE.test(name) || isTalkoHost(name, whiteLabelConfig())) return { error: "Enter the partner's own domain, like yourbrand.com or mail.yourbrand.com." };
  const p = await getPartner(partnerId);
  if (!p) return { error: "Partner not found." };
  if (p.emailDomain?.id) return { error: "Remove the current sending domain first." };
  const r = await resend<ResendDomain>("/domains", { method: "POST", body: JSON.stringify({ name }) });
  if (!r.ok || !r.body.id) return { error: `Resend refused the domain: ${r.body.message ?? `HTTP ${r.status}`}` };
  await db().from("wa_partners").update({ email_domain: { id: r.body.id, name, status: r.body.status ?? "pending", records: r.body.records ?? [] } }).eq("id", partnerId);
  await partnerAudit(partnerId, actor, "email_domain.added", null, name);
  return {};
}

export async function recheckEmailDomain(partnerId: string): Promise<void> {
  const p = await getPartner(partnerId);
  const id = p?.emailDomain?.id;
  if (!id || !process.env.RESEND_API_KEY) return;
  await resend(`/domains/${encodeURIComponent(id)}/verify`, { method: "POST" }).catch(() => undefined);
  const r = await resend<ResendDomain>(`/domains/${encodeURIComponent(id)}`);
  if (!r.ok) return;
  await db().from("wa_partners").update({ email_domain: { id, name: p!.emailDomain.name, status: r.body.status ?? "pending", records: r.body.records ?? p!.emailDomain.records ?? [] } }).eq("id", partnerId);
  if (r.body.status === "verified" && p!.emailDomain.status !== "verified") await partnerAudit(partnerId, "domains", "email_domain.verified", null, p!.emailDomain.name ?? "");
}

export async function removeEmailDomain(partnerId: string, actor: string): Promise<{ error?: string }> {
  const p = await getPartner(partnerId);
  const id = p?.emailDomain?.id;
  if (!id) return {};
  if (process.env.RESEND_API_KEY) await resend(`/domains/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  await db().from("wa_partners").update({ email_domain: {} }).eq("id", partnerId);
  await partnerAudit(partnerId, actor, "email_domain.removed", null, p!.emailDomain.name ?? "");
  return {};
}

/** Cron: re-check domains still waiting on DNS, a few per tick. */
export async function drainPendingDomains(max = 5): Promise<number> {
  if (!whiteLabelConfig().enabled) return 0;
  const { data } = await db().from("wa_partners").select("id,domain_status,email_domain").neq("status", "closed");
  let n = 0;
  for (const r of (data ?? []) as { id: string; domain_status: string; email_domain: { id?: string; status?: string } | null }[]) {
    if (n >= max) break;
    if (r.domain_status === "pending") { await checkPortalDomain_(r.id).catch(() => undefined); n++; }
    if (r.email_domain?.id && r.email_domain.status !== "verified" && n < max) { await recheckEmailDomain(r.id).catch(() => undefined); n++; }
  }
  return n;
}
