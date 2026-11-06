// The platform owner's address (env ADMIN_USER) is reserved.
//
// verifySession grants owner powers to any session whose email equals
// ADMIN_USER, so an ordinary account created with that address — a team
// member, a signup, an affiliate, a partner's staff — would be one sign-in away
// from the whole platform. Every path that creates an account (or changes an
// account's email) refuses it.
//
// The refusal is deliberately neutral: saying WHY the address can't be used
// would tell a stranger which address the platform owner signs in with.
//
// Kept free of auth.ts imports so it can be checked (and tested) anywhere.

export const RESERVED_EMAIL_MESSAGE = "This email can't be used. Please use a different email address.";

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** Is this the platform owner's address? Case-insensitive, whitespace-trimmed. */
export function isReservedEmail(email: string | null | undefined): boolean {
  const owner = norm(process.env.ADMIN_USER);
  const e = norm(email);
  return !!owner && !!e && e === owner;
}
