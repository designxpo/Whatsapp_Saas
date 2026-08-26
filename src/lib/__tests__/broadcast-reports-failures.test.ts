import { describe, it, expect, vi, beforeEach } from "vitest";

// A broadcast that reaches nobody must SAY WHY.
//
// runBroadcast returned success:true with "Sent to 0 recipients." no matter what
// went wrong, and the composer only shows d.error when success is false. So a
// template missing from the selected number's WABA ((#132001)), a coexistence
// number blocked on payment (141006), an opt-in shortfall and a daily cap all
// rendered as the same success-styled sentence, while the real reason sat in
// wa_send_log where nobody looked. That is why "the broadcast is not firing"
// went undiagnosed.

const h = vi.hoisted(() => ({
  start: { sentNow: 0, queuedRemaining: 0, status: "sent", message: "", failed: 0, skipped: 0, reason: null as string | null, enqueued: 1 },
}));

vi.mock("../store", () => ({
  createCampaign: async () => ({ id: "c1", tenantId: "t1" }),
  getCampaign: async () => null,
  recipientsForAudience: async () => [],
}));
vi.mock("../campaign", () => ({ startSend: async () => h.start }));

import { runBroadcast } from "../broadcast";

const send = (over: Partial<typeof h.start>) => {
  h.start = { sentNow: 0, queuedRemaining: 0, status: "sent", message: "", failed: 0, skipped: 0, reason: null, enqueued: 1, ...over };
  return runBroadcast({
    mode: "recipients", templateName: "image_test", languageCode: "en_US",
    variables: [], recipients: [{ phone: "918368872108", name: "P" }],
  });
};

beforeEach(() => { h.start = { sentNow: 0, queuedRemaining: 0, status: "sent", message: "", failed: 0, skipped: 0, reason: null, enqueued: 1 }; });

describe("a send that reached nobody is not reported as a success", () => {
  it("surfaces a Meta template rejection instead of 'Sent to 0 recipients.'", async () => {
    const r = await send({ failed: 1, status: "failed", reason: "(#132001) Template name does not exist in the translation", message: "Sent to nobody — (#132001) Template name does not exist in the translation" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("#132001");
  });

  it("surfaces a payment-blocked number", async () => {
    const r = await send({ failed: 1, status: "failed", reason: "(#141006) There is an error with the payment method" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("141006");
  });

  it("surfaces an opt-out shortfall, which is a skip and not a Meta error at all", async () => {
    const r = await send({ skipped: 1, reason: "Skipped 1 opted out." });
    expect(r.success).toBe(false);
    expect(r.error).toBe("Skipped 1 opted out.");
  });

  it("surfaces a number paused on Meta quality", async () => {
    const r = await send({ queuedRemaining: 0, reason: "Paused — number quality is RED. Sending resumes automatically once Meta health recovers. (2 queued)" });
    expect(r.success).toBe(false);
    expect(r.error).toContain("quality is RED");
  });

  it("surfaces the rolling 24h cap", async () => {
    const r = await send({ reason: "24h send limit (5000) already reached — nothing sent." });
    expect(r.success).toBe(false);
    expect(r.error).toContain("5000");
  });
});

describe("real successes are still successes", () => {
  it("a delivered send reports success with no error", async () => {
    const r = await send({ sentNow: 1, message: "Sent to 1 recipient." });
    expect(r).toMatchObject({ success: true, sent: 1 });
    expect(r.error).toBeUndefined();
  });

  it("a PARTIAL send succeeds but still carries the reason for the shortfall", async () => {
    const r = await send({ sentNow: 40, failed: 21, reason: "21 failed" });
    expect(r.success).toBe(true);
    expect(r.error).toBe("21 failed");
  });

  it("work still queued is a success — nothing has failed yet", async () => {
    const r = await send({ sentNow: 0, queuedRemaining: 500, status: "sending", message: "Queued 500 …" });
    expect(r.success).toBe(true);
  });

  it("reports the counts a delivery report needs", async () => {
    const r = await send({ sentNow: 3, failed: 2, skipped: 1 });
    expect(r).toMatchObject({ sent: 3, failed: 2, skipped: 1, totalRecipients: 1 });
  });
});
