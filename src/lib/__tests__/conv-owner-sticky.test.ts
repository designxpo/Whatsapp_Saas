// Lead ownership is STICKY — the regression guard for a silent cross-number bug.
//
// wa_conversations.channel_id is the number/account that OWNS a lead: the Live
// Chat reply box and template sends resolve credentials from it
// (credsFor(conv.channelId)). For WhatsApp it used to be overwritten on EVERY
// inbound message and every coexistence echo ("follow the customer"), on the
// reasoning that a tenant's numbers are interchangeable brand lines. That breaks
// the moment a tenant runs coexistence with one number per counselor: the numbers
// are personal identities, so one counselor's manual reply went out through
// ANOTHER counselor's number — whichever the customer had messaged last.
//
// The customer may freely message any number (each message still records its own
// true channel on wa_conv_messages); only a deliberate reassign moves ownership.
// These tests pin that down for every platform, plus the one case that is NOT a
// reassignment: adopting a genuinely unknown owner on an orphaned row.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_TENANT_ID } from "../tenant";

const h = vi.hoisted(() => ({
  conversations: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  history: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],   // every patch applied to wa_conversations
}));

// Minimal fake of the exact Supabase chains getOrCreateConversation drives:
//   .select("*").eq(k,v)…maybeSingle()
//   .update(patch).eq(k,v)…              → thenable {error}
//   .insert(row).select().single()        → {data,error}
//   .insert(row)                          → thenable (history log)
vi.mock("../supabase", () => {
  const tableRows = (t: string) =>
    t === "wa_conversations" ? h.conversations
    : t === "contacts" ? h.contacts
    : t === "wa_conversation_owner_history" ? h.history
    : [];
  return {
    db: () => ({
      from(table: string) {
        return {
          select() {
            const filters: [string, unknown][] = [];
            const rows = () => tableRows(table).filter(r => filters.every(([k, v]) => r[k] === v));
            const b = {
              eq(k: string, v: unknown) { filters.push([k, v]); return b; },
              order() { return b; },
              async maybeSingle() { const hit = rows()[0]; return { data: hit ? { ...hit } : null, error: null }; },
              async single() { const hit = rows()[0]; return { data: hit ? { ...hit } : null, error: hit ? null : { message: "no rows" } }; },
              then(res: (v: { data: Record<string, unknown>[]; error: null }) => void) {
                res({ data: rows().map(r => ({ ...r })), error: null });
              },
            };
            return b;
          },
          update(patch: Record<string, unknown>) {
            const filters: [string, unknown][] = [];
            const b = {
              eq(k: string, v: unknown) { filters.push([k, v]); return b; },
              then(res: (v: { error: null }) => void) {
                for (const r of tableRows(table)) {
                  if (filters.every(([k, v]) => r[k] === v)) { Object.assign(r, patch); h.updates.push({ table, ...patch }); }
                }
                res({ error: null });
              },
            };
            return b;
          },
          insert(row: Record<string, unknown>) {
            const stored = { id: `gen-${tableRows(table).length + 1}`, created_at: new Date().toISOString(), ...row };
            const push = () => { tableRows(table).push(stored); };
            return {
              select() {
                return { async single() { push(); return { data: { ...stored }, error: null }; } };
              },
              then(res: (v: { error: null }) => void) { push(); res({ error: null }); },
            };
          },
        };
      },
    }),
  };
});

import { getOrCreateConversation, reassignConversationChannel, getOwnerHistory } from "../store";

const DIVESH = "677c71a7-a093-4ef5-9f30-a09c572e116e";      // a counselor's own coex number
const MAIN = "4b3afdfa-8bcb-4afe-b2bc-165f13db51ed";         // the shared/main number
const CUSTOMER = "916362588072";
const T = DEFAULT_TENANT_ID;

beforeEach(() => {
  h.conversations = [];
  h.contacts = [];
  h.history = [];
  h.updates = [];
});

describe("WhatsApp ownership no longer follows the customer", () => {
  it("keeps the FIRST number as owner when the customer later writes to a different one", async () => {
    const first = await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);
    expect(first.channelId).toBe(MAIN);

    // Customer now messages a counselor's personal number (or that counselor
    // replies from their phone → a coexistence echo, which hits this same path).
    const after = await getOrCreateConversation(CUSTOMER, "", DIVESH, "whatsapp", T);

    expect(after.channelId).toBe(MAIN);   // NOT flipped to Divesh
    expect(h.conversations[0].channel_id).toBe(MAIN);
  });

  it("never writes channel_id on a conversation that already has an owner", async () => {
    await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);
    h.updates = [];

    await getOrCreateConversation(CUSTOMER, "", DIVESH, "whatsapp", T);
    await getOrCreateConversation(CUSTOMER, "", DIVESH, "whatsapp", T);

    expect(h.updates.filter(u => "channel_id" in u)).toHaveLength(0);
  });

  it("survives many alternating touches — the owner never drifts", async () => {
    await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);
    for (const ch of [DIVESH, MAIN, DIVESH, DIVESH, MAIN, DIVESH]) {
      await getOrCreateConversation(CUSTOMER, "", ch, "whatsapp", T);
    }
    expect(h.conversations[0].channel_id).toBe(MAIN);
  });
});

describe("IG/Messenger/web-chat stay anchored (they always were)", () => {
  it.each(["instagram", "messenger", "webchat"] as const)("%s keeps its originating account", async platform => {
    const id = platform === "webchat" ? "web:abc-123" : "17841400000000000";
    await getOrCreateConversation(id, "", MAIN, platform, T);
    await getOrCreateConversation(id, "", DIVESH, platform, T);

    expect(h.conversations[0].channel_id).toBe(MAIN);
  });
});

describe("adopting an UNKNOWN owner is not a reassignment", () => {
  it("takes a channel when the existing row has none (orphaned row)", async () => {
    h.conversations = [{ id: "c1", tenant_id: T, phone: CUSTOMER, name: "Legacy", channel_id: null }];

    const conv = await getOrCreateConversation(CUSTOMER, "", DIVESH, "whatsapp", T);

    expect(conv.channelId).toBe(DIVESH);
    // ...and that first touch opens the trail.
    expect(h.history.map(r => r.channel_id)).toContain(DIVESH);
  });

  it("still refuses to overwrite once that owner is known", async () => {
    h.conversations = [{ id: "c1", tenant_id: T, phone: CUSTOMER, name: "Legacy", channel_id: null }];
    await getOrCreateConversation(CUSTOMER, "", DIVESH, "whatsapp", T);   // adopts DIVESH
    await getOrCreateConversation(CUSTOMER, "", MAIN, "whatsapp", T);      // must NOT take MAIN

    expect(h.conversations[0].channel_id).toBe(DIVESH);
  });
});

describe("the ownership trail", () => {
  it("opens with the first-touch number at creation, stamped to the tenant", async () => {
    await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);

    expect(h.history).toHaveLength(1);
    expect(h.history[0].channel_id).toBe(MAIN);
    expect(h.history[0].changed_by).toBe("system");
    expect(h.history[0].tenant_id).toBe(T);
  });

  it("records a deliberate handover with who did it, and moves the owner", async () => {
    const conv = await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);

    await reassignConversationChannel(conv.id, DIVESH, "priyesh@scaletrix.ai", "Handing to Divesh", T);

    expect(h.conversations[0].channel_id).toBe(DIVESH);
    const trail = await getOwnerHistory(conv.id, T);
    expect(trail.map(t => t.channelId)).toEqual([MAIN, DIVESH]);
    expect(trail[1].changedBy).toBe("priyesh@scaletrix.ai");
    expect(trail[1].reason).toBe("Handing to Divesh");
  });

  it("a later inbound on the old number does not undo a handover", async () => {
    const conv = await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);
    await reassignConversationChannel(conv.id, DIVESH, "admin", null, T);

    await getOrCreateConversation(CUSTOMER, "", MAIN, "whatsapp", T);

    expect(h.conversations[0].channel_id).toBe(DIVESH);
  });

  it("does not leak another tenant's trail", async () => {
    const conv = await getOrCreateConversation(CUSTOMER, "Syed", MAIN, "whatsapp", T);
    expect(await getOwnerHistory(conv.id, "00000000-0000-0000-0000-0000000000ff")).toEqual([]);
  });
});
