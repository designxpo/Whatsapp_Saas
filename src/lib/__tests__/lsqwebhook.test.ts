import { describe, it, expect } from "vitest";
import { parseLsqWebhook } from "../lsqwebhook";

describe("parseLsqWebhook", () => {
  it("parses the recommended explicit mail-merge payload", () => {
    const ev = parseLsqWebhook({
      event: "owner_changed",
      Phone: "+91-83688 72108",
      FirstName: "Asha",
      LastName: "Verma",
      EmailAddress: "asha@example.com",
      OwnerEmail: "Counselor.One@AnalytixLabs.co.in",
      OwnerName: "Counselor One",
      ProspectStage: "Future Interest",
      ProspectID: "abc-123",
      Source: "PPC",
    });
    expect(ev).toEqual({
      event: "owner_changed",
      phone: "918368872108",
      name: "Asha Verma",
      email: "asha@example.com",
      ownerEmail: "counselor.one@analytixlabs.co.in",
      ownerName: "Counselor One",
      stage: "Future Interest",
      leadId: "abc-123",
      source: "PPC",
    });
  });

  it("parses LSQ's standard flat lead JSON (OwnerIdEmailAddress)", () => {
    const ev = parseLsqWebhook({
      ProspectID: "guid-1",
      FirstName: "Ravi",
      Mobile: "8368872108",
      OwnerIdEmailAddress: "owner@org.in",
      OwnerIdName: "Owner Person",
      ProspectStage: "New",
    });
    expect(ev.event).toBe("unknown");            // no explicit marker
    expect(ev.phone).toBe("8368872108");
    expect(ev.name).toBe("Ravi");
    expect(ev.ownerEmail).toBe("owner@org.in");
    expect(ev.ownerName).toBe("Owner Person");
    expect(ev.stage).toBe("New");
    expect(ev.leadId).toBe("guid-1");
  });

  it("unwraps Before/After update shapes — After wins over the root", () => {
    const ev = parseLsqWebhook({
      ProspectID: "guid-2",
      Before: { ProspectStage: "New", Phone: "918368872108" },
      After: { ProspectStage: "Qualified", Phone: "918368872108" },
    });
    expect(ev.stage).toBe("Qualified");
    expect(ev.phone).toBe("918368872108");
  });

  it("never mistakes owner fields for the lead's phone/email; skips unresolved merge tokens and 'null'", () => {
    const ev = parseLsqWebhook({
      OwnerPhone: "9999999999",
      Phone: "@{Lead:Phone,}",           // unresolved mail-merge → absent
      EmailAddress: "null",
      OwnerEmail: "owner@org.in",
      Mobile: "83688 72108",
    });
    expect(ev.phone).toBe("8368872108");   // from Mobile, not OwnerPhone
    expect(ev.email).toBeNull();
    expect(ev.ownerEmail).toBe("owner@org.in");
  });

  it("tolerates junk: empty body, arrays, short phones", () => {
    expect(parseLsqWebhook(null).phone).toBeNull();
    expect(parseLsqWebhook([1, 2]).phone).toBeNull();
    expect(parseLsqWebhook({ Phone: "12345" }).phone).toBeNull();   // <10 digits
    expect(parseLsqWebhook({ Phone: "12345678901234567890" }).phone).toBeNull();   // >15
  });

  it("owner given as a bare name lands in ownerName, not ownerEmail", () => {
    const ev = parseLsqWebhook({ Owner: "Jahnabi", Phone: "918368872108" });
    expect(ev.ownerEmail).toBeNull();
    expect(ev.ownerName).toBe("Jahnabi");
  });

  it("exact Phone/Mobile beats fuzzy phone-ish fields regardless of key order", () => {
    const ev = parseLsqWebhook({ AlternatePhone: "911111111111", Phone: "918368872108" });
    expect(ev.phone).toBe("918368872108");
    // fuzzy fallback still works when no exact field carries a usable number
    const ev2 = parseLsqWebhook({ Phone: "", AlternatePhone: "911111111111" });
    expect(ev2.phone).toBe("911111111111");
  });
});
