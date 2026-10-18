// A drip send that Meta accepts and then drops must not look like a success.
//
// This is written from a real failure. Four RNR messages went to a test
// number. Meta accepted every one and returned a message id. Every one was
// then dropped with error 131026, and the system recorded four successes:
// the enrolment advanced with last_error null, the conversation showed four
// outbound messages, and nothing anywhere said they had not arrived.
//
// Two reasons, both guarded here:
//
//   1. Meta's "failed" callback only updates wa_send_log, which the
//      BROADCAST path writes. A sequence send created no row, so the
//      callback matched nothing and was discarded.
//
//   2. The "not on WhatsApp" flag was only checked on the SEND call's
//      return. Meta almost never refuses at send time — it accepts and
//      reports the failure asynchronously — so the flag never fired.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  throwOnInsert: false,
}));

vi.mock("../supabase", () => ({
  db: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        if (h.throwOnInsert) throw new Error("table missing");
        h.inserted.push(row);
        return { data: null, error: null };
      },
    }),
  }),
}));

// recordSequenceSend lives in dripstore in this codebase (it was in store).
import { recordSequenceSend } from "../dripstore";

beforeEach(() => { h.inserted = []; h.throwOnInsert = false; });

describe("a drip send leaves a receipt Meta's callback can find", () => {
  it("writes the message id, which is the only key the callback has", async () => {
    await recordSequenceSend({ phone: "918268872108", name: "Priyesh", metaMessageId: "wamid.ABC" });
    expect(h.inserted).toHaveLength(1);
    expect(h.inserted[0]).toMatchObject({ meta_message_id: "wamid.ABC", status: "sent" });
  });

  it("normalises the phone, so the row matches the rest of the system", async () => {
    await recordSequenceSend({ phone: "+91 82688 72108", metaMessageId: "wamid.ABC" });
    expect(h.inserted[0].phone).toBe("918268872108");
  });

  it("starts at 'sent' — delivered and failed are the callback's to write", async () => {
    await recordSequenceSend({ phone: "919000000001", metaMessageId: "wamid.ABC" });
    expect(h.inserted[0].status).toBe("sent");
  });

  it("writes NOTHING when there is no message id", async () => {
    // A row with no message id can never be matched by a callback, so it
    // would sit at "sent" forever and inflate the delivery rate — the exact
    // dishonesty this is here to remove.
    await recordSequenceSend({ phone: "919000000001", metaMessageId: null });
    await recordSequenceSend({ phone: "919000000001" });
    expect(h.inserted).toHaveLength(0);
  });

  it("leaves campaign_id unset — a drip is not a campaign", async () => {
    await recordSequenceSend({ phone: "919000000001", metaMessageId: "wamid.ABC" });
    expect(h.inserted[0].campaign_id).toBeUndefined();
  });

  it("never throws — a missing receipt must not re-send a delivered message", async () => {
    h.throwOnInsert = true;
    await expect(recordSequenceSend({ phone: "919000000001", metaMessageId: "wamid.ABC" })).resolves.toBeUndefined();
  });
});

describe("the wiring that was missing", () => {
  const seq = readFileSync(join(process.cwd(), "src/lib/sequences.ts"), "utf8");
  const hook = readFileSync(join(process.cwd(), "src/app/api/webhooks/whatsapp/route.ts"), "utf8");

  it("the sequence engine records every successful send", () => {
    expect(seq).toContain("phone: enr.phone as string, name: null, metaMessageId");
  });

  it("the status webhook flags a dead number on the ASYNC failure", () => {
    // The send path checks 131026 too, but Meta reports it here in
    // practice. Checking only the synchronous case is a flag that never
    // fires.
    expect(hook).toContain("Number(e.code) === WA_NOT_ON_WHATSAPP");
    expect(hook).toContain("markNumberNotOnWhatsApp(recipient,");
  });

  it("it flags the RECIPIENT, not some other number", () => {
    expect(hook).toContain("status.recipient_id");
  });

  it("it does not flag every delivery failure as a dead number", () => {
    // A rate limit or a re-engagement block says nothing about the lead's
    // number, and flagging one sends sales chasing a ghost.
    const failBlock = hook.slice(hook.indexOf('status.status === "failed"'), hook.indexOf('// Inbound messages.'));
    expect(failBlock).toContain("WA_NOT_ON_WHATSAPP");
    expect(failBlock).not.toMatch(/if \(e\.code\) await markNumberNotOnWhatsApp/);
  });
});
