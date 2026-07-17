import { describe, it, expect } from "vitest";
import { stageTransition, type StageDrip } from "../stagedrips";

const DRIPS: StageDrip[] = [
  { stage: "RNR", sequenceId: "seq-rnr" },
  { stage: "Future Interest", sequenceId: "seq-fi" },
  { stage: "Warm", sequenceId: "seq-fi" },          // two stages can share a sequence
];

describe("stageTransition", () => {
  it("enrolls the new stage's sequence and stops the other managed ones", () => {
    expect(stageTransition("New", "RNR", DRIPS)).toEqual({ enroll: "seq-rnr", stop: ["seq-fi"] });
  });

  it("is idempotent: same stage again (webhook replay) does nothing", () => {
    expect(stageTransition("RNR", "RNR", DRIPS)).toEqual({ enroll: null, stop: [] });
    expect(stageTransition("rnr", "RNR", DRIPS)).toEqual({ enroll: null, stop: [] });   // case-insensitive
  });

  it("moving to an UNMAPPED stage stops all managed sequences, enrolls none", () => {
    expect(stageTransition("RNR", "Customer", DRIPS)).toEqual({ enroll: null, stop: ["seq-rnr", "seq-fi"] });
  });

  it("prev and next mapping to the SAME sequence continues it (no restart)", () => {
    const r = stageTransition("Future Interest", "Warm", DRIPS);
    expect(r.enroll).toBeNull();                    // seq-fi keeps running
    expect(r.stop).toEqual(["seq-rnr"]);            // and is never in the stop list
  });

  it("first stage ever (prev undefined) enrolls", () => {
    expect(stageTransition(undefined, "Future Interest", DRIPS).enroll).toBe("seq-fi");
  });

  it("empty next stage is a no-op", () => {
    expect(stageTransition("RNR", "", DRIPS)).toEqual({ enroll: null, stop: [] });
  });
});
