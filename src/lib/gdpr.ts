// GDPR / data-protection helpers — tenant-scoped export and right-to-erasure.
// Export: a tenant admin downloads everything the platform holds for their
// workspace. Erase: remove a single contact and all their personal data
// (right to be forgotten). Both are strictly scoped to the caller's tenant.

import { db } from "./supabase";

const digits = (p: string) => (p || "").replace(/\D/g, "");
const last10 = (p: string) => digits(p).slice(-10);

// ── Export ────────────────────────────────────────────────────────────────────
export async function exportTenantData(tenantId: string): Promise<Record<string, unknown>> {
  const grab = async (table: string, cols = "*") => {
    try { const { data } = await db().from(table).select(cols).eq("tenant_id", tenantId).limit(50000); return data ?? []; }
    catch { return []; }
  };
  const [tenant, contacts, conversations, optouts, orders] = await Promise.all([
    db().from("tenants").select("id,name,slug,company,owner_email,plan,created_at").eq("id", tenantId).maybeSingle().then(r => r.data ?? null, () => null),
    grab("contacts", "phone,name,email,tags,attributes,status,source,created_at"),
    grab("wa_conversations", "phone,name,status,last_inbound_at,last_outbound_at,created_at"),
    grab("wa_optouts", "phone,reason,created_at"),
    grab("wa_orders", "phone,items,total_cents,currency,status,created_at"),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    tenant,
    counts: { contacts: contacts.length, conversations: conversations.length, optouts: optouts.length, orders: orders.length },
    contacts, conversations, optouts, orders,
  };
}

// ── Erasure (right to be forgotten) ───────────────────────────────────────────
export interface EraseResult { phone: string; deleted: Record<string, number>; errors: string[] }

export async function eraseContact(tenantId: string, phone: string): Promise<EraseResult> {
  const d = digits(phone), l = last10(phone);
  const variants = [...new Set([d, l].filter(Boolean))];
  const deleted: Record<string, number> = {};
  const errors: string[] = [];

  // Messages + flow sessions hang off conversations (no phone column) — resolve
  // the conversation ids first, then delete their children, then the convs.
  try {
    const { data: convs } = await db().from("wa_conversations").select("id").eq("tenant_id", tenantId).in("phone", variants);
    const convIds = (convs ?? []).map(c => c.id as string);
    if (convIds.length) {
      for (const child of ["wa_conv_messages", "wa_flow_sessions"]) {
        try {
          const { count } = await db().from(child).delete({ count: "exact" }).eq("tenant_id", tenantId).in("conversation_id", convIds);
          deleted[child] = count ?? 0;
        } catch (e) { errors.push(`${child}: ${e instanceof Error ? e.message : e}`); }
      }
    }
  } catch (e) { errors.push(`wa_conversations lookup: ${e instanceof Error ? e.message : e}`); }

  // Everything keyed directly by phone, scoped to the tenant.
  const phoneTables = [
    "contacts", "wa_conversations", "wa_optouts", "wa_send_queue", "wa_send_log",
    "wa_scheduled_sends", "wa_sequence_enrollments", "wa_carts", "wa_orders", "wa_links",
  ];
  for (const t of phoneTables) {
    try {
      const { count } = await db().from(t).delete({ count: "exact" }).eq("tenant_id", tenantId).in("phone", variants);
      deleted[t] = count ?? 0;
    } catch (e) { errors.push(`${t}: ${e instanceof Error ? e.message : e}`); }
  }

  return { phone: d, deleted, errors };
}
