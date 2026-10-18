// Reading a credential out of a query string that the client mangled.
//
// LeadSquared's Custom Lead Action does not send "?token=<value>" as the
// operator typed it. The "=" is encoded somewhere between the connector's
// config box and the browser, so the whole "token=<value>" string arrives as
// a PARAMETER NAME with an empty value:
//
//   new URL("https://x/a?token%3Dabc").searchParams.get("token")  →  null
//   …entries()                                                     →  ["token=abc", ""]
//
// Measured on the live connector, 12 Oct 2026.
//
// ── Why this lives in its own module ────────────────────────────────────────
//
// There are TWO places a query credential is read: crm.ts compares it against
// the environment's CRM_PANEL_TOKEN, and apikeys.ts offers it as a candidate
// minted tenant key. Fixing only one is exactly the mistake that was made
// first time round — the shim went into apikeys.ts, the request authenticates
// through crm.ts, and the 401 did not move.
//
// crm.ts is reached from apikeys.ts by dynamic import to avoid a cycle, so a
// shared helper cannot live in either of them.
//
// This is a compatibility shim, not a loosening: every caller still COMPARES
// the value it gets back. All this changes is where the value is found.

/**
 * Every string in this URL's query that could be the `token` credential,
 * most-likely first.
 *
 * - `?token=abc`     → ["abc"]            the documented form
 * - `?token%3Dabc`   → ["abc"]            the "=" was encoded into the key
 * - `?abc`           → ["abc"]            pasted with no parameter name
 * - `?leadId=805c`   → []                 an ordinary pair is DATA, not a secret
 */
export function queryTokenCandidates(url: string): string[] {
  const out: string[] = [];
  let u: URL;
  try { u = new URL(url); } catch { return out; }

  const named = u.searchParams.get("token");
  if (named) out.push(named);

  for (const [k, v] of u.searchParams.entries()) {
    // A real name=value pair is data. Treating it as a credential would mean
    // hashing every query parameter of every request.
    if (v) continue;
    const m = /^token=(.+)$/i.exec(k);
    const candidate = m ? m[1] : k;
    // A credential is not 500 characters long; refusing the absurd keeps a
    // junk query string from becoming work.
    if (candidate && candidate.length <= 200 && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}
