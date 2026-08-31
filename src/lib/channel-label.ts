// How each channel is named to a human, and what it can actually do.
//
// This app started as WhatsApp-only and grew Instagram, Messenger and a website
// widget around the same code. The words did not follow. The assistant's system
// prompt still opened with "You are a helpful WhatsApp assistant", told every
// customer "This is a WhatsApp chat", and asked people for "your WhatsApp
// number" — on Instagram, in Messenger, and in a browser window. And the
// broadcast test send reported "check the phone", which sends people looking at
// their SMS inbox instead of WhatsApp.
//
// One module so the wording cannot drift again: the same labels answer both
// "what do we call this channel in the UI" and "what does the model call it
// when talking to a customer".
//
// Formatting is here for the same reason. *Asterisk bold* is WhatsApp markup.
// Instagram DMs, Messenger and the web widget render it literally, so a prompt
// that tells the model to bold key terms makes those channels read
// *like this* — visible punctuation the customer has to look past.

// Every surface the assistant can WRITE on. YouTube is here because the comment
// poller answers comments with the same assistant, even though YouTube holds no
// two-way conversation — which is exactly why the two unions below are separate.
export type Platform = "whatsapp" | "instagram" | "messenger" | "webchat" | "youtube";

/**
 * The subset that holds a two-way conversation (wa_conversations.platform).
 *
 * Kept distinct from Platform so "youtube" cannot leak into conversation code
 * and be written to a column that has no such value.
 */
export type ConversationPlatform = Exclude<Platform, "youtube">;

const LABELS: Record<Platform, { full: string; short: string; place: string }> = {
  // `full`  — formal name, for prose the customer or an admin reads.
  // `short` — chips, column headers, counts.
  // `place` — reads naturally after "reply on" / "check": the place a message lands.
  whatsapp:  { full: "WhatsApp",           short: "WhatsApp",  place: "WhatsApp" },
  instagram: { full: "Instagram",          short: "Instagram", place: "Instagram DMs" },
  messenger: { full: "Facebook Messenger", short: "Messenger", place: "Messenger" },
  webchat:   { full: "the website chat",   short: "Web chat",  place: "the website chat" },
  youtube:   { full: "YouTube",             short: "YouTube",   place: "the YouTube comments" },
};

function entry(p: Platform | null | undefined) {
  return LABELS[(p ?? "whatsapp") as Platform] ?? LABELS.whatsapp;
}

/** Formal name — "WhatsApp", "Facebook Messenger", "the website chat". */
export const channelLabel = (p?: Platform | null): string => entry(p).full;

/** Compact name for chips and headers — "Messenger", "Web chat". */
export const channelShort = (p?: Platform | null): string => entry(p).short;

/** Where a message arrives, for "check ___" / "reply on ___". */
export const channelPlace = (p?: Platform | null): string => entry(p).place;

/**
 * True when *asterisks* render as bold rather than as literal asterisks.
 *
 * WhatsApp only. Everywhere else the customer sees the punctuation, so the
 * assistant must be told to write plain sentences instead.
 */
export const supportsAsteriskBold = (p?: Platform | null): boolean => (p ?? "whatsapp") === "whatsapp";

/**
 * True when the channel's identity IS a phone number, so we necessarily have it.
 *
 * This is what makes "never ask for their number" correct on WhatsApp and wrong
 * on Instagram, where the identity is a handle and a phone number is something
 * the person has to volunteer.
 */
export const identityIsPhone = (p?: Platform | null): boolean => (p ?? "whatsapp") === "whatsapp";
