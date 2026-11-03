// How well each ACCOUNT (business) is protected at sign-in — one answer per
// account, not a list of people. Pure, so the owner screen can import the
// labels; the cross-business read is in securityposture.ts.
//
// The platform owner needs to see which businesses are exposed. Showing every
// person of every business with "2FA on / off" answered that badly: it was a
// wall of names the owner can't act on (they don't run those teams), and it
// put other businesses' staff lists in front of someone who only needs the
// verdict. So the people are counted, never listed, and each account gets one
// level:
//
//   secure   Fully secured — everyone signs in with a second factor AND has a
//            passkey (phishing-resistant: it can't be typed into a fake page).
//   good     Secured — everyone has a second factor; some have no passkey yet.
//   partial  Partially secured — every admin is covered, some members are not.
//   high     High risk — at least one ADMIN has no authenticator app or
//            passkey. An admin can change the WhatsApp numbers, API keys, team
//            and billing; the emailed code on a new device is the only thing
//            between a leaked password and all of it, and an email account is
//            often the thing that leaked.
//   empty    Nobody can sign in yet.
//
// "Second factor" here means one the person set up: an authenticator app or a
// passkey (a passkey counts on its own: signing in with one already proves
// something you have). The emailed new-device code everyone gets is the
// baseline, not a level.

export type SecurityLevel = "secure" | "good" | "partial" | "high" | "empty";

export interface PersonSecurity {
  role: string;
  twoFactor: boolean;
  passkeys: number;
  recoveryVerified: boolean;
}

export interface AccountSecurity {
  level: SecurityLevel;
  /** One sentence: why this level, in terms the owner can pass on. */
  reason: string;
  people: number;
  protectedPeople: number;
  withPasskey: number;
  admins: number;
  protectedAdmins: number;
  withRecovery: number;
}

export const LEVEL_LABEL: Record<SecurityLevel, string> = {
  secure: "Fully secured",
  good: "Secured",
  partial: "Partially secured",
  high: "High risk",
  empty: "No one signs in yet",
};

/** Riskiest first, for sorting. */
export const LEVEL_ORDER: SecurityLevel[] = ["high", "partial", "good", "secure", "empty"];

const isProtected = (p: PersonSecurity) => p.twoFactor || p.passkeys > 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One account's level from its people. Pure. */
export function accountSecurity(people: PersonSecurity[]): AccountSecurity {
  const admins = people.filter(p => p.role === "admin");
  const counts = {
    people: people.length,
    protectedPeople: people.filter(isProtected).length,
    withPasskey: people.filter(p => p.passkeys > 0).length,
    admins: admins.length,
    protectedAdmins: admins.filter(isProtected).length,
    withRecovery: people.filter(p => p.recoveryVerified).length,
  };
  if (!people.length) return { level: "empty", reason: "No team members have been added yet.", ...counts };

  const exposedAdmins = counts.admins - counts.protectedAdmins;
  if (exposedAdmins > 0) {
    return { level: "high", reason: `${plural(exposedAdmins, "admin")} ${exposedAdmins === 1 ? "has" : "have"} no authenticator app or passkey.`, ...counts };
  }
  const exposed = counts.people - counts.protectedPeople;
  if (exposed > 0) {
    return { level: "partial", reason: `Admins are covered, but ${plural(exposed, "member")} ${exposed === 1 ? "has" : "have"} no authenticator app or passkey.`, ...counts };
  }
  const noPasskey = counts.people - counts.withPasskey;
  if (noPasskey > 0) {
    return { level: "good", reason: `Everyone has a second factor; ${plural(noPasskey, "person", "people")} ${noPasskey === 1 ? "has" : "have"} no passkey yet.`, ...counts };
  }
  return { level: "secure", reason: "Everyone has a second factor and a passkey.", ...counts };
}

