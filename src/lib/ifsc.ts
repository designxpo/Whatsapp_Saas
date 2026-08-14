// India IFSC code → bank + branch, via the free, no-auth Razorpay IFSC API
// (ifsc.razorpay.com/{IFSC}). An IFSC identifies a bank branch — it is NOT
// personal data, so no customer PII leaves the system. Best-effort: any failure
// returns null / {} so a bank-details flow (refunds, payouts, COD→prepaid) is
// never blocked.

export interface IfscInfo { ifsc: string; bank: string; branch: string; city: string; state: string }

// IFSC = 4-letter bank code + '0' + 6-char alphanumeric branch code (e.g. SBIN0001234).
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const IFSC_KEY_RE = /(?:^|_)(?:ifsc|ifsc_code|bank_code|bank_ifsc)(?:$|_)/i;

export function normalizeIfsc(text: string): string {
  return (text || "").toUpperCase().replace(/\s/g, "");
}

// A plausible IFSC (format-only, deterministic). The authoritative check is the
// lookup, which is best-effort.
export function isIfsc(text: string): boolean {
  return IFSC_RE.test(normalizeIfsc(text));
}

// Should this answer trigger bank autofill? True for an explicit "ifsc" type/rule
// or an attribute key that reads like an IFSC field.
export function isIfscField(typeOrRule: string | undefined, attrKey: string | undefined): boolean {
  if ((typeOrRule || "").toLowerCase() === "ifsc") return true;
  return IFSC_KEY_RE.test(attrKey || "");
}

export async function lookupIfsc(code: string): Promise<IfscInfo | null> {
  const c = normalizeIfsc(code);
  if (!IFSC_RE.test(c)) return null;
  try {
    const r = await fetch(`https://ifsc.razorpay.com/${c}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;   // 404 = unknown IFSC
    const j = (await r.json()) as Record<string, unknown>;
    const bank = String(j.BANK ?? "").trim();
    if (!bank) return null;
    return {
      ifsc: c,
      bank,
      branch: String(j.BRANCH ?? "").trim(),
      city: String(j.CITY ?? j.CENTRE ?? "").trim(),
      state: String(j.STATE ?? "").trim(),
    };
  } catch {
    return null;
  }
}

// The bank attributes an IFSC answer should fill, WITHOUT clobbering values the
// flow already captured. Returns only the keys to add ({} on any failure).
export async function deriveIfscAttrs(
  current: Record<string, string> | undefined,
  code: string,
): Promise<Record<string, string>> {
  const info = await lookupIfsc(code);
  if (!info) return {};
  const cur = current ?? {};
  const add: Record<string, string> = {};
  const setIfAbsent = (k: string, v: string) => { if (v && !String(cur[k] ?? "").trim()) add[k] = v; };
  setIfAbsent("bank", info.bank);
  setIfAbsent("bank_branch", info.branch);
  return add;
}
