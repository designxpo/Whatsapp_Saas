import { DEFAULT_TENANT_ID } from "./tenant";
// The drip conversation, kept on the lead in LeadSquared.
//
// Decided 1 October: everything the RNR drip says and everything the lead
// says back goes into mx_RNR_DRIP_LOGS, and NOT onto the main WhatsApp
// activity timeline. The timeline is for conversations a human had; four
// weeks of automated nurture buried in it makes the real ones hard to find.
//
// ── Why the log is built here and only mirrored there ──────────────────────
//
// The obvious implementation — read the field, append a line, write it back
// — is wrong twice over. LeadSquared's reads lag its writes by seconds
// (measured: a read-back immediately after a write returns the previous
// value), so two taps close together would read the same stale text and the
// second would erase the first. And a read-modify-write against a CRM that
// answers HTTP 200 for a no-op gives no way to tell a lost line from a
// written one.
//
// So the authoritative copy lives on our own contact record, where appending
// is a local operation, and LeadSquared gets the whole rendered value
// overwritten each time. Idempotent, self-healing, and one source of truth.
//
// ── Why the lines are terse ────────────────────────────────────────────────
//
// The field holds 256 characters today; the largest Text field in their
// instance is 1000. Either way a four-week journey of seven sends plus
// replies has a few hundred characters to live in, so a line is a date, a
// direction and a few words. When it overflows, the OLDEST lines go: the
// counsellor reading this wants to know what the lead just did, and the
// beginning of a nurture nobody answered is the least useful part of it.

import { partsIn } from "./businessclock";

/** Contact attribute holding our copy of the log. */
export const DRIP_LOG_ATTR = "rnr_drip_log";

/**
 * What mx_RNR_DRIP_LOGS can hold.
 *
 * 256 is the field's MaxLength as created. Their instance already has Text
 * fields at 1000 (mx_Chat_Transcript, mx_Remarks), so this is raisable —
 * and should be, because 256 is about six lines.
 */
export const DRIP_LOG_MAX = Number(process.env.LSQ_DRIP_LOG_MAX ?? 256) || 256;

/** Shown when older lines have been dropped to make room. */
export const TRIM_MARK = "…";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "02Oct 11:30" — short enough to repeat on every line. */
export function stamp(at: Date): string {
  // In the business's timezone: a counsellor reading "02Oct 05:30" for a
  // message that went out at 11:00 their time would reasonably conclude the
  // log was broken.
  const p = partsIn(at);
  const d = String(p.day).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${d}${MONTHS[p.month - 1]} ${hh}:${mm}`;
}

/**
 * One line of the log.
 *
 * The arrow is the whole grammar: → is us, ← is the lead. A counsellor
 * skimming the field needs to see who spoke last before anything else.
 */
export function dripLine(at: Date, direction: "out" | "in", text: string): string {
  const arrow = direction === "out" ? "→" : "←";
  const body = String(text ?? "").replace(/\s+/g, " ").trim();
  return `${stamp(at)} ${arrow} ${body}`;
}

/**
 * Append a line, dropping the oldest ones if the result will not fit.
 *
 * Pure. The trimming is the part worth testing exhaustively: a log that
 * silently grows past the field's limit is written as HTTP 200 and stored
 * as nothing, which is the one outcome worse than losing the oldest line.
 */
export function appendDripLine(existing: string, line: string, maxChars = DRIP_LOG_MAX): string {
  const fresh = String(line ?? "").trim();
  if (!fresh) return String(existing ?? "");

  // A single line longer than the whole budget is hard-cut rather than
  // dropped: something is better than a gap where the lead's reply was.
  if (fresh.length >= maxChars) return fresh.slice(0, maxChars);

  const lines = String(existing ?? "")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && l !== TRIM_MARK);
  lines.push(fresh);

  // Drop from the front until it fits, then say that we did.
  while (lines.length > 1 && lines.join("\n").length > maxChars) lines.shift();
  if (lines.join("\n").length > maxChars) return fresh.slice(0, maxChars);

  const trimmed = lines.join("\n");
  const withMark = `${TRIM_MARK}\n${trimmed}`;
  const didDrop = String(existing ?? "").trim() !== "" && !trimmed.startsWith(firstLineOf(existing));
  return didDrop && withMark.length <= maxChars ? withMark : trimmed;
}

const firstLineOf = (s: string): string => {
  const l = String(s ?? "").split("\n").map(x => x.trim()).filter(x => x && x !== TRIM_MARK);
  return l[0] ?? "";
};

/** How a drip SEND reads in the log. Template names, not bodies — no room. */
export const sendLine = (at: Date, label: string): string => dripLine(at, "out", label);

/**
 * The longest a single reply may be.
 *
 * This was a hard-coded 60, which was right while mx_RNR_DRIP_LOGS held 256
 * characters: one long sentence would have consumed most of the field and
 * pushed out the history it is supposed to sit in.
 *
 * The field holds 1,000 now, so the constraint that justified 60 is gone —
 * and 60 was cutting real messages mid-sentence. "Hi! I'd like to learn more
 * about the courses offered by AnalytixLabs." is 69 characters and arrived in
 * the field as "…offered by Anal", which is unreadable and, as it happens,
 * reads badly.
 *
 * Derived from the field size rather than fixed, so raising
 * LSQ_DRIP_LOG_MAX raises this too and nobody has to remember both. A third
 * of the field keeps the original intent intact: a single message can be
 * generous without crowding out the two or three around it.
 */
export const replyMaxText = (): number => Math.max(80, Math.floor(DRIP_LOG_MAX / 3));

/**
 * How a lead's reply reads.
 *
 * A tap is short and goes in whole. A typed message is cut only if it has to
 * be — and then on a WORD BOUNDARY with an ellipsis, so a counsellor can see
 * both what was said and that there was more of it.
 */
export const replyLine = (at: Date, text: string, maxText = replyMaxText()): string =>
  dripLine(at, "in", clip(String(text ?? "").replace(/\s+/g, " ").trim(), maxText));

/**
 * Cut to length without severing a word.
 *
 * Falls back to a hard cut when there is no space to break at — one
 * 300-character "word" is not a sentence, and losing all of it to protect a
 * boundary that does not exist would be worse than cutting it.
 */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const room = max - 1;                       // leave space for the ellipsis
  const cut = s.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");
  // Only honour the boundary when it is near the end; a space at character 3
  // of a 250-character budget would throw almost everything away.
  const body = lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

// ── Writing it down ─────────────────────────────────────────────────────────

import { getContactByPhoneLoose, setContactAttributes } from "./store";
import { ensureLead, setLeadField } from "./leadsquared";

/** The LeadSquared field, named in the env so it ships inert until set. */
export const DRIP_LOG_FIELD = () => (process.env.LSQ_RNR_RESPONSE_FIELD ?? "").trim();

/**
 * "rnr_03_about_us" reads as "about us". The template name is ours, not
 * something a counsellor should have to decode, and the field has no room
 * for the body.
 */
export function humaniseTemplate(name: string): string {
  const s = String(name ?? "").trim();
  if (!s) return "message";
  return s.replace(/^rnr_\d+_/, "").replace(/_/g, " ");
}

/**
 * Record one drip event against the lead.
 *
 * Appends to our own copy first, then overwrites the CRM field with the
 * whole thing. Never a read-modify-write against LeadSquared: its reads lag
 * its writes by seconds, so two taps close together would both read the
 * same stale text and the second would erase the first.
 *
 * Best-effort throughout. A log that failed to write must never turn a
 * delivered message into a retried one.
 */
export async function recordDripEvent(phone: string, line: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
  if (!line.trim()) return false;
  try {
    const contact = await getContactByPhoneLoose(phone, tenantId).catch(() => null);
    const next = appendDripLine(contact?.attributes?.[DRIP_LOG_ATTR] ?? "", line);

    // Write back to the phone the contact is actually STORED under, not the
    // one we were handed. The read above is suffix-aware and the write is
    // not: given "8368872108" the read finds "918368872108" and the write
    // then looks for an exact match, finds nothing, and returns silently.
    // That combination lost a whole run's log on 1 October — five messages
    // sent, no history anywhere, and no error to notice.
    await setContactAttributes(contact?.phone ?? phone, { [DRIP_LOG_ATTR]: next }, tenantId).catch(() => undefined);

    const field = DRIP_LOG_FIELD();
    if (!field) return false;              // not configured yet; our copy still kept
    const leadId = await ensureLead(phone, undefined, undefined, tenantId);
    if (!leadId) return false;
    return await setLeadField(leadId, field, next, tenantId);
  } catch (e) {
    console.error(JSON.stringify({ tag: "drip_log_failed", phone: phone.slice(-4), error: String(e) }));
    return false;
  }
}
