import { describe, it, expect, vi } from "vitest";

// Pure-helper tests (same approach as flowengine.test.ts) — db() must never run.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure tests"); } }));

import { chatFieldPrompt, looseIndex, matchOption, looksConversational, type ChatFormField } from "../flowengine";
import { fieldSlug } from "../waforms";

// The chat-native waform fallback (IG/Messenger/web chat) asks the form's fields
// one message at a time. These helpers decide the attribute key and the bubble.
describe("fieldSlug — chat answers land on the same keys as a real submission", () => {
  it("slugs exactly like buildFlowJson's field names", () => {
    expect(fieldSlug("Full name")).toBe("full_name");
    expect(fieldSlug("Email")).toBe("email");
    expect(fieldSlug("  Which course? ")).toBe("which_course");
    expect(fieldSlug("Phone / WhatsApp number")).toBe("phone_whatsapp_number");
  });
  it("caps at 30 chars and falls back for empty labels", () => {
    expect(fieldSlug("a".repeat(50)).length).toBe(30);
    expect(fieldSlug("!!!", 2)).toBe("field_3");
  });
});

describe("chatFieldPrompt — one question bubble per field", () => {
  const f = (over: Partial<ChatFormField>): ChatFormField => ({ n: "x", l: "Label", t: "text", o: [], ...over });
  it("plain fields become a question", () => {
    expect(chatFieldPrompt(f({ l: "Full name" }))).toBe("Full name?");
  });
  it("labels already ending in ? or : stay as-is", () => {
    expect(chatFieldPrompt(f({ l: "What's your city?" }))).toBe("What's your city?");
    expect(chatFieldPrompt(f({ l: "Your email:" }))).toBe("Your email:");
  });
  it("options render as a numbered menu", () => {
    expect(chatFieldPrompt(f({ l: "Course", o: ["Data Science", "GenAI"] }))).toBe("Course\n1. Data Science\n2. GenAI");
  });
  it("opt-ins ask for yes/no", () => {
    expect(chatFieldPrompt(f({ l: "I agree to be contacted", t: "optin" }))).toBe("I agree to be contacted (yes/no)");
  });
});

describe("looseIndex + matchOption — typed menu picks on web/IG chat", () => {
  // The exact production miss: the visitor TYPED an approximation of a list
  // option and the flow fell through to the AI instead of branching.
  const COURSES = ["Data Science & GenAI", "Data Analytics with AI", "Full Stack AI Course", "Analytics Edge", "Executive Certification"];
  it("resolves 'Data Science and gen ai' to 'Data Science & GenAI'", () => {
    expect(looseIndex(COURSES, "Data Science and gen ai")).toBe(0);
  });
  it("resolves a unique partial ('full stack')", () => {
    expect(looseIndex(COURSES, "full stack")).toBe(2);
  });
  it("refuses ambiguous input ('data' hits two options)", () => {
    expect(looseIndex(COURSES, "data")).toBeNull();
  });
  it("refuses too-short input", () => {
    expect(looseIndex(COURSES, "ai")).toBeNull();
  });
  // Production regression: "I want to know about courses" typed under a
  // "Get Started" button reads conversational (the "i want" prefix), so an
  // AI-first gate swallowed the off-script nudge and the chat went silent.
  // The nudge must outrank the AI on menu waits — this documents the trap.
  it("off-script menu text can read conversational — the nudge must not defer to the AI", () => {
    expect(looksConversational("I want to know about courses")).toBe(true);
    expect(looksConversational("???")).toBe(true);
    expect(looksConversational("Data Science and gen ai")).toBe(false);   // a genuine menu attempt
  });
  it("matchOption picks the branch for a typed approximation on a list node", () => {
    const node = { id: "menu", type: "list", data: { rows: COURSES.map((t, i) => ({ id: `opt_${i}`, title: t })) } } as unknown as Parameters<typeof matchOption>[0];
    expect(matchOption(node, "Data Science and gen ai")).toBe("opt_0");
    expect(matchOption(node, "I want the executive certification please")).toBe("opt_4");
    expect(matchOption(node, "data")).toBeNull();   // ambiguous → AI answers
  });
});
