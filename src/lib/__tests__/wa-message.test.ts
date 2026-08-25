import { describe, it, expect } from "vitest";
import { messageText, formAnswers } from "../wa-message";

// Every type below is a real Meta Cloud API inbound/echo payload shape.
// Before this, messageText handled only text/button/interactive/reaction and
// fell through to "[<type> message]" for everything else — so Live Chat showed
// counselors opaque labels like "[unsupported message]" and "[edit message]"
// with no way to tell what the lead had actually sent, and a document's
// filename was discarded entirely.
describe("messageText", () => {
  it("reads plain text, buttons and quick replies", () => {
    expect(messageText({ type: "text", text: { body: "  Fees please " } })).toBe("Fees please");
    expect(messageText({ type: "button", button: { text: "Yes, call me" } })).toBe("Yes, call me");
    expect(messageText({ type: "interactive", interactive: { button_reply: { title: "Data Science" } } })).toBe("Data Science");
    expect(messageText({ type: "interactive", interactive: { list_reply: { title: "Weekend batch" } } })).toBe("Weekend batch");
  });

  it("keeps the bare placeholder for uncaptioned media, and the caption when there is one", () => {
    // llm.ts swaps this EXACT shape for "look at the attached file", and the
    // Live Chat bubble treats a fully-bracketed body as "not a caption".
    expect(messageText({ type: "image", image: { id: "1" } })).toBe("[image message]");
    expect(messageText({ type: "video", video: { id: "1" } })).toBe("[video message]");
    expect(messageText({ type: "sticker", sticker: { id: "1" } })).toBe("[sticker message]");
    expect(messageText({ type: "image", image: { id: "1", caption: "My marksheet" } })).toBe("My marksheet");
  });

  it("surfaces a document's filename, which was previously thrown away", () => {
    expect(messageText({ type: "document", document: { id: "1", filename: "Aadhaar.pdf" } }))
      .toBe("📄 Aadhaar.pdf");
    expect(messageText({ type: "document", document: { id: "1", filename: "fees.pdf", caption: "Receipt attached" } }))
      .toBe("Receipt attached · 📄 fees.pdf");
    // No filename at all → still the placeholder the AI/UI expect.
    expect(messageText({ type: "document", document: { id: "1" } })).toBe("[document message]");
  });

  it("explains an unsupported message instead of hiding it", () => {
    // 21 of these landed in production as "[unsupported message]". Meta puts
    // the actual reason in errors[].
    expect(messageText({
      type: "unsupported",
      errors: [{ code: 131051, title: "Message type is not currently supported" }],
    })).toBe("⚠️ Unsupported message — Message type is not currently supported");
    expect(messageText({
      type: "unsupported",
      errors: [{ code: 131051, error_data: { details: "Poll messages are not supported" } }],
    })).toBe("⚠️ Unsupported message — Poll messages are not supported");
    // Errors absent entirely — never fall back to a bare "[unsupported message]".
    expect(messageText({ type: "unsupported" })).toBe("⚠️ WhatsApp couldn't deliver this message type");
  });

  it("shows the new text of an edited message, whichever shape Meta uses", () => {
    expect(messageText({ type: "edit", edit: { body: "Fees are 80,240" } })).toBe("✏️ (edited) Fees are 80,240");
    expect(messageText({ type: "edit", text: { body: "corrected" } })).toBe("✏️ (edited) corrected");
    expect(messageText({ type: "edit" })).toBe("✏️ (edited an earlier message)");
  });

  it("renders location, contacts, orders and system notices readably", () => {
    expect(messageText({ type: "location", location: { latitude: 28.5, longitude: 77.3, name: "Noida Centre" } }))
      .toBe("📍 Noida Centre — https://maps.google.com/?q=28.5,77.3");
    expect(messageText({ type: "location", location: {} })).toBe("📍 Location shared");
    expect(messageText({
      type: "contacts",
      contacts: [{ name: { formatted_name: "Ravi" }, phones: [{ phone: "+91 98765 43210" }] }],
    })).toBe("👤 Contact shared: Ravi +91 98765 43210");
    expect(messageText({ type: "order", order: { product_items: [{}, {}], text: "Course bundle" } }))
      .toBe("🛒 Order — 2 item(s): Course bundle");
    expect(messageText({ type: "system", system: { body: "Ravi changed their phone number" } }))
      .toBe("Ravi changed their phone number");
  });

  it("labels a voice note and handles reactions in both directions", () => {
    expect(messageText({ type: "audio", audio: { id: "1" } })).toBe("🎤 Voice note");
    expect(messageText({ type: "reaction", reaction: { emoji: "👍" } })).toBe("👍");
    // Meta omits "emoji" when a reaction is REMOVED, not only when added.
    expect(messageText({ type: "reaction", reaction: {} })).toBe("(removed a reaction)");
  });

  it("still falls back for a genuinely unknown future type", () => {
    expect(messageText({ type: "hologram" })).toBe("[hologram message]");
  });

  it("never throws on a malformed payload", () => {
    for (const m of [{}, { type: "text" }, { type: "document" }, { type: "contacts", contacts: "nope" },
                     { type: "order" }, { type: "location" }, { type: "unsupported", errors: [] }]) {
      expect(() => messageText(m as Record<string, unknown>)).not.toThrow();
    }
  });
});

describe("formAnswers", () => {
  it("parses a Flows submission and strips choice-id prefixes", () => {
    const m = { type: "interactive", interactive: { nfm_reply: { response_json: JSON.stringify({
      flow_token: "tok", Full_Name: "Asha Rao", Course: "1_Data_Science", Modes: ["0_Weekend", "1_Online"],
    }) } } };
    expect(formAnswers(m)).toEqual({ Full_Name: "Asha Rao", Course: "Data Science", Modes: "Weekend, Online" });
  });

  it("renders a form submission through messageText", () => {
    const m = { type: "interactive", interactive: { nfm_reply: { response_json: JSON.stringify({
      flow_token: "t", Full_Name: "Asha", City: "Noida",
    }) } } };
    expect(messageText(m)).toBe("[form] Full Name: Asha · City: Noida");
  });

  it("returns null for non-form interactives and malformed json", () => {
    expect(formAnswers({ type: "interactive", interactive: { button_reply: { title: "Hi" } } })).toBeNull();
    expect(formAnswers({ type: "interactive", interactive: { nfm_reply: { response_json: "{oops" } } })).toBeNull();
  });
});
