// A website visitor is anonymous, so a phone number they type in web chat is
// only a claim. When it matches an EXISTING contact, landCapturedLead must not
// rename the chat to that person or change their contact; it labels the chat
// as carrying an unverified phone and leaves the team a note. A NEW number is
// still captured as a contact, and other channels still merge as before.
import { describe, it, expect, vi, beforeEach } from "vitest";

type Op = { table: string; op: string; payload?: unknown; filters: [string, string, unknown][] };
const ops: Op[] = [];
let convRow: Record<string, unknown> | null = null;
let contactRows: Record<string, unknown>[] = [];

function stubDb() {
  return {
    from(table: string) {
      const rec: Op = { table, op: "select", filters: [] };
      ops.push(rec);
      const result = () => {
        if (rec.op === "select" && table === "wa_conversations") return { data: convRow, error: null };
        if (rec.op === "select" && table === "contacts") return { data: contactRows, error: null };
        if (rec.op === "insert" && table === "wa_conversation_notes") return { data: { id: "n1", author_email: "system", author_name: "Talko", body: (rec.payload as { body: string }).body, created_at: "now" }, error: null };
        return { data: [], error: null };
      };
      const chain: Record<string, unknown> = {
        select: (cols?: string) => { if (rec.op === "select") rec.payload = cols; return chain; },
        insert: (p: unknown) => { rec.op = "insert"; rec.payload = p; return chain; },
        update: (p: unknown) => { rec.op = "update"; rec.payload = p; return chain; },
        upsert: (p: unknown) => { rec.op = "upsert"; rec.payload = p; return chain; },
        eq: (c: string, v: unknown) => { rec.filters.push(["eq", c, v]); return chain; },
        in: (c: string, v: unknown) => { rec.filters.push(["in", c, v]); return chain; },
        like: (c: string, v: unknown) => { rec.filters.push(["like", c, v]); return chain; },
        or: (v: string) => { rec.filters.push(["or", "", v]); return chain; },
        limit: () => chain,
        order: () => chain,
        range: () => chain,
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
      };
      return chain;
    },
  };
}
vi.mock("../supabase", () => ({ db: () => stubDb() }));
vi.mock("../tenantdb", () => ({ tdb: () => stubDb() }));

import { landCapturedLead, UNVERIFIED_PHONE_LABEL } from "../store";

const T = "11111111-1111-1111-1111-111111111111";
const writes = () => ops.filter(o => o.op !== "select");
const writesTo = (table: string) => writes().filter(o => o.table === table);

beforeEach(() => {
  ops.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  convRow = { id: "conv-1", name: "Website visitor", lead_phone: null, labels: [] };
  contactRows = [{ id: "contact-9", phone: "919876543210", name: "Asha Rao", tags: ["whatsapp"] }];
});

describe("web chat: a typed number that belongs to an existing contact", () => {
  it("is unverified: the chat is not renamed and the contact is untouched", async () => {
    expect(await landCapturedLead("web:v1", "9876543210", "web-chat", T)).toBe("unverified");
    // No rename of the chat to "Asha Rao", no tag/name patch on her contact.
    expect(writes().some(o => o.table === "wa_conversations" && (o.payload as Record<string, unknown>)?.name !== undefined)).toBe(false);
    expect(writesTo("contacts")).toEqual([]);
  });

  it("labels the chat and leaves the team a note saying it was not verified", async () => {
    await landCapturedLead("web:v1", "9876543210", "web-chat", T);
    const label = writesTo("wa_conversations").find(o => (o.payload as Record<string, unknown>)?.labels);
    expect((label?.payload as { labels: string[] }).labels).toContain(UNVERIFIED_PHONE_LABEL);
    expect(label?.filters).toContainEqual(["eq", "id", "conv-1"]);
    const note = writesTo("wa_conversation_notes")[0];
    expect(note.payload).toMatchObject({ tenant_id: T, conversation_id: "conv-1" });
    expect((note.payload as { body: string }).body).toMatch(/9876543210.*not verified/);
  });

  it("keeps the label when a chat already has the maximum ten labels", async () => {
    convRow = { ...convRow, labels: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] };
    await landCapturedLead("web:v1", "9876543210", "web-chat", T);
    const label = writesTo("wa_conversations").find(o => (o.payload as Record<string, unknown>)?.labels);
    expect((label?.payload as { labels: string[] }).labels).toContain(UNVERIFIED_PHONE_LABEL);
  });

  it("a later re-land of a flagged chat (name arrived after the number) still does not rename it", async () => {
    convRow = { id: "conv-1", name: "Rahul", lead_phone: "9876543210", labels: [UNVERIFIED_PHONE_LABEL] };
    expect(await landCapturedLead("web:v1", null, "web-chat", T)).toBe("unverified");
    expect(writesTo("contacts")).toEqual([]);
    expect(writes().some(o => (o.payload as Record<string, unknown>)?.name !== undefined)).toBe(false);
    expect(writesTo("wa_conversation_notes")).toEqual([]);   // flagged once, not on every message
  });

  it("a re-land of an UNflagged chat (its number was new when typed) merges as before", async () => {
    convRow = { id: "conv-1", name: "Website visitor", lead_phone: "9876543210", labels: [] };
    expect(await landCapturedLead("web:v1", null, "web-chat", T)).toBe("matched");
  });
});

describe("unchanged paths", () => {
  it("web chat: a NEW number is still landed as a contact", async () => {
    contactRows = [];
    const r = await landCapturedLead("web:v1", "9876543210", "web-chat", T);
    expect(r).toBe("new");
    expect(writesTo("wa_conversation_notes")).toEqual([]);
  });

  it("Instagram/Messenger still merge into the existing contact and pick up the known name", async () => {
    convRow = { id: "conv-2", name: "", lead_phone: null, labels: [] };
    expect(await landCapturedLead("ig:123", "9876543210", "instagram", T)).toBe("matched");
    expect(writesTo("contacts")[0]?.payload).toEqual({ tags: ["whatsapp", "instagram"] });
    expect(writesTo("wa_conversations").some(o => (o.payload as Record<string, unknown>)?.name === "Asha Rao")).toBe(true);
    expect(writesTo("wa_conversation_notes")).toEqual([]);
  });
});
