// A contact must exist before anything is stamped on it.
//
// setContactAttributes resolves the contact and returns SILENTLY when it finds
// none. That is right for a best-effort stamp and lethal when the write runs
// before the contact is created: nothing fails, nothing logs, the data is gone.
//
// It happened on the inbound path. The tracked-link attribution — handle_source,
// gclid, sclx_id — was written inside the ref block, which runs BEFORE
// upsertContacts. On a brand-new number, which is every first-time paid
// visitor and the only person this data is collected for, the write landed
// nowhere.
//
// It read as "the tracked links are broken". They were not: 66 sessions decoded
// and matched between 20 September and 5 October and the source touch counters
// climbed the whole time. Only the copy on the contact was missing — 4 contacts
// carried handle_source out of thousands — so every report built on it read
// empty and the fault looked like it was upstream.
//
// Ordering is not something a unit test can observe from outside the route, so
// it is asserted on the source.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROUTE = join(__dirname, "../../app/api/webhooks/whatsapp/route.ts");
const src = readFileSync(ROUTE, "utf8");

/** Index of the inbound upsertContacts call — the moment the contact exists. */
const upsertAt = (): number => src.indexOf('await upsertContacts([{ phone: from, name: profileName }], "inbound"');

describe("the inbound webhook stamps attribution after the contact exists", () => {
  it("found the landmarks — the control", () => {
    // Without this a renamed call would make every assertion below vacuous.
    expect(upsertAt()).toBeGreaterThan(0);
    expect(src).toContain("setContactAttributes(from,");
  });

  it("creates the contact before stamping anything on it", () => {
    const upsert = upsertAt();
    const early = [...src.matchAll(/setContactAttributes\(from,/g)]
      .map(m => m.index ?? -1)
      .filter(i => i < upsert);
    expect(early).toEqual([]);
  });

  it("still collects the tracked-link attribution while resolving the ref", () => {
    // The fix must not have quietly dropped the data on the way past.
    expect(src).toContain("refAttrs.handle_source = src.label");
    // The session's UTMs (gclid and fbclid included) travel through utmAttributes().
    expect(src).toContain("Object.assign(refAttrs, utmAttributes(session.utm))");
    expect(src).toContain("refAttrs.sclx_id = session.sclxId");
  });

  it("writes what it collected, and only when there is something", () => {
    expect(src).toContain("if (Object.keys(refAttrs).length)");
    const write = src.indexOf("setContactAttributes(from, refAttrs, tid)");
    expect(write).toBeGreaterThan(upsertAt());
  });

  it("resolves the ref BEFORE the CRM push, so a new lead gets its source", () => {
    // adSource feeds the lead Source on creation; resolving it after the push
    // would silently downgrade every paid lead to the generic label.
    expect(src.indexOf("const hhRef = parseRef(text)")).toBeLessThan(src.indexOf("pushWaActivity({ phone: from"));
  });
});

// ── Lead creation must stay with the activity push ─────────────────────────
//
// After 4eea4ed the RNR handoff no longer creates a CRM lead; it is only for
// somebody a journey was talking to. That is correct, and it makes the
// activity push at the bottom of the handler the ONLY thing that creates a
// lead for a first-time message — organic or paid.
//
// So an early return added between the two would stop new leads reaching the
// CRM at all, silently, for everyone. There is exactly one today and it is
// the opt-out.
describe("a first-time message still reaches the thing that creates the lead", () => {
  const handoffAt = () => src.indexOf("const dripReply = await handleLeadResponse(");
  const pushAt = () => src.indexOf("pushWaActivity({ phone: from, direction: \"inbound\"");

  it("found the landmarks — the control", () => {
    expect(handoffAt()).toBeGreaterThan(0);
    expect(pushAt()).toBeGreaterThan(handoffAt());
  });

  it("has exactly one early return between the handoff and the CRM push", () => {
    const between = src.slice(handoffAt(), pushAt());
    const returns = [...between.matchAll(/^\s*return;/gm)];
    expect(returns).toHaveLength(1);
  });

  it("and that one return is the opt-out", () => {
    const between = src.slice(handoffAt(), pushAt());
    const upto = between.slice(0, between.search(/^\s*return;/m));
    expect(upto).toContain("dripReply.optedOut");
  });
});
