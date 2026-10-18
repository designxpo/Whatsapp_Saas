// LeadSquared's Custom Lead Action escapes its JSON body as though it were a
// string — every " becomes \" and every newline a literal \n — and then sends
// it WITHOUT the enclosing quotes. The result is neither valid JSON nor a
// valid JSON string, so req.json() rejects a payload that is correct in their
// config box.
//
// The exact body below is the one the live connector sent on 12 Oct 2026,
// reconstructed from the probe's structural capture:
//
//   {\·\"·\":\"·\",\·\"·\":\"·\",…,\·\"·\":\"\"\·
//
// Keeping the real shape here means a future change to the parser has to keep
// working against what the client actually does, not against what it should.
import { describe, it, expect } from "vitest";
import { parseLooseJson, parseLooseJsonObject } from "../loosejson";

/** Byte-for-byte what LeadSquared put on the wire. */
const LSQ_BODY =
  '{\\n  \\"phone\\": \\"+91-8368872108\\",\\n  \\"leadId\\": \\"805c64a2-142e-4fe2-a368-75390eadc316\\",' +
  '\\n  \\"counsellor\\": \\"Jahnabi\\",\\n  \\"name\\": \\"Priyesh\\",\\n  \\"course\\": \\"\\"\\n}';

describe("the body LeadSquared actually sends", () => {
  it("is rejected by a strict parse — which is the bug", () => {
    expect(() => JSON.parse(LSQ_BODY)).toThrow();
  });

  it("parses, with every field intact", () => {
    expect(parseLooseJson(LSQ_BODY)).toEqual({
      phone: "+91-8368872108",
      leadId: "805c64a2-142e-4fe2-a368-75390eadc316",
      counsellor: "Jahnabi",
      name: "Priyesh",
      course: "",
    });
  });

  it("keeps the phone exactly, including the + and the dash", () => {
    // The route strips non-digits itself; silently mangling it here would
    // move the failure somewhere much harder to see.
    expect((parseLooseJson(LSQ_BODY) as { phone: string }).phone).toBe("+91-8368872108");
  });
});

describe("the ordinary case is untouched", () => {
  it("parses normal JSON", () => {
    expect(parseLooseJson('{"phone":"919876543210"}')).toEqual({ phone: "919876543210" });
  });

  it("does not disturb a legitimately escaped quote inside a value", () => {
    // A counsellor called O"Brien, or a quote in any field: the normal parse
    // succeeds first, so no recovery ever runs on it.
    const body = JSON.stringify({ name: 'O"Brien', note: "line\nbreak" });
    expect(parseLooseJson(body)).toEqual({ name: 'O"Brien', note: "line\nbreak" });
  });

  it("handles a body encoded twice — JSON inside a JSON string", () => {
    expect(parseLooseJson(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it("handles real newlines mixed with escaped quotes", () => {
    expect(parseLooseJson('{\n  \\"a\\": \\"b\\"\n}')).toEqual({ a: "b" });
  });

  it("handles unicode escapes through the recovery", () => {
    expect(parseLooseJson('{\\n\\"a\\": \\"caf\\u00e9\\"\\n}')).toEqual({ a: "café" });
  });
});

describe("what it refuses", () => {
  it("empty and whitespace", () => {
    for (const v of ["", "   ", "\n"]) expect(parseLooseJson(v)).toBeUndefined();
  });

  it("something that is not JSON in any form", () => {
    expect(parseLooseJson("phone=1&name=2")).toBeUndefined();
    expect(parseLooseJson("<html>nope</html>")).toBeUndefined();
  });

  it("truncated JSON, rather than guessing at the missing half", () => {
    expect(parseLooseJson('{"phone":"919876')).toBeUndefined();
    expect(parseLooseJson('{\\n\\"phone\\": \\"919876')).toBeUndefined();
  });
});

describe("parseLooseJsonObject insists on an object", () => {
  it("accepts an object", () => {
    expect(parseLooseJsonObject(LSQ_BODY)).toMatchObject({ name: "Priyesh" });
  });

  it("refuses a bare string, number, boolean or array", () => {
    // Any of these would parse, then fail later somewhere less obvious.
    for (const v of ['"just a string"', "42", "true", "null", '[1,2,3]']) {
      expect(parseLooseJsonObject(v), v).toBeUndefined();
    }
  });
});
