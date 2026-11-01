// Router events are filed under the workspace they happened in (metrics.ts),
// and still get written on a database that has no tenant_id column yet.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[], hasTenantColumn: true }));
vi.mock("@/lib/supabase", () => ({
  db: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (!h.hasTenantColumn && "tenant_id" in row) return { error: { code: "PGRST204", message: "Could not find the 'tenant_id' column" } };
        h.inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { logRouterEvent } from "../router/metrics";

const T2 = "22222222-2222-4222-8222-222222222222";
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { h.inserts.length = 0; h.hasTenantColumn = true; vi.spyOn(console, "log").mockImplementation(() => undefined); });

describe("logRouterEvent", () => {
  it("writes the workspace and conversation with the event", async () => {
    logRouterEvent({ event: "FAQ_MISS", tenantId: T2, conversationId: "c1", phone: "919876543210", question: "fees?" });
    await flush();
    expect(h.inserts).toEqual([expect.objectContaining({ tenant_id: T2, conversation_id: "c1", event: "FAQ_MISS", phone: "919876543210" })]);
  });

  it("drops the new columns and writes anyway before the migration", async () => {
    h.hasTenantColumn = false;
    logRouterEvent({ event: "RAG_USED", tenantId: T2, question: "fees?" });
    await flush(); await flush();
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).not.toHaveProperty("tenant_id");
    expect(h.inserts[0].event).toBe("RAG_USED");
  });
});
