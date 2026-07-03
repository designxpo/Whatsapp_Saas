import { describe, it, expect, vi } from "vitest";

// Pure-helper tests (same approach as flowengine.test.ts) — db() must never run.
vi.mock("@/lib/supabase", () => ({ db: () => { throw new Error("db() should not be called in pure tests"); } }));

import { chatFieldPrompt, type ChatFormField } from "../flowengine";
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
