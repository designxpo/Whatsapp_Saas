// Meta data-deletion callback: the request is verified, recorded, carried out
// with the same erasure as a manual request, and marked completed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

const h = vi.hoisted(() => ({
  db: null as unknown as import("./helpers/memdb").MemDb,
  audit: [] as { action: string; tenantId: string | null; detail: string }[],
  afters: [] as (() => Promise<void>)[],
}));
vi.mock("../supabase", () => ({ db: () => h.db.client }));
vi.mock("../tenants", () => ({
  ownerAudit: async (_actor: string, action: string, tenantId: string | null, detail = "") => { h.audit.push({ action, tenantId, detail }); },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => { h.afters.push(fn); } }));

import { memdb } from "./helpers/memdb";
import { processDeletionRequest, drainDeletionRequests, getDeletionStatus } from "../metadeletion";
import { POST } from "../../app/api/webhooks/meta-deletion/route";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const IGSID = "17841400000000077";

const put = (t: string, rows: Record<string, unknown>[]) => { (h.db.tables[t] ??= []).push(...rows); };
const ids = (t: string) => (h.db.tables[t] ?? []).map(r => r.id);

function signed(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${sig}.${body}`;
}

beforeEach(() => {
  h.db = memdb();
  h.audit.length = 0; h.afters.length = 0;
  process.env.META_APP_SECRET = "fb-secret";
  process.env.META_INSTAGRAM_APP_SECRET = "ig-secret";
  put("wa_conversations", [
    { id: "c1", tenant_id: T1, phone: IGSID, platform: "instagram", name: "@x" },
    { id: "c2", tenant_id: T2, phone: IGSID, platform: "instagram", name: "@x" },
    { id: "c3", tenant_id: T3, phone: "919876543210", platform: "whatsapp", name: "Someone" },
  ]);
  put("wa_conv_messages", [
    { id: "m1", tenant_id: T1, conversation_id: "c1", role: "user", body: "hi" },
    { id: "m2", tenant_id: T2, conversation_id: "c2", role: "user", body: "hello" },
    { id: "m3", tenant_id: T3, conversation_id: "c3", role: "user", body: "not them" },
  ]);
  put("contacts", [{ id: "k1", tenant_id: T1, phone: IGSID }]);
  put("wa_ig_follow_gates", [{ tenant_id: T3, igsid: IGSID, rule_id: "r" }]);
  put("wa_channels", [{ id: "ch1", tenant_id: T1, kind: "instagram", ig_user_id: IGSID, access_token: "enc" }]);
  put("meta_deletion_requests", [{ id: "d1", confirmation_code: "del_1", meta_user_id: IGSID, status: "received", created_at: new Date().toISOString(), completed_at: null }]);
});

describe("processing a deletion request", () => {
  it("erases the person in every workspace that holds their id, then marks the request completed", async () => {
    const o = await processDeletionRequest("del_1", IGSID);
    expect(o).toMatchObject({ status: "completed", workspaces: 3, channelsMatched: 1, errors: [] });
    expect(ids("wa_conversations")).toEqual(["c3"]);
    expect(ids("wa_conv_messages")).toEqual(["m3"]);
    expect(h.db.tables.contacts).toEqual([]);
    expect(h.db.tables.wa_ig_follow_gates).toEqual([]);

    const req = h.db.tables.meta_deletion_requests[0];
    expect(req.status).toBe("completed");
    expect(typeof req.completed_at).toBe("string");
    expect(req.detail).toBe(`workspaces=3 rows=${o.rowsDeleted} channels=1`);
    expect((await getDeletionStatus("del_1"))?.status).toBe("completed");

    // A business's own connected account is reported, never changed.
    expect(h.db.tables.wa_channels[0].access_token).toBe("enc");
    expect(h.audit.map(a => a.action)).toEqual(["data_deletion.channel_owner"]);
  });

  it("is idempotent: a completed request is left alone", async () => {
    await processDeletionRequest("del_1", IGSID);
    const at = h.db.tables.meta_deletion_requests[0].completed_at;
    const again = await processDeletionRequest("del_1", IGSID);
    expect(again.status).toBe("skipped");
    expect(h.db.tables.meta_deletion_requests[0].completed_at).toBe(at);
  });

  it("completes a request that matches nothing — we hold nothing under that id", async () => {
    put("meta_deletion_requests", [{ id: "d2", confirmation_code: "del_2", meta_user_id: "999", status: "received" }]);
    const o = await processDeletionRequest("del_2", "999");
    expect(o).toMatchObject({ status: "completed", workspaces: 0 });
    expect(ids("wa_conversations")).toEqual(["c1", "c2", "c3"]);
  });

  it("the engine retries requests the callback didn't finish, and only those", async () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    h.db.tables.meta_deletion_requests[0].created_at = old;
    put("meta_deletion_requests", [
      { id: "d3", confirmation_code: "del_3", meta_user_id: "555", status: "received", created_at: new Date().toISOString() },   // the callback may still be on it
      { id: "d4", confirmation_code: "del_4", meta_user_id: "556", status: "completed", created_at: old },
    ]);
    const r = await drainDeletionRequests(3);
    expect(r).toEqual({ processed: 1, completed: 1 });
    expect(h.db.tables.meta_deletion_requests.find(d => d.id === "d3")!.status).toBe("received");
  });
});

describe("the callback", () => {
  const call = (signedRequest: string) => POST(new Request("https://app.thetalko.in/api/webhooks/meta-deletion", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `signed_request=${encodeURIComponent(signedRequest)}`,
  }));

  it("accepts an Instagram-signed request, answers Meta at once, then carries it out", async () => {
    const res = await call(signed({ user_id: IGSID, algorithm: "HMAC-SHA256" }, "ig-secret"));
    expect(res.status).toBe(200);
    const body = await res.json() as { url: string; confirmation_code: string };
    expect(body.confirmation_code).toMatch(/^del_/);
    expect(body.url).toContain(`/legal/data-deletion?code=${body.confirmation_code}`);

    const rec = h.db.tables.meta_deletion_requests.find(d => d.confirmation_code === body.confirmation_code)!;
    expect(rec.status).toBe("received");
    for (const fn of h.afters) await fn();
    expect(rec.status).toBe("completed");
    expect(ids("wa_conversations")).toEqual(["c3"]);
  });

  it("rejects a request signed with anything else", async () => {
    const res = await call(signed({ user_id: IGSID }, "wrong"));
    expect(res.status).toBe(400);
    expect(h.afters).toHaveLength(0);
  });
});
