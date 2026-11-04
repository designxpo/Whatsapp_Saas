export type FollowCheckMode = "dm" | "comment";
export const followCheckMode = (value: unknown): FollowCheckMode => value === "comment" ? "comment" : "dm";

// Shared by the rule editor and webhook; no server dependencies.
export function followDmKeyword(keyword: string | null | undefined): string {
  return (keyword?.split(",").map(s => s.trim()).find(Boolean) || "LINK").slice(0, 50);
}

export function followPublicPrompt(keyword: string | null | undefined, intro?: string | null): string {
  const instruction = `Follow this account, then DM us “${followDmKeyword(keyword)}”. We'll check your follow in DMs before sending your link.`;
  // Leave room for the mandatory instruction within the public-reply limit.
  const prefix = intro?.trim().slice(0, Math.max(0, 279 - instruction.length));
  return prefix ? `${prefix} ${instruction}` : instruction;
}

export function followDmPrompt(intro?: string | null): string {
  return intro?.trim() || "Almost there! Follow this account, then tap “I’ve followed” to get your link.";
}
