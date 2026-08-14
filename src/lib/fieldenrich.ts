// Shared "smart field" enricher: derives extra contact attributes from a single
// answer — a postal code → city/state/district, an IFSC → bank/branch — all
// set-if-absent (an explicitly-answered value is never clobbered). Every lookup
// is non-PII and best-effort, so this returns {} rather than throwing.
//
// One place for every capture point (flow ask node, chat-form fallback, native
// WhatsApp form submission) to call, so adding a new smart field later is a
// one-line change here.

import { isPincodeField, isPincode, derivePincodeAttrs } from "./pincode";
import { isIfscField, isIfsc, deriveIfscAttrs } from "./ifsc";

export async function deriveFieldAttrs(
  typeOrRule: string | undefined,
  attrKey: string | undefined,
  value: string,
  current: Record<string, string> | undefined,
): Promise<Record<string, string>> {
  try {
    if (isPincodeField(typeOrRule, attrKey) && isPincode(value)) return await derivePincodeAttrs(current, value);
    if (isIfscField(typeOrRule, attrKey) && isIfsc(value)) return await deriveIfscAttrs(current, value);
  } catch {
    /* best-effort — never block capture on an enrichment failure */
  }
  return {};
}
