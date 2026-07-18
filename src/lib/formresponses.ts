// WhatsApp form lifecycle tracking — sent → submitted / abandoned (multi-tenant).
// Every read/write goes through tdb(tenantId), which auto-scopes reads and stamps
// writes with tenant_id — app-layer scoping is the real guard (the service-role
// client bypasses RLS).

import { tdb } from "./tenantdb";

export type FormStatus = "sent" | "submitted" | "abandoned";
export interface FormResponse {
  id: string;
  tenantId: string;
  conversationId: string | null;
  phone: string;
  formId: string | null;
  status: FormStatus;
  data: Record<string, string> | null;
  sentAt: string;
  submittedAt: string | null;
}

function mapResp(r: Record<string, unknown>): FormResponse {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    conversationId: (r.conversation_id as string | null) ?? null,
    phone: (r.phone as string) ?? "",
    formId: (r.form_id as string | null) ?? null,
    status: (r.status as FormStatus) ?? "sent",
    data: (r.data as Record<string, string> | null) ?? null,
    sentAt: r.sent_at as string,
    submittedAt: (r.submitted_at as string | null) ?? null,
  };
}

export async function recordFormSent(conversationId: string, phone: string, formId: string | null, tenantId: string): Promise<void> {
  await tdb(tenantId).from("wa_form_responses").update({ status: "abandoned" }).eq("conversation_id", conversationId).eq("status", "sent").then(() => {}, () => {});
  await tdb(tenantId).from("wa_form_responses").insert({ conversation_id: conversationId, phone, form_id: formId || null }).then(() => {}, () => {});
}

export async function recordFormSubmitted(conversationId: string, phone: string, data: Record<string, string>, tenantId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: rows } = await tdb(tenantId).from("wa_form_responses").select("id")
    .eq("conversation_id", conversationId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1);
  if (rows && rows.length) {
    await tdb(tenantId).from("wa_form_responses").update({ status: "submitted", data, submitted_at: now }).eq("id", (rows[0] as unknown as Record<string, unknown>).id as string).then(() => {}, () => {});
  } else {
    await tdb(tenantId).from("wa_form_responses").insert({ conversation_id: conversationId, phone, status: "submitted", data, submitted_at: now }).then(() => {}, () => {});
  }
}

export async function markFormAbandoned(conversationId: string, tenantId: string): Promise<boolean> {
  const { data: rows } = await tdb(tenantId).from("wa_form_responses").select("id").eq("conversation_id", conversationId).eq("status", "sent").limit(1);
  if (!rows || !rows.length) return false;
  await tdb(tenantId).from("wa_form_responses").update({ status: "abandoned" }).eq("conversation_id", conversationId).eq("status", "sent").then(() => {}, () => {});
  return true;
}

export async function listFormResponses(tenantId: string, limit = 100): Promise<FormResponse[]> {
  const { data } = await tdb(tenantId).from("wa_form_responses").select("*").order("sent_at", { ascending: false }).limit(Math.min(500, limit));
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(r => mapResp(r));
}
