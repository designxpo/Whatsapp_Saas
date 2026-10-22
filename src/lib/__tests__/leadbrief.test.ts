import { describe, it, expect } from "vitest";
import { leadContextLines, type LeadContext } from "../leadbrief";

// What the conversation brief is told about a lead.
//
// It used to list every contact attribute under "Collected details", so the
// model read lsq_profile_sig and gclid as facts about the person, while the
// things a counsellor needs before a call — which number owns the lead, who
// handed it on, which drips are running, whether they are waiting on us — were
// never in the context at all.

const NOW = Date.parse("2026-10-22T12:00:00Z");
const base: LeadContext = {
  name: "Asha", phone: "919000000001", isInstagram: false,
  attributes: {}, tags: [], thread: [], drips: [], handovers: [], links: [],
};
const text = (c: Partial<LeadContext>) => leadContextLines({ ...base, ...c }, NOW).join("\n");

describe("leadContextLines", () => {
  it("names the CRM fields and drops the machine ones", () => {
    const t = text({ attributes: {
      lsq_stage: "Not Reachable", lsq_owner: "Divesh", lsq_source: "PPC-whatsapp",
      lsq_profile_sig: "a1b2", lsq_lead_id: "uuid", gclid: "Cj0", sclx_id: "x", city: "Noida",
    } });
    expect(t).toContain("CRM stage: Not Reachable");
    expect(t).toContain("CRM owner: Divesh");
    expect(t).toContain("CRM source: PPC-whatsapp");
    expect(t).toContain("city: Noida");
    for (const noise of ["lsq_profile_sig", "a1b2", "lsq_lead_id", "gclid", "Cj0", "sclx_id"]) expect(t).not.toContain(noise);
  });

  it("lists the drips the lead is in, with where they are", () => {
    const t = text({ drips: [{ sequence: "RNR follow-up", step: 2, steps: 5, status: "active" }, { sequence: "Welcome", step: 3, steps: 3, status: "completed" }] });
    expect(t).toContain("RNR follow-up — step 2 of 5, active");
    expect(t).toContain("Welcome — step 3 of 3, completed");
  });

  it("says which number owns the lead and who handed it on", () => {
    const t = text({ owner: "PPC SM", handovers: [{ at: "2026-10-20T09:00:00Z", to: "Pooja Singh", reason: "hand to ops" }] });
    expect(t).toContain("Owned by: PPC SM");
    expect(t).toContain("Handed to Pooja Singh");
    expect(t).toContain("hand to ops");
  });

  it("says how long the lead has been waiting on us", () => {
    const t = text({ status: "escalated", needsReply: true, lastInboundAt: "2026-10-22T07:00:00Z" });
    expect(t).toContain("Waiting for our reply: 5h");
    expect(t).toContain("Escalated to a person");
  });

  it("uses the pipeline stage when there is one", () => {
    expect(text({ pipelineStage: "Demo booked" })).toContain("Pipeline stage: Demo booked");
  });
});
