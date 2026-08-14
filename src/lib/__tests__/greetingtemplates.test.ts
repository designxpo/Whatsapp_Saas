import { describe, it, expect } from "vitest";
import { buildFestivalGreeting } from "../greetingtemplates";

describe("buildFestivalGreeting", () => {
  it("slugs the name to a valid Meta template name and includes {{1}}", () => {
    const g = buildFestivalGreeting("Diwali/Deepavali");
    expect(g.nameSlug).toBe("diwali_deepavali_greeting");
    expect(g.body).toContain("{{1}}");
    expect(g.body.toLowerCase()).toContain("diwali");
    expect(g.category).toBe("MARKETING");
    expect(g.example).toBeTruthy();
  });

  it("uses a festival-specific wish when recognised, generic otherwise", () => {
    expect(buildFestivalGreeting("Holi").body).toContain("colourful");
    expect(buildFestivalGreeting("Founders Day").body).toContain("Founders Day");
  });

  it("handles empty input safely", () => {
    expect(buildFestivalGreeting("").nameSlug).toBe("festival_greeting");
  });
});
