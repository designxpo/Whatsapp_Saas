import { describe, it, expect, vi, beforeEach } from "vitest";

// Renaming a lead in Contacts must reach Live Chat.
//
// The two live in different columns: Contacts reads `contacts.name`, and the
// inbox titles each thread from that conversation's OWN `wa_conversations.name`
// (it cannot join contacts — an Instagram thread has no contact row). The admin
// edit only ever wrote the first one, so Contacts said "Priyesh Mishra" while
// Live Chat kept saying "Debug Test". renameLeadConversations closes that gap.

type Call = { table: string; update?: Record<string, unknown>; eq: [string, unknown][]; or?: string };
const calls: Call[] = [];
let rows: { id: string }[] = [];
let failure: string | null = null;

function stubDb() {
  return {
    from(table: string) {
      const rec: Call = { table, eq: [] };
      calls.push(rec);
      const chain = {
        update(patch: Record<string, unknown>) { rec.update = patch; return chain; },
        eq(col: string, val: unknown) { rec.eq.push([col, val]); return chain; },
        or(expr: string) { rec.or = expr; return chain; },
        select: async () => (failure ? { data: null, error: { message: failure } } : { data: rows, error: null }),
      };
      return chain;
    },
  };
}
vi.mock("../supabase", () => ({ db: () => stubDb() }));
vi.mock("../tenantdb", () => ({ tdb: () => stubDb() }));

import { renameLeadConversations } from "../store";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("renameLeadConversations — a human rename reaches every thread", () => {
  beforeEach(() => { calls.length = 0; rows = [{ id: "c1" }]; failure = null; });

  it("renames the WhatsApp thread AND the opaque-id threads that carry the number in lead_phone", async () => {
    rows = [{ id: "wa" }, { id: "ig" }];
    expect(await renameLeadConversations("918368872108", "Priyesh Mishra", TENANT)).toBe(2);
    const [c] = calls;
    expect(c.table).toBe("wa_conversations");
    expect(c.update).toEqual({ name: "Priyesh Mishra" });
    // Instagram / web-chat / Messenger conversations are keyed by an opaque id,
    // so matching only `phone` would leave them showing the old name.
    expect(c.or).toBe("phone.eq.918368872108,lead_phone.eq.918368872108");
  });

  it("stays inside the tenant", async () => {
    await renameLeadConversations("918368872108", "Priyesh Mishra", TENANT);
    expect(calls[0].eq).toContainEqual(["tenant_id", TENANT]);
  });

  it("normalizes a formatted number before matching", async () => {
    await renameLeadConversations("+91 83688 72108", "Priyesh Mishra", TENANT);
    expect(calls[0].or).toBe("phone.eq.918368872108,lead_phone.eq.918368872108");
  });

  // Live Chat falls back to the bare phone number when a thread has no name, so
  // clearing the contact name must not blank the threads — a stale name beats a
  // wall of digits in the inbox.
  it("does not blank the threads when the name is cleared", async () => {
    expect(await renameLeadConversations("918368872108", "   ", TENANT)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("does nothing without a usable number", async () => {
    expect(await renameLeadConversations("not-a-number", "Priyesh Mishra", TENANT)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("truncates an over-long name to the column's limit", async () => {
    await renameLeadConversations("918368872108", "x".repeat(400), TENANT);
    expect((calls[0].update?.name as string).length).toBe(120);
  });

  // The caller logs this and still reports the contact edit as saved — but it
  // must not be able to swallow the failure silently and report a rename.
  it("throws when the update fails, rather than reporting success", async () => {
    failure = "permission denied";
    await expect(renameLeadConversations("918368872108", "Priyesh Mishra", TENANT)).rejects.toThrow("permission denied");
  });
});
