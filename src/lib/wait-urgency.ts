// How late a customer's reply is, judged against the business's own reply
// target (Today settings, `replyTargetMinutes`). Pure, so the inbox row, the
// open chat and any other screen agree on what "late" means.
//
//   fine — under half the target: nothing to flag yet
//   soon — half the target or more: worth picking up next
//   late — the target has passed
//
// The level always travels with words ("Waiting 42 min", "past your 15 min
// reply target"), so a screen never says it with colour alone.

import { fmtWait } from "./format";

export type WaitLevel = "fine" | "soon" | "late";

/** Used when a business hasn't set a reply target (Today settings default). */
export const DEFAULT_REPLY_TARGET_MINUTES = 15;

/** A usable target in minutes: a positive number, else the default. */
export function replyTarget(minutes: unknown): number {
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_REPLY_TARGET_MINUTES;
}

/** The level for a wait of `waitedMinutes` against `targetMinutes`. */
export function waitLevel(waitedMinutes: number, targetMinutes: number = DEFAULT_REPLY_TARGET_MINUTES): WaitLevel {
  const target = replyTarget(targetMinutes);
  if (!Number.isFinite(waitedMinutes) || waitedMinutes < target / 2) return "fine";
  return waitedMinutes >= target ? "late" : "soon";
}

export interface WaitInfo {
  minutes: number;
  level: WaitLevel;
  /** "Waiting 42 min" — the visible text. */
  label: string;
  /** The level in words for screen readers and tooltips. */
  explain: string;
}

/** Everything a screen shows for a customer waiting since `sinceIso`; null when there's no time. */
export function waitInfo(sinceIso: string | null | undefined, targetMinutes: number = DEFAULT_REPLY_TARGET_MINUTES, now: number = Date.now()): WaitInfo | null {
  if (!sinceIso) return null;
  const t = Date.parse(sinceIso);
  if (Number.isNaN(t)) return null;
  const target = replyTarget(targetMinutes);
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  const level = waitLevel(minutes, target);
  const explain = level === "late" ? `past your ${target} min reply target`
    : level === "soon" ? `close to your ${target} min reply target`
    : `within your ${target} min reply target`;
  return { minutes, level, label: `Waiting ${fmtWait(sinceIso, now)}`, explain };
}
