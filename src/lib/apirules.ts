import { DEFAULT_TENANT_ID } from "./tenant";
import { db } from "./supabase";
import { createCampaign, getContactByPhone, dailySentCount, type Contact } from "./store";
import { sendCampaign, fetchTemplates, dynamicUrlButtonIndexes } from "./whatsapp";
import { credsFor, getChannel } from "./channels";
import { getTrackedUrls } from "./links";
import { getDailyCap } from "./quota";
import { accountCanSend } from "./feature-guard";


// ── API broadcasting rules engine ─────────────────────────────────────────────
// One generic inbound event (name + phone + free-form data) fans out through
// portal-defined rules. Each rule = conditions + template + variable mapping +
// delay + allowed send window + frequency cap. Sends are queued in
// wa_rule_sends and drained by the cron, logging under the rule's hidden
// campaign so the campaign dashboard (funnel/clicks/replies) covers API sends.

export type RuleConditionSource = "payload" | "contact_attr" | "contact_tag" | "contact_field";
export type RuleConditionOp = "equals" | "not_equals" | "contains" | "exists" | "gt" | "lt";

export interface RuleCondition { source: RuleConditionSource; key: string; op: RuleConditionOp; value: string }

export interface ApiRule {
  id: string;
  campaignId: string | null;
  name: string;
  active: boolean;
  eventKey: string;
  conditions: RuleCondition[];
  templateName: string;
  languageCode: string;
  variables: string[];
  headerImageUrl: string | null;
  /**
   * One value per template URL button index, using the same token syntax as
   * `variables` — e.g. ["{{payload.order_id}}"] fills a "Track your delivery"
   * button declared as https://…/track/{{1}}. Empty when the template has no
   * dynamic URL buttons.
   */
  buttonUrlParams: string[];
  delayValue: number;
  delayUnit: "minutes" | "hours" | "days";
  windowStartHour: number | null;
  windowEndHour: number | null;
  frequencyCapHours: number;
  channelId: string | null;     // which WhatsApp number this rule sends from
  tenantId: string;             // owning tenant
  createdAt: string;
}

function mapRule(r: Record<string, unknown>): ApiRule {
  return {
    id: r.id as string,
    campaignId: (r.campaign_id as string | null) ?? null,
    name: r.name as string,
    active: r.active as boolean,
    eventKey: r.event_key as string,
    conditions: (r.conditions as RuleCondition[]) ?? [],
    templateName: r.template_name as string,
    languageCode: (r.language_code as string) ?? "en_US",
    variables: (r.variables as string[]) ?? [],
    headerImageUrl: (r.header_image_url as string | null) ?? null,
    // ?? [] rather than assuming the column: a rule row read before migration
    // 0101 is applied has no such field, and a rules list that throws would
    // take the whole Broadcast tab down.
    buttonUrlParams: (r.button_url_params as string[]) ?? [],
    delayValue: (r.delay_value as number) ?? 0,
    delayUnit: (r.delay_unit as ApiRule["delayUnit"]) ?? "minutes",
    windowStartHour: (r.window_start_hour as number | null) ?? null,
    windowEndHour: (r.window_end_hour as number | null) ?? null,
    frequencyCapHours: (r.frequency_cap_hours as number) ?? 0,
    channelId: (r.channel_id as string | null) ?? null,
    tenantId: (r.tenant_id as string) ?? DEFAULT_TENANT_ID,
    createdAt: r.created_at as string,
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function listRules(tenantId = DEFAULT_TENANT_ID): Promise<ApiRule[]> {
  const { data, error } = await db().from("wa_api_rules").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapRule);
}

/**
 * A rule the admin configured wrong — as opposed to a DB or Meta failure. The
 * route maps this to a 400 with the message shown verbatim, because the admin
 * is the one who can fix it.
 */
export class RuleConfigError extends Error {
  constructor(message: string) { super(message); this.name = "RuleConfigError"; }
}

/**
 * Checks a rule's button-parameter configuration against what the template
 * actually declares. Pure, so the rules can be tested without Meta or a DB.
 *
 * Meta rejects the SEND, not the configuration, in every case below — which
 * previously meant a rule looked fine in the portal and then failed silently
 * for every order. Returns an admin-readable message, or null when valid.
 */
export function validateButtonParams(opts: {
  dynamicIndexes: number[];      // template URL buttons containing {{1}}
  clickTracked: boolean;         // template submitted with click tracking on
  buttonUrlParams: string[];
}): string | null {
  const filled = opts.buttonUrlParams.map(v => (v ?? "").trim());
  const anyFilled = filled.some(Boolean);

  if (opts.clickTracked) {
    // A click-tracked template's URL button is {SITE}/r/{{1}} and its parameter
    // must be the per-recipient short code, which we mint at send time.
    return anyFilled
      ? "This template uses click tracking, so its URL button parameter is the tracking code — remove the button values, or turn click tracking off for the template."
      : null;
  }

  const missing = opts.dynamicIndexes.filter(i => !filled[i]);
  if (missing.length) {
    return `This template has a dynamic URL button (a link ending in {{1}}) at position ${missing.map(i => i + 1).join(", ")}. Meta rejects the send unless every one gets a value — set it to something like {{payload.order_id}}.`;
  }

  const extra = filled.map((v, i) => (v && !opts.dynamicIndexes.includes(i) ? i : -1)).filter(i => i >= 0);
  if (extra.length) {
    return `Button ${extra.map(i => i + 1).join(", ")} on this template is a fixed link, so it takes no value. Meta rejects a send that supplies one — clear it, or change the template's button URL to end in {{1}}.`;
  }
  return null;
}

// Reads the template from Meta and validates the rule's button params against
// it. A template we can't read (Meta down, creds missing, template not synced
// yet) is NOT treated as invalid — blocking configuration on a transient
// third-party failure is worse than the send error this guards against.
async function assertButtonParamsValid(input: { templateName: string; languageCode?: string; channelId?: string | null; buttonUrlParams?: string[] }, tenantId: string): Promise<void> {
  const params = input.buttonUrlParams ?? [];
  let tpl;
  try {
    // tenantId MUST be passed here — omitting it let credsFor resolve ANY
    // tenant's channel row (decrypted access token included) and read that
    // tenant's template list while merely validating this one's rule.
    const channel = await credsFor(input.channelId ?? null, tenantId);
    const all = await fetchTemplates(channel);
    tpl = all.find(t => t.name === input.templateName && (!input.languageCode || t.language === input.languageCode))
      ?? all.find(t => t.name === input.templateName);
  } catch {
    return;   // can't verify → don't block the save
  }
  if (!tpl) return;

  const clickTracked = (await getTrackedUrls(input.templateName, tenantId).catch(() => [])).length > 0;
  const err = validateButtonParams({ dynamicIndexes: dynamicUrlButtonIndexes(tpl), clickTracked, buttonUrlParams: params });
  if (err) throw new RuleConfigError(err);
}

export async function saveRule(input: Partial<ApiRule> & { name: string; eventKey: string; templateName: string }, tenantId = DEFAULT_TENANT_ID): Promise<ApiRule> {
  // A client-supplied channelId must belong to the caller's tenant — otherwise
  // it is persisted on the rule and later used (drainRuleSends) to send through
  // another tenant's WhatsApp number with that tenant's own decrypted Meta
  // token: cross-tenant credential abuse, mis-billing, and the reply lands in
  // the wrong workspace's inbox. Same guard as broadcast.ts's channelId check.
  if (input.channelId) {
    const owned = await getChannel(input.channelId, tenantId);
    if (!owned) throw new RuleConfigError("Channel not found.");
  }
  await assertButtonParamsValid(input, tenantId);

  // Each rule owns a hidden campaign so its sends get funnel + click analytics.
  let campaignId = input.campaignId ?? null;
  if (!input.id && !campaignId) {
    const c = await createCampaign({
      name: `API rule: ${input.name}`,
      templateName: input.templateName,
      languageCode: input.languageCode ?? "en_US",
      variables: input.variables ?? [],
      headerImageUrl: input.headerImageUrl ?? null,
      status: "sent",            // not a sendable campaign — just an analytics anchor
      audience: { mode: "recipients" },
    }, tenantId);
    campaignId = c.id;
  }
  const row = {
    tenant_id: tenantId,
    name: input.name,
    active: input.active ?? true,
    event_key: input.eventKey.trim(),
    conditions: (input.conditions ?? []).filter(c => c.key?.trim()),
    template_name: input.templateName.trim(),
    language_code: input.languageCode ?? "en_US",
    variables: input.variables ?? [],
    header_image_url: input.headerImageUrl ?? null,
    button_url_params: input.buttonUrlParams ?? [],
    delay_value: input.delayValue ?? 0,
    delay_unit: input.delayUnit ?? "minutes",
    window_start_hour: input.windowStartHour ?? null,
    window_end_hour: input.windowEndHour ?? null,
    frequency_cap_hours: input.frequencyCapHours ?? 0,
    channel_id: input.channelId ?? null,
    ...(campaignId ? { campaign_id: campaignId } : {}),
  };
  const q = input.id
    ? db().from("wa_api_rules").update(row).eq("id", input.id).eq("tenant_id", tenantId).select().single()
    : db().from("wa_api_rules").insert(row).select().single();
  const { data, error } = await q;
  if (error) throw error;
  return mapRule(data as Record<string, unknown>);
}

export async function setRuleActive(id: string, active: boolean, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_api_rules").update({ active }).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

export async function deleteRule(id: string, tenantId = DEFAULT_TENANT_ID): Promise<void> {
  const { error } = await db().from("wa_api_rules").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

// ── Evaluation ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

// "a.b.c" path lookup into the event payload.
function dig(obj: Json | undefined, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[part];
  }
  return cur;
}

function conditionValue(c: RuleCondition, ctx: { payload: Json; contact: Contact | null }): unknown {
  switch (c.source) {
    case "payload": return dig(ctx.payload, c.key);
    case "contact_attr": return ctx.contact?.attributes?.[c.key];
    case "contact_tag": return ctx.contact?.tags?.includes(c.key) ? c.key : undefined;
    case "contact_field": {
      const f = c.key as keyof Contact;
      const v = ctx.contact?.[f];
      return typeof v === "string" ? v : undefined;
    }
  }
}

export function evaluateConditions(conds: RuleCondition[], ctx: { payload: Json; contact: Contact | null }): { pass: boolean; failed?: string } {
  for (const c of conds) {
    if (!c.key?.trim()) continue;
    const actual = conditionValue(c, ctx);
    const a = actual === undefined || actual === null ? "" : String(actual);
    const expected = c.value ?? "";
    const label = `${c.source}.${c.key} ${c.op} "${expected}"`;
    const num = (s: string) => parseFloat(s);
    const ok =
      c.op === "exists" ? a !== "" :
      c.op === "equals" ? a.trim().toLowerCase() === expected.trim().toLowerCase() :
      c.op === "not_equals" ? a.trim().toLowerCase() !== expected.trim().toLowerCase() :
      c.op === "contains" ? a.toLowerCase().includes(expected.trim().toLowerCase()) :
      c.op === "gt" ? !isNaN(num(a)) && num(a) > num(expected) :
      c.op === "lt" ? !isNaN(num(a)) && num(a) < num(expected) :
      false;
    if (!ok) return { pass: false, failed: label };
  }
  return { pass: true };
}

// Variable mapping: each template variable can be a literal or use tokens —
// {{payload.x.y}}, {{contact.name}}, {{contact.phone}}, {{contact.email}}, {{contact.attr.key}}.
export function resolveVariables(templateVars: string[], ctx: { payload: Json; contact: Contact | null; phone: string; name: string }): string[] {
  return templateVars.map(v => v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, token: string) => {
    if (token.startsWith("payload.")) { const val = dig(ctx.payload, token.slice(8)); return val === undefined || val === null ? "" : String(val); }
    if (token === "contact.name") return ctx.contact?.name || ctx.name || "";
    if (token === "contact.phone") return ctx.contact?.phone || ctx.phone;
    if (token === "contact.email") return ctx.contact?.email ?? "";
    if (token.startsWith("contact.attr.")) return ctx.contact?.attributes?.[token.slice(13)] ?? "";
    return "";
  }));
}

const IST_OFFSET_MS = 5.5 * 3600_000;

// now + delay, then shifted forward into the rule's allowed window (IST hours).
export function computeSendAfter(rule: Pick<ApiRule, "delayValue" | "delayUnit" | "windowStartHour" | "windowEndHour">, now = Date.now()): string {
  const mult = rule.delayUnit === "days" ? 86_400_000 : rule.delayUnit === "hours" ? 3_600_000 : 60_000;
  let t = now + Math.max(0, rule.delayValue) * mult;
  const start = rule.windowStartHour, end = rule.windowEndHour;
  if (start !== null && end !== null && start < end) {
    const ist = new Date(t + IST_OFFSET_MS);
    const hour = ist.getUTCHours() + ist.getUTCMinutes() / 60;
    if (hour < start) t += (start - hour) * 3600_000;
    else if (hour >= end) t += (24 - hour + start) * 3600_000;   // hold until tomorrow's window opens
  }
  return new Date(t).toISOString();
}

// ── Event processing ─────────────────────────────────────────────────────────

export interface RuleFireResult {
  ruleId: string;
  rule: string;
  outcome: "scheduled" | "skipped" | "dry_run_match";
  detail?: string;
  sendAfter?: string;
  variables?: string[];
  buttonUrlParams?: string[];
}

export async function processEvent(params: {
  event: string;
  phone: string;
  name?: string;
  payload?: Json;
  dryRun?: boolean;
}, tenantId = DEFAULT_TENANT_ID): Promise<RuleFireResult[]> {
  const payload = params.payload ?? {};
  const { data, error } = await db().from("wa_api_rules").select("*").eq("tenant_id", tenantId).eq("event_key", params.event.trim()).eq("active", true);
  if (error) throw error;
  const rules = (data ?? []).map(mapRule);
  if (!rules.length) return [];

  const contact = await getContactByPhone(params.phone, tenantId).catch(() => null);
  const results: RuleFireResult[] = [];

  for (const rule of rules) {
    const base = { ruleId: rule.id, rule: rule.name };

    const cond = evaluateConditions(rule.conditions, { payload, contact });
    if (!cond.pass) { results.push({ ...base, outcome: "skipped", detail: `condition failed: ${cond.failed}` }); continue; }

    // Frequency cap — has this rule already messaged this contact recently?
    if (rule.frequencyCapHours > 0) {
      const since = new Date(Date.now() - rule.frequencyCapHours * 3600_000).toISOString();
      const { count } = await db().from("wa_rule_sends").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("rule_id", rule.id).eq("phone", params.phone.replace(/\D/g, ""))
        .in("status", ["pending", "sending", "sent"]).gte("created_at", since);
      if ((count ?? 0) > 0) { results.push({ ...base, outcome: "skipped", detail: `frequency cap (${rule.frequencyCapHours}h)` }); continue; }
    }

    const ctx = { payload, contact, phone: params.phone, name: params.name ?? "" };
    const variables = resolveVariables(rule.variables, ctx);
    // Resolved here, not at drain time: a delayed send fires against a payload
    // that is already history, and the same token syntax means an order id maps
    // exactly like a body variable does.
    const buttonUrlParams = resolveVariables(rule.buttonUrlParams, ctx);
    const sendAfter = computeSendAfter(rule);

    if (params.dryRun) { results.push({ ...base, outcome: "dry_run_match", sendAfter, variables, buttonUrlParams }); continue; }

    const { error: insErr } = await db().from("wa_rule_sends").insert({
      tenant_id: tenantId,
      rule_id: rule.id,
      phone: params.phone.replace(/\D/g, ""),
      recipient_name: params.name ?? contact?.name ?? "",
      variables,
      button_url_params: buttonUrlParams,
      payload,
      send_after: sendAfter,
    });
    if (insErr) results.push({ ...base, outcome: "skipped", detail: insErr.message });
    else results.push({ ...base, outcome: "scheduled", sendAfter, variables });
  }
  return results;
}

// ── Drain (called from the cron) ─────────────────────────────────────────────

export async function drainRuleSends(max = 100): Promise<{ sent: number; failed: number; skipped: number }> {
  const out = { sent: 0, failed: 0, skipped: 0 };
  let due: Record<string, unknown>[] = [];
  try {
    const { data } = await db().from("wa_rule_sends").select("*")
      .eq("status", "pending").lte("send_after", new Date().toISOString())
      .order("send_after", { ascending: true }).limit(max);
    due = data ?? [];
  } catch { return out; }   // table missing → nothing to do
  if (!due.length) return out;

  // Per-tenant daily headroom — one tenant's volume never blocks another's.
  const ruleCache = new Map<string, ApiRule | null>();
  const headroomByTenant = new Map<string, number>();
  const headroomFor = async (tid: string): Promise<number> => {
    if (!headroomByTenant.has(tid)) {
      headroomByTenant.set(tid, Math.max(0, (await getDailyCap(tid)) - (await dailySentCount(tid).catch(() => 0))));
    }
    return headroomByTenant.get(tid)!;
  };

  for (const row of due) {
    const id = row.id as string;
    // Atomic claim — only one runner wins this row.
    const { data: claimed } = await db().from("wa_rule_sends")
      .update({ status: "sending" }).eq("id", id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;

    const ruleId = row.rule_id as string;
    if (!ruleCache.has(ruleId)) {
      const { data: r } = await db().from("wa_api_rules").select("*").eq("id", ruleId).maybeSingle();
      ruleCache.set(ruleId, r ? mapRule(r) : null);
    }
    const rule = ruleCache.get(ruleId);
    const finish = (status: string, detail?: string) =>
      db().from("wa_rule_sends").update({ status, detail: detail ?? null, processed_at: new Date().toISOString() }).eq("id", id);

    if (!rule) { await finish("failed", "rule deleted"); out.failed++; continue; }
    if (!rule.active) { await finish("cancelled", "rule deactivated"); out.skipped++; continue; }

    // This tenant's daily cap reached → release the claim back to pending so the
    // row is retried after the daily reset (other tenants keep draining).
    if (await headroomFor(rule.tenantId) <= 0) {
      await db().from("wa_rule_sends").update({ status: "pending" }).eq("id", id);
      out.skipped++; continue;
    }

    // Same release-and-retry-later shape as the daily-cap check just above —
    // an account that fixes its billing shouldn't have lost queued sends,
    // just had them wait.
    if (!(await accountCanSend(rule.tenantId))) {
      await db().from("wa_rule_sends").update({ status: "pending" }).eq("id", id);
      out.skipped++; continue;
    }

    try {
      // One-recipient campaign send → logs under the rule's hidden campaign,
      // so opt-outs, click tracking, and the funnel dashboard all apply.
      const r = await sendCampaign({
        campaignId: rule.campaignId ?? "",
        templateName: rule.templateName,
        languageCode: rule.languageCode,
        variables: (row.variables as string[]) ?? [],
        recipients: [{ phone: row.phone as string, fullName: (row.recipient_name as string) ?? "" }],
        headerImageUrl: rule.headerImageUrl,
        buttonUrlParams: (row.button_url_params as string[]) ?? [],
        // tenantId MUST be passed — this is the actual send, so omitting it
        // here is the live version of the save-time hole above: it would
        // resolve and spend ANY tenant's decrypted Meta token, not just a rule
        // saved before the save-time guard existed. Belt-and-suspenders: a
        // channel can also be deleted/reassigned after a rule is saved.
        channel: await credsFor(rule.channelId, rule.tenantId),
        tenantId: rule.tenantId,
      });
      if (r.sentCount > 0) { headroomByTenant.set(rule.tenantId, (headroomByTenant.get(rule.tenantId) ?? 1) - 1); await finish("sent"); out.sent++; }
      else if (r.skippedCount > 0) { await finish("skipped", "opted out"); out.skipped++; }
      else { await finish("failed", r.errors[0] ?? "send failed"); out.failed++; }
    } catch (err) {
      await finish("failed", err instanceof Error ? err.message : String(err));
      out.failed++;
    }
  }
  return out;
}
