import { describe, it, expect, vi } from "vitest";

// kb.ts → store.ts → supabase. The functions under test (chunkText, headeredChunks,
// reconstructText) are pure and never touch the DB, so stub the heaviest leaf to
// keep the import cheap and offline.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure chunking tests"); } }));

import { chunkText, headeredChunks, reconstructText } from "@/lib/kb";

describe("chunkText — heading awareness", () => {
  it("plain paragraphs carry no heading", () => {
    const out = chunkText("First paragraph here.\n\nSecond paragraph here.");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(c => c.heading === null)).toBe(true);
    expect(out.map(c => c.content).join(" ")).toContain("First paragraph");
  });

  it("a markdown heading becomes the section of the chunk that follows", () => {
    const out = chunkText("## Data Science Fees\n\nThe program costs INR 50,000 for 6 months.");
    const feeChunk = out.find(c => c.content.includes("50,000"));
    expect(feeChunk?.heading).toBe("Data Science Fees");
  });

  it("a bare label line ('Fees:') is a heading, but 'key: value' stays as data", () => {
    const labelled = chunkText("Fees:\n\nINR 50,000 total.");
    expect(labelled.find(c => c.content.includes("50,000"))?.heading).toBe("Fees");

    // "Course Fee: INR 50,000" ends with a value, not a colon → NOT a heading.
    const kv = chunkText("Course Fee: INR 50,000");
    expect(kv[0].heading).toBeNull();
    expect(kv[0].content).toContain("Course Fee: INR 50,000");
  });

  it("an oversized table splits on line boundaries, never mid-row", () => {
    const rows = Array.from({ length: 120 }, (_, i) => `Row ${i} | course-${i} | detail-value-${i}`);
    const out = chunkText(rows.join("\n"));
    expect(out.length).toBeGreaterThan(1);               // it did split
    const joined = out.map(c => c.content).join("\n");
    for (const r of rows) expect(joined).toContain(r);   // every row survived intact
    // No chunk wildly exceeds the target window.
    expect(out.every(c => c.content.length <= 1600)).toBe(true);
  });
});

describe("headeredChunks — context prefix", () => {
  it("prepends [title] and [title › section] and truncates a very long title", () => {
    const chunks = [
      { content: "body one", heading: null },
      { content: "body two", heading: "Fees" },
    ];
    const out = headeredChunks("Data Science 360", chunks);
    expect(out[0]).toBe("[Data Science 360]\n\nbody one");
    expect(out[1]).toBe("[Data Science 360 › Fees]\n\nbody two");

    const longTitle = "x".repeat(400);
    expect(headeredChunks(longTitle, [{ content: "b", heading: null }])[0].length).toBeLessThan(160);
  });
});

describe("reconstructText — strip header + merge overlap (reprocess round-trip)", () => {
  const doc = [
    "## Overview",
    "AnalytixLabs offers a Data Science 360 program for working professionals.",
    "It blends Python, statistics, machine learning and real-world capstone projects.",
    "## Fees",
    "The total fee is INR 50,000, payable in three instalments over the course.",
    "An early-bird discount of 10 percent applies for the first batch each quarter.",
  ].join("\n\n");

  it("recovers the document text without the [..] headers and without duplicating overlap", () => {
    const headered = headeredChunks("Data Science 360", chunkText(doc));
    const rebuilt = reconstructText(headered);
    expect(rebuilt).not.toContain("[Data Science 360");          // header stripped
    expect(rebuilt).toContain("total fee is INR 50,000");        // content preserved
    expect(rebuilt).toContain("## Fees");                        // heading preserved
    // Overlap not duplicated — the rebuilt text isn't materially longer than source.
    expect(rebuilt.length).toBeLessThanOrEqual(doc.length + 40);
  });

  it("is STABLE across repeated reprocess (chunk→header→reconstruct twice)", () => {
    const once = reconstructText(headeredChunks("Data Science 360", chunkText(doc)));
    const twice = reconstructText(headeredChunks("Data Science 360", chunkText(once)));
    expect(twice).toBe(once);
    // Sections still resolve on the second pass.
    const reChunked = chunkText(once);
    expect(reChunked.some(c => c.heading === "Fees")).toBe(true);
  });

  // A PDF that lost its line breaks becomes one long no-newline blob, which the
  // chunker hard-splits mid-character with a fixed overlap. Reconstruct must
  // recover it EXACTLY — the overlap-merge must not over-collapse on repetition.
  it("a long no-newline blob hard-split into chunks reconstructs exactly", () => {
    let blob = "";
    for (let i = 0; i < 3000; i++) blob += String.fromCharCode(33 + (i % 90));
    const rebuilt = reconstructText(headeredChunks("Doc", chunkText(blob)));
    expect(rebuilt).toBe(blob);
  });

  it("a literal '## ' inside ordinary body text is not mistaken for a heading or lost", () => {
    const text = "Use ## to start a comment in the config file.\n\nThen save and restart the service to apply.";
    expect(chunkText(text).every(c => c.heading === null)).toBe(true);
    const rebuilt = reconstructText(headeredChunks("Doc", chunkText(text)));
    expect(rebuilt).toContain("Then save and restart");
  });

  it("a bare-label section stays stable across THREE reprocess cycles", () => {
    const text = "Total Fees:\n\nINR 50,000 payable in instalments.";
    const once = reconstructText(headeredChunks("Doc", chunkText(text)));
    const twice = reconstructText(headeredChunks("Doc", chunkText(once)));
    const thrice = reconstructText(headeredChunks("Doc", chunkText(twice)));
    expect(twice).toBe(once);
    expect(thrice).toBe(once);
  });
});
