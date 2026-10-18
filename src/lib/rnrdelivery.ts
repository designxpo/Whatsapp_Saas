import { clearContactAttributes } from "./dripstore";
import { DEFAULT_TENANT_ID } from "./tenant";
// What a FAILED delivery means for the RNR button.
//
// ── The bug this exists to close ────────────────────────────────────────────
//
// Meta answers the send API with a message id before it has decided whether
// to deliver anything. The route takes that id as success: it stamps
// rnr_nudge_a_at on the contact and tells the counsellor the message went.
//
// Seconds later a webhook arrives saying it did not:
//
//   131049 — "This message was not delivered to maintain healthy ecosystem
//             engagement."
//
// That is Meta's per-RECIPIENT marketing frequency cap. It is not about our
// number (GREEN, connected, verified) or our template (approved); it is a
// limit on how many marketing messages that person receives from every
// business combined, and it drops the message after accepting it.
//
// Nothing recovered from that. The stamp stayed, so:
//
//   · the counsellor was told it sent,
//   · "one a day" then refused a retry for the rest of the day,
//   · and TOMORROW the lead would be sent Message B — "we tried calling you
//     again" — referring to a Message A that never arrived.
//
// Measured 13 October 2026 on two live leads, and on a third on 7 October.
//
// ── What happens instead ────────────────────────────────────────────────────
//
// The failure retracts the stamp, so the day is given back and the counsellor
// can simply press again. The reason is kept on the contact, because a stamp
// that silently disappears is indistinguishable from one that was never
// written, and somebody will eventually ask which it was.
//
// Best-effort throughout: this runs inside Meta's webhook, which is retried
// if it does not get a fast 200. A failure to tidy up must never turn a
// delivered message into a redelivered one.

import { getContactByPhoneLoose, setContactAttributes, } from "./store";
import { nudgeToRevert, attrFor } from "./rnrnudge";

/** When a nudge was last dropped after Meta had already accepted it. */
export const DROP_AT_ATTR = "rnr_last_drop_at";
/** Why — Meta's own words, so nobody has to look the code up. */
export const DROP_REASON_ATTR = "rnr_last_drop_reason";
/** Which message was lost, so "press again" has an obvious meaning. */
export const DROP_NUDGE_ATTR = "rnr_last_drop_nudge";

/** Meta's marketing frequency cap: accepted, then deliberately not delivered. */
export const WA_ECOSYSTEM_CAP = 131049;

export interface DropResult {
  /** The nudge whose stamp was retracted, or null when none matched. */
  reverted: "A" | "B" | null;
  reason?: string;
}

/**
 * Give back the day after Meta drops a nudge it had already accepted.
 *
 * Returns what it did rather than throwing, so the webhook can log one line
 * and move on. A failure outside the window retracts nothing on purpose:
 * retracting the wrong stamp would re-send a message the lead already has,
 * which is worse than leaving this one for a human to notice.
 */
export async function revertDroppedNudge(
  phone: string,
  failedAt: Date,
  reason: string,tenantId = DEFAULT_TENANT_ID
): Promise<DropResult> {
  try {
    const to = String(phone ?? "").replace(/\D/g, "");
    if (to.length < 10) return { reverted: null };

    const contact = await getContactByPhoneLoose(to, tenantId).catch(() => null);
    if (!contact) return { reverted: null };

    const attrs = (contact.attributes ?? {}) as Record<string, string>;
    const which = nudgeToRevert(
      { sentA: attrs[attrFor("A")] ?? null, sentB: attrs[attrFor("B")] ?? null },
      failedAt,
    );
    if (!which) return { reverted: null };

    // Order matters only for readability: record why before the evidence of
    // the send disappears, so a reader never sees a drop with no stamp and
    // no explanation.
    await setContactAttributes(contact.phone ?? to, {
      [DROP_AT_ATTR]: failedAt.toISOString(),
      [DROP_REASON_ATTR]: reason.slice(0, 300),
      [DROP_NUDGE_ATTR]: which,
    }, tenantId).catch(() => undefined);

    const cleared = await clearContactAttributes(contact.phone ?? to, [attrFor(which)], tenantId);
    return cleared ? { reverted: which, reason } : { reverted: null };
  } catch {
    return { reverted: null };
  }
}
