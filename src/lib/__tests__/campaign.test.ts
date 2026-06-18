import { describe, it, expect } from "vitest";
import { bucketQueueOutcomes } from "@/lib/campaign";

// Regression guard for the campaign-queue data-loss bugs (BUG-1 / BUG-2):
// a claimed chunk must be marked by its REAL per-recipient outcome, and rows the
// send never reached (early-abort) must NOT be marked sent.
describe("bucketQueueOutcomes", () => {
  const chunk = [
    { id: "a", phone: "1" }, { id: "b", phone: "2" }, { id: "c", phone: "3" },
    { id: "d", phone: "4" }, { id: "e", phone: "5" },
  ];

  it("marks each row by its actual outcome", () => {
    const r = bucketQueueOutcomes(chunk, [
      { status: "sent" }, { status: "failed" }, { status: "skipped" },
      { status: "sent" }, { status: "failed" },
    ]);
    expect(r.sentIds).toEqual(["a", "d"]);
    expect(r.failedIds).toEqual(["b", "e"]);
    expect(r.skippedIds).toEqual(["c"]);
    expect(r.unattemptedIds).toEqual([]);
    expect(r.sentPhones).toEqual(["1", "4"]);
  });

  it("leaves rows past the processed count UNATTEMPTED (not sent) on early-abort", () => {
    // sendCampaign aborted after 3 recipients — the last two were never attempted.
    const r = bucketQueueOutcomes(chunk, [
      { status: "failed" }, { status: "failed" }, { status: "failed" },
    ]);
    expect(r.unattemptedIds).toEqual(["d", "e"]); // <- must be retried, never dropped
    expect(r.sentIds).toEqual([]);
    expect(r.failedIds).toEqual(["a", "b", "c"]);
  });

  it("treats an empty result set as all-unattempted (e.g. creds missing)", () => {
    const r = bucketQueueOutcomes(chunk, []);
    expect(r.unattemptedIds).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.sentIds).toEqual([]);
  });

  it("only arms reply-flows for delivered recipients", () => {
    const r = bucketQueueOutcomes(chunk, [
      { status: "sent" }, { status: "skipped" }, { status: "failed" },
    ]);
    expect(r.sentPhones).toEqual(["1"]); // not the skipped/failed/unattempted ones
  });
});
