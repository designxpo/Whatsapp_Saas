// A send Meta ACCEPTED can still be dropped, and the campaign has to hear about it.
//
// The send API answers with a message id, the campaign row is written "sent",
// and the drop arrives by webhook seconds later. That failure was recorded in
// wa_send_log and nowhere else, so the campaign kept status="sent" and
// error_summary=null forever: History showed a clean send, Analytics counted
// deliveries that never happened, and the reason sat one table away.
//
// Proven on the internal build 2026-09-01. Two broadcasts on the default number both
// answered "Sent to 1 recipient." while both messages were dropped under the
// marketing frequency cap — "This message was not delivered to maintain healthy
// ecosystem engagement" (131049). Nothing on screen ever corrected itself, which
// is what made a perfectly healthy number look broken.
//
// On this build it was one step worse: updateLogByMessageId only accepted
// "delivered" | "read", and the webhook never forwarded "failed" at all — so a
// dropped message left no trace anywhere in the product, not even in the log.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // phone -> best status, the shape logCounts reduces over.
  statuses: new Map<string, string>(),
  updatedRows: [] as Record<string, unknown>[],
  patches: [] as Record<string, unknown>[],
  campaignIdOnUpdate: "camp-1" as string | null,
}));

// Mocks the layer the code actually drives. bestStatusPerPhone does its own
// inline paging with .select().eq().order().range() — NOT pageAll — so stubbing
// pagedselect here would have quietly mocked nothing and every count read zero.
vi.mock("../supabase", () => ({
  db: () => ({
    from: (table: string) => ({
      select() {
        const b = {
          eq() { return b; },
          order() { return b; },
          async range(from: number) {
            if (table !== "wa_send_log" || from > 0) return { data: [], error: null };
            return {
              data: [...h.statuses.entries()].map(([phone, status]) => ({ phone, status })),
              error: null,
            };
          },
        };
        return b;
      },
      update(row: Record<string, unknown>) {
        const b = {
          eq() { return b; },
          in() { return b; },
          async select() {
            h.updatedRows.push(row);
            return { data: h.campaignIdOnUpdate ? [{ campaign_id: h.campaignIdOnUpdate }] : [], error: null };
          },
          // updateCampaign awaits the builder directly.
          then(res: (v: { error: null }) => unknown) {
            if (table === "wa_campaigns") h.patches.push(row);
            return Promise.resolve(res({ error: null }));
          },
        };
        return b;
      },
    }),
  }),
}));

beforeEach(() => {
  h.statuses.clear();
  h.updatedRows.length = 0;
  h.patches.length = 0;
  h.campaignIdOnUpdate = "camp-1";
});

async function failWebhook(reason?: string) {
  const { updateLogByMessageId } = await import("../store");
  await updateLogByMessageId("wamid.ABC", "failed", "2026-09-01T06:48:34Z", reason);
}

describe("late delivery failure reaches the campaign", () => {
  it("records the shortfall and the reason when every message was dropped", async () => {
    h.statuses.set("918368872108", "failed");
    await failWebhook("This message was not delivered to maintain healthy ecosystem engagement");

    expect(h.patches).toHaveLength(1);
    const p = h.patches[0];
    // Nothing landed, so "sent" would be a lie.
    expect(p.status).toBe("failed");
    expect(p.failed_count).toBe(1);
    expect(String(p.error_summary)).toContain("healthy ecosystem engagement");
  });

  it("keeps a PARTIAL send successful but still names the shortfall", async () => {
    // 2 delivered, 1 dropped. Marking the whole campaign failed would be as
    // wrong as saying nothing — the point is that neither number is hidden.
    h.statuses.set("911111111111", "read");
    h.statuses.set("912222222222", "delivered");
    h.statuses.set("913333333333", "failed");
    await failWebhook("Recipient is not on WhatsApp");

    const p = h.patches[0];
    expect(p.status).toBe("sent");
    expect(p.sent_count).toBe(2);
    expect(p.failed_count).toBe(1);
    expect(String(p.error_summary)).toMatch(/1 of 3 not delivered/);
  });

  it("says nothing about failures when a status arrives and none exist", async () => {
    h.statuses.set("911111111111", "read");
    await failWebhook("stale duplicate");
    const p = h.patches[0];
    expect(p.status).toBeUndefined();       // don't churn a healthy campaign
    expect(p.error_summary).toBeUndefined();
  });

  it("leaves the campaign alone on delivered/read, which are not failures", async () => {
    h.statuses.set("911111111111", "read");
    const { updateLogByMessageId } = await import("../store");
    await updateLogByMessageId("wamid.ABC", "delivered", "2026-09-01T06:48:34Z");
    expect(h.patches).toEqual([]);
  });

  it("records the reason on the log row, not just the count", async () => {
    // The reason is the whole value of handling "failed": a failure count with
    // no "why" cannot be acted on, and on this build it was being thrown away.
    h.statuses.set("918368872108", "failed");
    await failWebhook("This message was not delivered to maintain healthy ecosystem engagement");
    expect(h.updatedRows[0]).toMatchObject({ status: "failed" });
    expect(String(h.updatedRows[0].error_detail)).toContain("healthy ecosystem engagement");
  });

  it("truncates an oversized reason rather than failing the write", async () => {
    h.statuses.set("918368872108", "failed");
    await failWebhook("x".repeat(900));
    expect(String(h.updatedRows[0].error_detail)).toHaveLength(500);
  });

  it("survives a status whose log row can't be matched to a campaign", async () => {
    // A webhook must never throw because a summary could not be written.
    h.campaignIdOnUpdate = null;
    await expect(failWebhook("orphan")).resolves.toBeUndefined();
    expect(h.patches).toEqual([]);
  });
});
