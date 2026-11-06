// Conversation labels with a meaning the code acts on. Kept in a module of its
// own (no imports) so every caller can read them without loading store.ts.

/**
 * A web-chat visitor typed a phone number that matches an EXISTING contact.
 * Anyone can type anyone's number, so the chat is not linked to that contact
 * or their CRM lead until an agent confirms it and removes this label.
 */
export const UNVERIFIED_PHONE_LABEL = "phone-unverified";
