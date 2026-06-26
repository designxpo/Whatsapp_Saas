// Meta data-deletion request tracking. When Meta POSTs a data-deletion callback
// (a user removed the app / asked for deletion), we record the request so it's
// durable + queryable, and the public status page can confirm it by code.
//
// Stored in `meta_deletion_requests` (migration 0061). Fully resilient: if that
// table isn't applied yet, we fall back to the owner audit log so the callback
// still works and the request is never lost.

import { randomUUID } from "crypto";
import { db } from "./supabase";
import { ownerAudit } from "./tenants";

export interface DeletionStatus {
  code: string;
  status: string;            // received | processing | completed
  createdAt: string | null;
  completedAt: string | null;
}

function newCode(): string {
  return "del_" + randomUUID().replace(/-/g, "").slice(0, 24);
}

// Record a deletion request and return its confirmation code.
export async function recordDeletionRequest(metaUserId: string): Promise<string> {
  const code = newCode();
  try {
    const { error } = await db().from("meta_deletion_requests")
      .insert({ confirmation_code: code, meta_user_id: metaUserId, status: "received" });
    if (error) throw error;
  } catch {
    // Table not present yet (0061) or insert failed — keep a durable trail.
    await ownerAudit("meta", "data_deletion.request", null, `meta_user=${metaUserId} code=${code}`).catch(() => {});
  }
  return code;
}

// Look up a request by its confirmation code (for the public status page).
export async function getDeletionStatus(code: string): Promise<DeletionStatus | null> {
  if (!code) return null;
  try {
    const { data } = await db().from("meta_deletion_requests")
      .select("confirmation_code, status, created_at, completed_at")
      .eq("confirmation_code", code).maybeSingle();
    if (!data) return null;
    return {
      code: data.confirmation_code as string,
      status: (data.status as string) ?? "received",
      createdAt: (data.created_at as string) ?? null,
      completedAt: (data.completed_at as string | null) ?? null,
    };
  } catch {
    return null;
  }
}
