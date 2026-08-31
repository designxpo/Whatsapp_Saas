// Channel wording must follow the channel.
//
// This app was WhatsApp-only and grew three more channels around the same code
// without the words following. The assistant opened every conversation with
// "You are a helpful WhatsApp assistant", told customers "This is a WhatsApp
// chat" and asked them for "your WhatsApp number" — on Instagram, in Messenger,
// and inside a browser window. Nothing failed; it just said the wrong thing to
// real customers, which no type or test could see.
//
// So the checks here are about the WORDS, not the plumbing: that each channel
// is named as itself, that WhatsApp-only markup is only requested on WhatsApp,
// and that the prompt actually varies when the platform does.
import { describe, it, expect, vi } from "vitest";
import {
  channelLabel, channelShort, channelPlace,
  supportsAsteriskBold, identityIsPhone, type Platform,
} from "../channel-label";

// YouTube is on this list because the comment poller answers with the same
// assistant — it was being told it was on WhatsApp, and to use *asterisk bold*,
// which YouTube renders as literal characters.
const ALL: Platform[] = ["whatsapp", "instagram", "messenger", "webchat", "youtube"];

describe("channel labels", () => {
  it("names every channel as itself", () => {
    expect(ALL.map(channelLabel)).toEqual([
      "WhatsApp", "Instagram", "Facebook Messenger", "the website chat", "YouTube",
    ]);
    expect(ALL.map(channelShort)).toEqual([
      "WhatsApp", "Instagram", "Messenger", "Web chat", "YouTube",
    ]);
  });

  it("never calls a non-WhatsApp channel WhatsApp", () => {
    for (const p of ALL.filter(p => p !== "whatsapp")) {
      for (const label of [channelLabel(p), channelShort(p), channelPlace(p)]) {
        expect(label.toLowerCase()).not.toContain("whatsapp");
      }
    }
  });

  it("falls back to WhatsApp for a missing platform rather than throwing", () => {
    // Conversations predating the platform column read back as null, and the
    // reply path must not break on one.
    expect(channelLabel(null)).toBe("WhatsApp");
    expect(channelLabel(undefined)).toBe("WhatsApp");
    expect(channelLabel("carrier-pigeon" as Platform)).toBe("WhatsApp");
  });

  it("claims asterisk bold only on WhatsApp", () => {
    // *Asterisks* are WhatsApp markup. Anywhere else the customer reads the
    // punctuation, so asking the model for bold actively damages the reply.
    expect(ALL.filter(supportsAsteriskBold)).toEqual(["whatsapp"]);
  });

  it("treats the identity as a phone number only on WhatsApp", () => {
    // This is what makes "never ask for their number" right on WhatsApp and
    // wrong on Instagram, where a phone number has to be volunteered.
    expect(ALL.filter(identityIsPhone)).toEqual(["whatsapp"]);
  });
});

// The prompt is assembled inside llm.ts, so reach it the way a caller does and
// read what comes out. This build resolves each tenant's own provider/model/key
// and routes through runChat(), so both of those are stubbed — keeping this a
// wording test rather than a network one.
describe("assistant system prompt", () => {
  async function promptFor(platform: Platform): Promise<string> {
    vi.resetModules();
    const seen: string[] = [];
    vi.doMock("../ai/chat", () => ({
      runChat: async (o: { system?: string }) => { seen.push(o.system ?? ""); return { text: "ok", toolCalls: [] }; },
      providerSupportsMedia: () => false,
    }));
    vi.doMock("../ai/keys", () => ({
      resolveTenantAi: async () => ({ provider: "gemini", model: "gemini-2.5-flash", apiKey: "test-key" }),
      AiKeyMissingError: class AiKeyMissingError extends Error {},
    }));
    // Billing gate: generateReply refuses outright for an account that isn't in
    // good standing, and would never reach the prompt.
    vi.doMock("../feature-guard", () => ({ accountCanSend: async () => true }));
    vi.doMock("../moderation", () => ({ moderateText: async () => ({ allowed: true, reason: null }) }));

    const { generateReply } = await import("../llm");
    await generateReply(
      [{ role: "user", body: "what are the pricing options?" }],
      "919876543210", null, undefined, null, false, undefined, platform,
    );
    return seen.join("\n\n");
  }

  it("tells an Instagram customer they are on Instagram", async () => {
    const p = await promptFor("instagram");
    expect(p).toContain("Instagram");
    // The specific sentence that used to reach Instagram customers verbatim.
    expect(p).not.toContain("This is a WhatsApp chat");
    expect(p).not.toContain("WhatsApp assistant");
  });

  it("still says WhatsApp on WhatsApp", async () => {
    expect(await promptFor("whatsapp")).toContain("WhatsApp");
  });

  it("forbids asterisk bold off WhatsApp and allows it on", async () => {
    // YouTube included: the comment poller answers with this same assistant.
    expect(await promptFor("messenger")).toContain("does not support bold");
    expect(await promptFor("youtube")).toContain("does not support bold");
    expect(await promptFor("whatsapp")).not.toContain("does not support bold");
  });
});
