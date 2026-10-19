// LeadSquared's Custom Lead Action does not send "?token=<value>" as written.
// The "=" is encoded somewhere between the connector's config box and the
// browser, so the whole "token=<value>" string arrives as a PARAMETER NAME
// with an empty value — where searchParams.get("token") cannot see it.
//
// Two things are pinned here. The parsing, and the fact that BOTH auth paths
// use it: the first attempt at this fix put the shim only in apikeys.ts,
// which handles minted tenant keys, while the request authenticates through
// crm.ts against the environment token. The 401 did not move, and the live
// log said the credential was right there.
import { describe, it, expect } from "vitest";
import { queryTokenCandidates } from "../querytoken";
import { readFileSync } from "node:fs";

const BASE = "https://waba.test/api/crm/rnr-nudge";

describe("the forms a query credential arrives in", () => {
  it("the documented one", () => {
    expect(queryTokenCandidates(`${BASE}?token=abc123`)).toEqual(["abc123"]);
  });

  it("the one LeadSquared actually sends — '=' encoded into the key", () => {
    expect(queryTokenCandidates(`${BASE}?token%3Dabc123`)).toEqual(["abc123"]);
  });

  it("a value pasted with no parameter name at all", () => {
    expect(queryTokenCandidates(`${BASE}?abc123`)).toEqual(["abc123"]);
  });

  it("is case-insensitive about the swallowed name", () => {
    expect(queryTokenCandidates(`${BASE}?Token%3Dabc123`)).toEqual(["abc123"]);
  });

  it("prefers the properly named one when both are present", () => {
    expect(queryTokenCandidates(`${BASE}?token=real&junkvalue`)[0]).toBe("real");
  });
});

describe("what it must not treat as a credential", () => {
  it("an ordinary name=value pair is DATA", () => {
    // Otherwise every query parameter on every request gets hashed and
    // looked up.
    expect(queryTokenCandidates(`${BASE}?leadId=805c64a2&source=grid`)).toEqual([]);
  });

  it("an absurdly long value", () => {
    expect(queryTokenCandidates(`${BASE}?${"a".repeat(500)}`)).toEqual([]);
  });

  it("no query string at all", () => {
    expect(queryTokenCandidates(BASE)).toEqual([]);
  });

  it("an unparseable url", () => {
    expect(queryTokenCandidates("not a url")).toEqual([]);
  });
});

describe("BOTH authentication paths use it — the mistake made first time", () => {
  it("the environment path reads it too", () => {
    // crm.ts is where CRM_PANEL_TOKEN is actually compared, and it did its
    // own parsing. Asserted against the source so the two cannot drift back
    // apart — a behavioural test here would need the real env token.
    const crm = readFileSync("src/lib/crm.ts", "utf8");
    expect(crm).toContain("queryTokenCandidates");
    expect(crm).not.toMatch(/searchParams\.get\("token"\)/);
  });
});
