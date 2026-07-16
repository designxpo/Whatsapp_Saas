import { describe, it, expect } from "vitest";
import { resolveCannedParams } from "../canned";

describe("resolveCannedParams", () => {
  it("fills tokens case-insensitively and keeps literals", () => {
    expect(resolveCannedParams(["Hi {Name}, {counselor} here", "literal"], { name: "Asha", counselor: "Ravi" }))
      .toEqual(["Hi Asha, Ravi here", "literal"]);
  });

  it("unknown tokens become blank — including Object.prototype members", () => {
    expect(resolveCannedParams(["{unknown}x", "{constructor}y", "{hasownproperty}z"], {}))
      .toEqual(["x", "y", "z"]);
  });

  it("sanitizes for Meta: newlines/tabs → space, space runs collapsed, trimmed", () => {
    expect(resolveCannedParams(["{answer}"], { answer: "line1\nline2\t\tend    done  " }))
      .toEqual(["line1 line2 end done"]);
  });

  it("token values containing {token} are not re-expanded", () => {
    expect(resolveCannedParams(["{a}"], { a: "{b}", b: "evil" })).toEqual(["{b}"]);
  });
});
