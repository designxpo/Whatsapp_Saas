// How a conversation is matched to its LeadSquared push buffer.
//
// Pure and dependency-free on purpose: the server derives these keys from
// wa_crm_session rows and the Live Chat client derives them from conversations,
// so both sides MUST agree exactly. Anything importing db() could not be used
// from the browser half.
//
// Matching is on the LAST 10 DIGITS, not the full number. wa_crm_session.phone
// stores whatever digits arrived on the message, so the same person shows up as
// "8368872108" there and "918368872108" on the conversation. An exact-string
// join therefore finds nothing and reports every one of those chats as "clear" —
// the same country-code mismatch that already made consentMissing report zero.
//
// Non-numeric identities (a phone-less Instagram lead buffered as
// "handle:@someone") fall through to a normalised literal.

export function crmChatKey(id: string | null | undefined): string {
  const raw = (id ?? "").trim();
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length >= 10) return d.slice(-10);
  return raw.toLowerCase();
}

export type ChatCrmState =
  | "clear"    // nothing buffered — everything for this chat has been posted
  | "queued"   // buffered, waiting for the chat to go quiet before posting
  | "held"     // a push failed; retrying on a backoff
  | "dead";    // pushes were abandoned — needs a person

export interface ChatCrmStatus {
  state: ChatCrmState;
  attempts: number;
  /** When the buffered messages are next due to post. null once abandoned. */
  dueAt: string | null;
}
