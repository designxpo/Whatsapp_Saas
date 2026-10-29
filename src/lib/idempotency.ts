import crypto from "crypto";
import { tdb } from "./tenantdb";
import { errorMessage } from "./errors";

// Idempotency for server-to-server POSTs (POST /api/events). A caller that
// retries after a lost response sends the same Idempotency-Key; the first
// request's answer is replayed and nothing is sent twice. Receipts live in
// wa_api_event_receipts (20261029000000) and are pruned after 7 days.

export type IdemClaim =
  | { kind: "new" }                                   // first time: go ahead, then complete()
  | { kind: "replay"; status: number; body: unknown } // seen and finished: answer with this
  | { kind: "busy" }                                  // the first request is still running
  | { kind: "mismatch" }                              // same key, different request
  | { kind: "unavailable" };                          // receipts table missing: proceed without

const STALE_CLAIM_MS = 60_000;

export function requestHash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// A key is 8–100 visible ASCII characters. Returns null when the header is
// absent, an error message when it is malformed.
export function readIdempotencyKey(header: string | null): { key: string | null; error?: string } {
  if (header === null) return { key: null };
  const key = header.trim();
  if (!/^[\x21-\x7e]{8,100}$/.test(key)) return { key: null, error: "Idempotency-Key must be 8 to 100 visible characters" };
  return { key };
}

export async function claimIdempotency(tenantId: string, key: string, hash: string): Promise<IdemClaim> {
  const t = tdb(tenantId);
  const { error } = await t.from("wa_api_event_receipts").insert({ idem_key: key, request_hash: hash });
  if (!error) return { kind: "new" };
  if (error.code !== "23505") {
    // Most likely the migration is not applied yet. Sending once more is the
    // lesser harm than refusing every event, but say so loudly.
    console.error(`[idempotency] receipts unavailable (migration 20261029000000 applied?): ${errorMessage(error)}`);
    return { kind: "unavailable" };
  }
  const { data } = await t.from("wa_api_event_receipts").select("request_hash, status_code, response, created_at").eq("idem_key", key).maybeSingle();
  const row = data as { request_hash: string; status_code: number | null; response: unknown; created_at: string } | null;
  if (!row) return { kind: "busy" };
  if (row.request_hash !== hash) return { kind: "mismatch" };
  if (row.status_code !== null) return { kind: "replay", status: row.status_code, body: row.response };
  // A claim left behind by a crashed request can be taken over after a minute.
  if (Date.now() - Date.parse(row.created_at) > STALE_CLAIM_MS) {
    const { data: taken } = await t.from("wa_api_event_receipts")
      .update({ created_at: new Date().toISOString() })
      .eq("idem_key", key).is("status_code", null).lt("created_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString())
      .select("idem_key");
    if (taken?.length) return { kind: "new" };
  }
  return { kind: "busy" };
}

// Stores the answer for replays. A server error releases the key instead, so
// the caller's retry runs for real.
export async function completeIdempotency(tenantId: string, key: string, status: number, body: unknown): Promise<void> {
  const t = tdb(tenantId);
  if (status >= 500) {
    await t.from("wa_api_event_receipts").delete().eq("idem_key", key).then(() => undefined, () => undefined);
    return;
  }
  await t.from("wa_api_event_receipts").update({ status_code: status, response: body }).eq("idem_key", key).then(() => undefined, () => undefined);
}
