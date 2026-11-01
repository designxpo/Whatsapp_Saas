// Right to erasure and data export (gdpr.ts), through the real code paths
// against the in-memory database. Two workspaces share a customer in every
// scenario, so an erasure or export that leaked across tenants would show.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  client: null as unknown as Record<string, unknown>,
  removed: [] as string[],
  limits: [] as number[],
}));
vi.mock("../supabase", () => ({ db: () => h.client }));

import { memdb, type MemDb } from "./helpers/memdb";
import { eraseContact, exportTenantStream, exportContactData, subjectOf, ERASED, PAGE_SIZE } from "../gdpr";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "22222222-2222-4222-8222-222222222222";
const PHONE = "919876543210";
const IGSID = "17841400000000001";
const MEDIA = "https://x.supabase.co/storage/v1/object/public/wa-uploads/img/1700_abc.jpg";

let mem: MemDb;

// A table that isn't migrated yet: every query on it answers PGRST205.
function missingTable(): unknown {
  const res = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
  const b: unknown = new Proxy({}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(res).then(ok) : () => b) });
  return b;
}

// The memdb client, plus: tables to pretend are missing, a storage bucket that
// records removals, and a record of every page size requested.
function useDb(missing: string[] = []) {
  h.client = {
    from: (t: string) => {
      if (missing.includes(t)) return missingTable();
      const q = mem.client.from(t) as Record<string, (...a: unknown[]) => unknown>;
      const limit = q.limit;
      q.limit = (n: unknown) => { h.limits.push(n as number); return limit(n); };
      return q;
    },
    rpc: mem.client.rpc,
    storage: { from: () => ({ remove: async (p: string[]) => { h.removed.push(...p); return { data: p.map(name => ({ name })), error: null }; } }) },
  };
}

const put = (table: string, rows: Record<string, unknown>[]) => { (mem.tables[table] ??= []).push(...rows); };

function seed() {
  // The person on WhatsApp, in T1 — and the same number in T2, a different business.
  put("contacts", [
    { id: "k1", tenant_id: T1, phone: PHONE, name: "Asha" },
    { id: "k2", tenant_id: T2, phone: PHONE, name: "Asha" },
    { id: "k3", tenant_id: T1, phone: "919999999999", name: "Someone else" },
  ]);
  put("wa_conversations", [
    { id: "c1", tenant_id: T1, phone: PHONE, platform: "whatsapp", name: "Asha" },
    { id: "c2", tenant_id: T2, phone: PHONE, platform: "whatsapp", name: "Asha" },
    { id: "c3", tenant_id: T1, phone: IGSID, platform: "instagram", name: "@asha.k", lead_phone: null },
    { id: "c4", tenant_id: T1, phone: "web:5b0c", platform: "webchat", name: "Visitor" },
    { id: "c5", tenant_id: T1, phone: "919999999999", platform: "whatsapp", name: "Someone else" },
  ]);
  put("wa_conv_messages", [
    { id: "m1", tenant_id: T1, conversation_id: "c1", role: "user", body: "hi, my address is …", media_url: MEDIA },
    { id: "m2", tenant_id: T1, conversation_id: "c1", role: "assistant", body: "Hello!", media_url: "https://x.supabase.co/storage/v1/object/public/wa-uploads/upload/brochure.pdf" },
    { id: "m3", tenant_id: T2, conversation_id: "c2", role: "user", body: "T2's own chat" },
    { id: "m4", tenant_id: T1, conversation_id: "c3", role: "user", body: "dm on instagram" },
    { id: "m5", tenant_id: T1, conversation_id: "c4", role: "user", body: "web chat" },
    { id: "m6", tenant_id: T1, conversation_id: "c5", role: "user", body: "not them" },
  ]);
  put("wa_conversation_notes", [{ id: "n1", tenant_id: T1, conversation_id: "c1", author_email: "a@b.c", body: "wants EMI" }]);
  put("wa_form_responses", [{ id: "f1", tenant_id: T1, conversation_id: "c1", phone: PHONE, data: { city: "Pune" } }]);
  put("wa_router_events", [
    { id: "r1", tenant_id: T1, phone: PHONE, question: "fees?" },
    { id: "r2", tenant_id: T1, conversation_id: "c1", phone: null, question: "and EMI?" },
    { id: "r3", tenant_id: T2, phone: PHONE, question: "T2 question" },
  ]);
  put("wa_ai_gaps", [{ id: "g1", tenant_id: T1, phone: PHONE, question: "ship to Dubai?" }]);
  put("wa_review_requests", [{ id: "rv1", tenant_id: T1, phone: PHONE, token: "t1" }]);
  put("wa_crm_session", [{ id: "s1", tenant_id: T1, phone: PHONE, kind: "wa" }, { id: "s2", tenant_id: T1, phone: "handle:asha.k", kind: "chat" }]);
  put("wa_flow_arms", [{ tenant_id: T1, phone: "9876543210", flow_id: "fl" }]);
  put("wa_rule_sends", [{ id: "rs1", tenant_id: T1, phone: PHONE }]);
  put("wa_session_refs", [{ id: "sr1", tenant_id: T1, ref_code: "abc", gclid: "G-1", matched_wa_id: PHONE }]);
  put("wa_handoffs", [{ id: "h1", tenant_id: T1, code: "YT-1", platform: "instagram", claimed_phone: PHONE, claimed_conversation_id: "c1" }]);
  put("wa_comment_replies", [
    { id: "cr1", tenant_id: T1, platform: "instagram", comment_author: "@asha.k", comment_text: "price?" },
    { id: "cr2", tenant_id: T1, platform: "facebook", comment_author: "@asha.k", comment_text: "a different person on Facebook" },
  ]);
  put("wa_optouts", [{ tenant_id: T1, phone: PHONE, reason: "STOP" }]);
  put("wa_orders", [
    { id: "o1", tenant_id: T1, phone: PHONE, items: [{ name: "Course", qty: 1 }], total_cents: 499900, currency: "INR", status: "paid", created_at: "2026-09-01T00:00:00Z" },
    { id: "o2", tenant_id: T2, phone: PHONE, items: [], total_cents: 100, currency: "INR", status: "paid" },
  ]);
}

const ids = (t: string) => (mem.tables[t] ?? []).map(r => r.id);

beforeEach(() => {
  mem = memdb();
  h.removed.length = 0; h.limits.length = 0;
  useDb();
  seed();
});

describe("who an identifier names", () => {
  it("treats a phone as its full digits and its last 10, and a platform id only exactly", () => {
    expect(subjectOf("+91 98765-43210")).toEqual({ input: "+91 98765-43210", kind: "phone", ids: ["919876543210", "9876543210"] });
    expect(subjectOf(IGSID).kind).toBe("id");            // 17 digits: past E.164's 15, so not a phone
    expect(subjectOf("web:5b0c")).toEqual({ input: "web:5b0c", kind: "id", ids: ["web:5b0c"] });
  });
});

describe("erasure", () => {
  it("removes a WhatsApp customer from every table that holds them, in this workspace only", async () => {
    const r = await eraseContact(T1, "+91 98765 43210");
    expect(r.errors).toEqual([]);

    expect(ids("contacts")).toEqual(["k2", "k3"]);
    expect(ids("wa_conversations")).toEqual(["c2", "c3", "c4", "c5"]);
    expect(ids("wa_conv_messages")).toEqual(["m3", "m4", "m5", "m6"]);
    for (const t of ["wa_conversation_notes", "wa_form_responses", "wa_ai_gaps", "wa_review_requests", "wa_rule_sends", "wa_session_refs", "wa_handoffs", "wa_optouts", "wa_flow_arms"]) {
      expect(mem.tables[t], t).toEqual([]);
    }
    expect(ids("wa_router_events")).toEqual(["r3"]);              // by phone AND by conversation; T2's stays
    expect(ids("wa_crm_session")).toEqual(["s2"]);                // someone else's Instagram buffer

    // Orders stay for the tax records, without the person.
    const o1 = mem.tables.wa_orders.find(o => o.id === "o1")!;
    expect(o1.phone).toBe(ERASED);
    expect(o1.total_cents).toBe(499900);
    expect(o1.items).toEqual([{ name: "Course", qty: 1 }]);
    expect(mem.tables.wa_orders.find(o => o.id === "o2")!.phone).toBe(PHONE);
    expect(r.anonymised).toEqual({ wa_orders: 1 });

    // The photo they sent goes; the shared brochure we sent them stays.
    expect(h.removed).toEqual(["img/1700_abc.jpg"]);

    // A per-table summary of what went.
    expect(r.deleted).toMatchObject({ contacts: 1, wa_conversations: 1, wa_conv_messages: 2, wa_conversation_notes: 1, wa_router_events: 2, wa_ai_gaps: 1, "storage:wa-uploads": 1 });
  });

  it("erases an Instagram customer by their IGSID, with their comment replies, and never touches a WhatsApp number", async () => {
    const r = await eraseContact(T1, IGSID);
    expect(r.errors).toEqual([]);
    expect(ids("wa_conversations")).toEqual(["c1", "c2", "c4", "c5"]);
    expect(ids("wa_conv_messages")).toEqual(["m1", "m2", "m3", "m5", "m6"]);
    expect(ids("wa_crm_session")).toEqual(["s1"]);
    expect(ids("wa_comment_replies")).toEqual(["cr2"]);           // Facebook display names aren't unique: left alone
    expect(ids("contacts")).toEqual(["k1", "k2", "k3"]);
  });

  it("erases the person behind a conversation id (web chat)", async () => {
    const r = await eraseContact(T1, "00000000-0000-4000-8000-0000000000c4");
    // A uuid that isn't a conversation erases nothing.
    expect(r.deleted.wa_conversations ?? 0).toBe(0);

    mem.tables.wa_conversations.find(c => c.id === "c4")!.id = "00000000-0000-4000-8000-0000000000c4";
    mem.tables.wa_conv_messages.find(m => m.id === "m5")!.conversation_id = "00000000-0000-4000-8000-0000000000c4";
    const r2 = await eraseContact(T1, "00000000-0000-4000-8000-0000000000c4");
    expect(r2.identifiers).toEqual(["web:5b0c"]);
    expect(ids("wa_conv_messages")).not.toContain("m5");
    expect(ids("wa_conversations")).not.toContain("00000000-0000-4000-8000-0000000000c4");
  });

  it("treats a numeric id stored on a Messenger conversation as that id, never as a phone's last 10 digits", async () => {
    put("wa_conversations", [{ id: "c6", tenant_id: T1, phone: "123456789012345", platform: "messenger", name: "M" }]);
    put("wa_flow_arms", [{ tenant_id: T1, phone: "6789012345", flow_id: "x" }]);   // a WhatsApp customer's last 10
    const r = await eraseContact(T1, "123456789012345");
    expect(r.identifiers).toEqual(["123456789012345"]);
    expect(ids("wa_conversations")).not.toContain("c6");
    expect(mem.tables.wa_flow_arms.map(a => a.phone)).toContain("6789012345");
  });

  it("finds the Instagram chat where the person shared their phone number", async () => {
    mem.tables.wa_conversations.find(c => c.id === "c3")!.lead_phone = PHONE;
    await eraseContact(T1, PHONE);
    expect(ids("wa_conversations")).toEqual(["c2", "c4", "c5"]);
    expect(ids("wa_comment_replies")).toEqual(["cr2"]);
  });

  it("skips a table that isn't migrated yet instead of failing", async () => {
    useDb(["wa_ai_gaps", "wa_handoffs"]);
    const r = await eraseContact(T1, PHONE);
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual(expect.arrayContaining(["wa_ai_gaps.phone", "wa_handoffs.claimed_phone"]));
    expect(ids("contacts")).toEqual(["k2", "k3"]);
    expect(mem.tables.wa_ai_gaps).toHaveLength(1);
  });

  it("is safe to run twice", async () => {
    await eraseContact(T1, PHONE);
    const again = await eraseContact(T1, PHONE);
    expect(again.errors).toEqual([]);
    expect(Object.values(again.deleted).every(n => n === 0)).toBe(true);
  });
});

describe("workspace export", () => {
  const read = async (opts?: Parameters<typeof exportTenantStream>[1]) => {
    let text = "";
    for await (const part of exportTenantStream(T1, opts)) text += part;
    return JSON.parse(text);
  };

  it("pages past PostgREST's 1000-row cap and includes message bodies, notes and form responses", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: `mm${String(i).padStart(5, "0")}`, tenant_id: T1, conversation_id: "c1", role: "user", body: `message ${i}` }));
    put("wa_conv_messages", many);
    const out = await read();
    expect(out.tables.messages).toHaveLength(2500 + 5);          // + the seeded T1 messages
    expect(out.tables.messages.every((m: { body: string }) => m.body !== "T2's own chat")).toBe(true);
    expect(out.tables.notes).toEqual([expect.objectContaining({ body: "wants EMI" })]);
    expect(out.tables.form_responses).toHaveLength(1);
    expect(out.tables.contacts.map((c: { id: string }) => c.id)).toEqual(["k1", "k3"]);
    expect(out.summary.messages).toEqual({ rows: 2505, truncated: false });
    expect(Math.max(...h.limits)).toBeLessThanOrEqual(PAGE_SIZE);
    expect(out.included).toEqual(["contacts", "conversations", "messages", "notes", "form_responses", "optouts", "orders"]);
  });

  it("stops a table at the row cap and marks it truncated", async () => {
    put("wa_conv_messages", Array.from({ length: 30 }, (_, i) => ({ id: `mm${String(i).padStart(3, "0")}`, tenant_id: T1, conversation_id: "c1", role: "user", body: "x" })));
    const out = await read({ maxRowsPerTable: 12, pageSize: 5 });
    expect(out.tables.messages).toHaveLength(12);
    expect(out.summary.messages.truncated).toBe(true);
    expect(out.summary.contacts).toEqual({ rows: 2, truncated: false });
    expect(Math.max(...h.limits)).toBe(5);
  });

  it("marks everything truncated when it runs out of time, and still writes valid JSON", async () => {
    const out = await read({ deadlineAt: Date.now() - 1 });
    expect(Object.values(out.summary).every(s => (s as { truncated: boolean }).truncated)).toBe(true);
  });

  it("leaves out a table that isn't migrated yet", async () => {
    useDb(["wa_conversation_notes"]);
    const out = await read();
    expect(out.tables.notes).toEqual([]);
    expect(out.summary.notes).toEqual({ rows: 0, truncated: false });
  });
});

describe("one person's export (access request)", () => {
  it("holds everything about them and nobody else", async () => {
    const out = await exportContactData(T1, PHONE) as Record<string, unknown[]> & { summary: Record<string, unknown> };
    expect((out.messages as { id: string }[]).map(m => m.id)).toEqual(["m1", "m2"]);
    expect(out.notes).toHaveLength(1);
    expect(out.orders).toHaveLength(1);
    expect(out.questions_asked).toHaveLength(1);
    expect(out.contacts).toEqual([expect.objectContaining({ id: "k1" })]);
  });
});
