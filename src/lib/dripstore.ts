import { DEFAULT_TENANT_ID } from "./tenant";
import { tdb } from "./tenantdb";
import { getContactByPhoneLoose } from "./store";
const digits = (s: string) => s.replace(/\D/g, "");
export async function clearContactAttributes(phone: string, keys: string[], tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  if (!keys.length) return false;
  const c = await getContactByPhoneLoose(phone, tenantId);
  if (!c) return false;
  const next = { ...(c.attributes ?? {}) };
  let removed = false;
  for (const k of keys) if (k in next) { delete next[k]; removed = true; }
  if (!removed) return false;
  const { error } = await tdb(tenantId).from("contacts").update({ attributes: next }).eq("id", c.id);
  return !error;
}

export async function markNumberNotOnWhatsApp(phone: string, reason: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  try {
    const { error } = await tdb(tenantId).from("contacts")
      .update({ wa_unreachable_at: new Date().toISOString(), wa_unreachable_reason: reason.slice(0, 300) })
      .eq("phone", digits(phone));
    if (error && (error.code === "42703" || error.code === "PGRST204")) return false;   // 0103 not applied
    return !error;
  } catch { return false; }
}

export async function recordSequenceSend(
  p: { tenantId?: string; phone: string; name?: string | null; metaMessageId?: string | null },tenantId = DEFAULT_TENANT_ID
): Promise<void> {
  if (!p.metaMessageId) return;          // nothing for a callback to match on
  try {
    await tdb(tenantId).from("wa_send_log").insert({
      phone: digits(p.phone),
      recipient_name: (p.name ?? "").slice(0, 200),
      status: "sent",
      meta_message_id: p.metaMessageId,
    });
  } catch (e) {
    // Best-effort: a missing receipt must never turn a delivered message
    // into a retried one.
    console.error(JSON.stringify({ tag: "sequence_send_log_failed", error: String(e) }));
  }
}

export async function countAutomatedSends(conversationId: string, fromIso: string, toIso: string, tenantId = DEFAULT_TENANT_ID): Promise<number> {
  const { count } = await tdb(tenantId).from("wa_conv_messages")
    .select("*", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("source", "bot")
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  return count ?? 0;
}