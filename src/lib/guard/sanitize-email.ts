// The model has a habit of inventing plausible-looking staff/department emails
// (training@, admissions@, support@…) when asked for contact details — none of
// which are real. Only the approved public inbox may survive; every other address
// on the same domain is deterministically rewritten to it. Multi-tenant, so the
// approved email comes from config (PUBLIC_CONTACT_EMAIL / per-tenant) and the
// scrub is a no-op when unset. URLs (no '@') are never touched.
//
// Kept in its own dependency-free module so the GroundingFirewall and the outbound
// sanitizer can both reuse it without an import cycle.
export const PUBLIC_CONTACT_EMAIL = (process.env.PUBLIC_CONTACT_EMAIL || "").trim().toLowerCase();

export function scrubContactEmails(text: string, approved: string = PUBLIC_CONTACT_EMAIL): string {
  const email = approved.trim().toLowerCase();
  const domain = email.split("@")[1];
  if (!text || !domain) return text;   // no approved email configured → no-op
  const re = new RegExp(`[A-Za-z0-9._%+-]+@${domain.replace(/\./g, "\\.")}`, "gi");
  return text.replace(re, m => (m.toLowerCase() === email ? m : email));
}
