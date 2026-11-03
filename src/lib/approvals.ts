// Discounts and refunds the AI may only ASK for.
//
// When a customer negotiates or wants their money back, the AI calls a tool
// (llm.ts) that files a request here and tells the customer the team will
// confirm. It never promises: a person approves or rejects in Live Chat, and
// only then does the customer hear the answer — with, for an approved discount
// on a cart, a payment link at the reduced price.
//
// The workspace sets the policy: whether the AI may ask at all, and the most it
// may ask for. A bigger ask still reaches a person, marked over the limit; the
// limit itself is never told to the customer or the model.

import { tdb } from "./tenantdb";
import { getTenantSetting, setTenantSetting, getConversation, type Conversation } from "./store";
import { getOpenCart, checkoutCart } from "./commerce";
import { sendTeamText, canSendFreeText } from "./team-send";

export type ApprovalKind = "discount" | "refund";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalPolicy {
  discounts: { enabled: boolean; maxPercent: number };
  refunds: { enabled: boolean };
}
const POLICY_KEY = "approval_policy";
export const DEFAULT_POLICY: ApprovalPolicy = { discounts: { enabled: false, maxPercent: 10 }, refunds: { enabled: false } };
const TABLE = "wa_approval_requests";
export const SETUP_HINT = "Approvals aren't set up in the database yet. Apply migration 20261103120000_lead_intel_approvals.sql in Supabase, then reload.";

export async function getApprovalPolicy(tenantId: string): Promise<ApprovalPolicy> {
  const v = await getTenantSetting<Partial<ApprovalPolicy> | null>(tenantId, POLICY_KEY, null);
  return {
    discounts: { enabled: !!v?.discounts?.enabled, maxPercent: clampPercent(v?.discounts?.maxPercent ?? DEFAULT_POLICY.discounts.maxPercent) },
    refunds: { enabled: !!v?.refunds?.enabled },
  };
}

export async function saveApprovalPolicy(tenantId: string, input: Partial<ApprovalPolicy>): Promise<ApprovalPolicy> {
  const cur = await getApprovalPolicy(tenantId);
  const next: ApprovalPolicy = {
    discounts: { enabled: input.discounts?.enabled ?? cur.discounts.enabled, maxPercent: clampPercent(input.discounts?.maxPercent ?? cur.discounts.maxPercent) },
    refunds: { enabled: input.refunds?.enabled ?? cur.refunds.enabled },
  };
  await setTenantSetting(tenantId, POLICY_KEY, next);
  return next;
}

/** A whole percent from 1 to 90 (a 100% "discount" is a gift, not a discount). Pure. */
export function clampPercent(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(90, Math.max(1, v)) : DEFAULT_POLICY.discounts.maxPercent;
}

export interface ApprovalRequest {
  id: string; conversationId: string | null; phone: string; platform: string; kind: ApprovalKind;
  percent: number | null; overLimit: boolean; reason: string | null; orderId: string | null;
  status: ApprovalStatus; decidedBy: string | null; decidedAt: string | null; decisionMessage: string | null;
  resultOrderId: string | null; createdAt: string;
}

function map(r: Record<string, unknown>): ApprovalRequest {
  return {
    id: r.id as string, conversationId: (r.conversation_id as string | null) ?? null, phone: r.phone as string, platform: (r.platform as string) ?? "whatsapp",
    kind: r.kind as ApprovalKind, percent: (r.percent as number | null) ?? null, overLimit: !!r.over_limit, reason: (r.reason as string | null) ?? null,
    orderId: (r.order_id as string | null) ?? null, status: r.status as ApprovalStatus, decidedBy: (r.decided_by as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null, decisionMessage: (r.decision_message as string | null) ?? null,
    resultOrderId: (r.result_order_id as string | null) ?? null, createdAt: r.created_at as string,
  };
}

// ── Filing a request (the AI's tool) ────────────────────────────────────────

/** The chat a tool call belongs to: the one it names, else the contact's latest on this channel. */
async function conversationFor(tenantId: string, phone: string, platform: string, conversationId?: string | null): Promise<string | null> {
  if (conversationId) return conversationId;
  const { data } = await tdb(tenantId).from("wa_conversations").select("id").eq("phone", phone).eq("platform", platform)
    .order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(1);
  return ((data ?? []) as unknown as { id: string }[])[0]?.id ?? null;
}

/**
 * File (or update) the chat's open request of this kind. Returns what the AI
 * should tell the customer — never a yes, never the limit.
 */
export async function requestApproval(p: {
  tenantId: string; phone: string; platform: string; conversationId?: string | null;
  kind: ApprovalKind; percent?: unknown; reason?: unknown; orderRef?: unknown;
}): Promise<{ status: string; requestId?: string }> {
  const policy = await getApprovalPolicy(p.tenantId);
  if (p.kind === "discount" && !policy.discounts.enabled) return { status: "Discounts can't be offered in this chat. Don't promise one; politely explain the price is fixed." };
  if (p.kind === "refund" && !policy.refunds.enabled) return { status: "Refunds are handled by the team. Tell the customer you're passing this to them and they'll be in touch." };
  const conversationId = await conversationFor(p.tenantId, p.phone, p.platform, p.conversationId);
  if (!conversationId) return { status: "Couldn't file the request. Tell the customer the team will get back to them." };
  const percent = p.kind === "discount" ? clampPercent(p.percent) : null;
  const row = {
    conversation_id: conversationId, phone: p.phone, platform: p.platform, kind: p.kind, percent,
    over_limit: p.kind === "discount" ? (percent ?? 0) > policy.discounts.maxPercent : false,
    reason: String(p.reason ?? "").trim().slice(0, 500) || null,
    order_id: /^[0-9a-f-]{36}$/i.test(String(p.orderRef ?? "")) ? String(p.orderRef) : null,
  };
  const t = tdb(p.tenantId);
  const { data: open } = await t.from(TABLE).select("id").eq("conversation_id", conversationId).eq("kind", p.kind).eq("status", "pending").limit(1);
  const existing = ((open ?? []) as unknown as { id: string }[])[0];
  const write = existing
    ? await t.from(TABLE).update(row).eq("id", existing.id).select("id").maybeSingle()
    : await t.from(TABLE).insert({ ...row, status: "pending" }).select("id").maybeSingle();
  if (write.error) {
    console.warn("[approvals] could not file request:", write.error.message);
    return { status: "Couldn't file the request. Tell the customer the team will get back to them shortly; promise nothing." };
  }
  // Shown on the chat at once, before the next lead read.
  await t.from("wa_conversations").update({ lead_action: p.kind === "discount" ? "DISCOUNT_REQUEST" : "REFUND_REQUEST" }).eq("id", conversationId).then(() => undefined, () => undefined);
  const said = p.kind === "discount"
    ? "Request sent to the team. Tell the customer you've asked the team about a better price and will confirm shortly. Do NOT promise or confirm any discount, amount or percentage."
    : "Refund request sent to the team. Tell the customer you've passed it on and the team will confirm shortly. Do NOT promise a refund, an amount or a date.";
  return { status: said, requestId: (write.data as { id?: string } | null)?.id };
}

// ── Reading and deciding (Live Chat) ────────────────────────────────────────

export async function listApprovals(tenantId: string, q: { status?: ApprovalStatus; conversationId?: string; limit?: number } = {}): Promise<{ requests: ApprovalRequest[]; setupNeeded?: string }> {
  let query = tdb(tenantId).from(TABLE).select("*").order("created_at", { ascending: false }).limit(Math.min(100, q.limit ?? 50));
  if (q.status) query = query.eq("status", q.status);
  if (q.conversationId) query = query.eq("conversation_id", q.conversationId);
  const { data, error } = await query;
  if (error) {
    if (/wa_approval_requests|schema cache|does not exist/i.test(error.message)) return { requests: [], setupNeeded: SETUP_HINT };
    throw new Error(error.message);
  }
  return { requests: ((data ?? []) as unknown as Record<string, unknown>[]).map(map) };
}

const fmt = (cents: number) => `₹${(cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** What the customer is told by default; the person deciding can edit it. Pure. */
export function defaultMessage(r: Pick<ApprovalRequest, "kind" | "percent">, decision: "approve" | "reject"): string {
  if (r.kind === "discount") {
    return decision === "approve"
      ? `Good news — we can offer you ${r.percent}% off.`
      : "Thanks for asking — we're not able to offer a discount on this one, but we're happy to help with anything else.";
  }
  return decision === "approve"
    ? "Your refund request has been approved. Our team will process it and confirm once it's done."
    : "We've looked into your refund request and aren't able to approve it this time. Reply here if you'd like us to explain.";
}

/**
 * Approve or reject a pending request and tell the customer. Checks the chat
 * can still be reached first, so a decision is never recorded that the
 * customer didn't hear. An approved discount with an open cart becomes an order
 * at the reduced price with its payment link. "cancel" closes it without a
 * message (the customer was told another way, or it no longer applies).
 */
export async function decideApproval(tenantId: string, id: string, decision: "approve" | "reject" | "cancel", message: string | undefined, actor: string): Promise<{ request?: ApprovalRequest; error?: string; warning?: string }> {
  const { data, error } = await tdb(tenantId).from(TABLE).select("*").eq("id", id).maybeSingle();
  if (error) return { error: /wa_approval_requests|schema cache/i.test(error.message) ? SETUP_HINT : error.message };
  if (!data) return { error: "That request isn't in this workspace." };
  const req = map(data as unknown as Record<string, unknown>);
  if (req.status !== "pending") return { error: `This request was already ${req.status}.` };
  if (decision === "cancel") {
    const done = await tdb(tenantId).from(TABLE).update({ status: "cancelled", decided_by: actor, decided_at: new Date().toISOString() })
      .eq("id", id).eq("status", "pending").select("*").maybeSingle();
    if (done.error) return { error: done.error.message };
    if (!done.data) return { error: "Someone else decided this request a moment ago." };
    if (req.conversationId) await clearAction(tenantId, req.conversationId);
    return { request: map(done.data as unknown as Record<string, unknown>) };
  }
  const conv: Conversation | null = req.conversationId ? await getConversation(req.conversationId, tenantId) : null;
  if (!conv) return { error: "The chat for this request no longer exists." };
  if (!canSendFreeText(conv)) return { error: "WhatsApp's 24-hour window has closed, so the customer can't be told by a normal message. Reach them with an approved template from Live Chat, then cancel this request." };

  let text = (message ?? "").trim() || defaultMessage(req, decision);
  let resultOrderId: string | null = null;
  let warning: string | undefined;
  if (decision === "approve" && req.kind === "discount" && req.percent) {
    const cart = await getOpenCart(conv.phone, tenantId);
    if (cart?.items?.length) {
      const order = await checkoutCart({ phone: conv.phone, discountPercent: req.percent }, tenantId);
      if (order) {
        resultOrderId = order.orderId;
        if (order.paymentUrl && !text.includes(order.paymentUrl)) text += `\n\nYour new total is ${fmt(order.totalCents)}. Pay here: ${order.paymentUrl}`;
        else if (!order.paymentUrl) warning = `Order created at ${fmt(order.totalCents)}, but online payment isn't set up — arrange payment with the customer.`;
      }
    }
  }

  // Claim it before sending, so two people clicking at once can't both send.
  const claim = await tdb(tenantId).from(TABLE).update({
    status: decision === "approve" ? "approved" : "rejected", decided_by: actor, decided_at: new Date().toISOString(),
    decision_message: text.slice(0, 2000), result_order_id: resultOrderId,
  }).eq("id", id).eq("status", "pending").select("*").maybeSingle();
  if (claim.error) return { error: claim.error.message };
  if (!claim.data) return { error: "Someone else decided this request a moment ago." };

  const sent = await sendTeamText(conv, text, actor);
  if (!sent.ok) warning = `Decision saved, but the message didn't go: ${sent.error}${resultOrderId ? " The order is already created." : ""}`;
  await clearAction(tenantId, conv.id);
  return { request: map(claim.data as unknown as Record<string, unknown>), warning };
}

async function clearAction(tenantId: string, conversationId: string): Promise<void> {
  await tdb(tenantId).from("wa_conversations").update({ lead_action: null }).eq("id", conversationId)
    .in("lead_action", ["DISCOUNT_REQUEST", "REFUND_REQUEST"]).then(() => undefined, () => undefined);
}
