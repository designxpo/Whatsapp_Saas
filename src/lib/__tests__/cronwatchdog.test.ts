// The watchdog's threshold policy. Worth pinning because both failure
// directions are real: too eager and every inbound webhook spawns an engine
// run, too lax and a stalled engine stays stalled — which is the bug this whole
// module exists to fix.

import { describe, it, expect } from "vitest";
import { decideAlert, decideKick } from "../cronwatchdog";

describe("decideKick", () => {
  it("does nothing on a fresh heartbeat", () => {
    expect(decideKick(0, null)).toBe("fresh");
    expect(decideKick(4, null)).toBe("fresh");     // a normal */5 tick
    expect(decideKick(11.9, null)).toBe("fresh");  // one missed tick — still not a stall
  });

  it("treats a never-written heartbeat as fresh, not as a stall", () => {
    // A brand-new deployment has never ticked and has nothing queued. Kicking
    // here would fire the engine on the very first request to ever arrive.
    expect(decideKick(null, null)).toBe("fresh");
    expect(decideKick(null, 99)).toBe("fresh");
  });

  it("kicks once the heartbeat is two missed ticks old", () => {
    expect(decideKick(12, null)).toBe("kick");
    expect(decideKick(55, null)).toBe("kick");     // the real observed stall
    expect(decideKick(6 * 60, null)).toBe("kick"); // the 6-hour GitHub gaps
  });

  it("kicks below the status page's own 'operational' ceiling", () => {
    // publicstatus.ts calls anything under 20 minutes operational. Healing has
    // to start BEFORE that, or the dashboard goes amber before we react.
    expect(decideKick(13, null)).toBe("kick");
  });

  it("throttles a burst so a busy webhook moment produces one kick, not fifty", () => {
    expect(decideKick(60, 0)).toBe("throttled");
    expect(decideKick(60, 2.9)).toBe("throttled");
  });

  it("allows another kick once the throttle window passes and it's still stalled", () => {
    expect(decideKick(60, 3)).toBe("kick");
    expect(decideKick(60, 30)).toBe("kick");
  });

  it("never kicks a fresh engine even if the throttle window is wide open", () => {
    expect(decideKick(2, 999)).toBe("fresh");
  });
});

// ── When a stall is worth waking a human for ─────────────────────────────────
// The original rule was simply "heartbeat older than 45 minutes", and on a
// quiet fleet that produced an alert every six hours for days about an engine
// that was fine. The watchdog runs on inbound traffic, so the first request
// after a quiet night legitimately finds a 50-minute-old heartbeat — and under
// the old rule that request both kicked the engine AND emailed the owner to say
// it was down. Accurate about the number, wrong about the situation, and
// repeated often enough to train the reader to ignore it.
describe("decideAlert", () => {
  const NEVER_ALERTED = null;

  it("stays quiet below the alert threshold", () => {
    expect(decideAlert(10, 30, NEVER_ALERTED)).toBe(false);
    expect(decideAlert(44.9, 60, NEVER_ALERTED)).toBe(false);
  });

  it("never alerts on a first sighting — that request is about to fix it", () => {
    // The exact false alarm that was arriving every six hours: quiet fleet, no
    // traffic overnight, first request of the morning sees a 50-minute-old
    // heartbeat. It kicks the engine. It must not also send mail.
    expect(decideAlert(50, null, NEVER_ALERTED)).toBe(false);
    expect(decideAlert(6 * 60, null, NEVER_ALERTED)).toBe(false);
  });

  it("does not judge a kick that hasn't had time to land", () => {
    // Kicked 2 minutes ago; the engine's run takes longer than that.
    expect(decideAlert(50, 2, NEVER_ALERTED)).toBe(false);
    expect(decideAlert(50, 4.9, NEVER_ALERTED)).toBe(false);
  });

  it("stays quiet when the kick worked", () => {
    // Heartbeat NEWER than the kick means the engine ticked in response.
    // Kicked 40 minutes ago, heartbeat 8 minutes old — it is running.
    expect(decideAlert(8, 40, NEVER_ALERTED)).toBe(false);
    // Even at a stale-looking 50 minutes: if the kick was 55 minutes ago, the
    // heartbeat still postdates it, so something did respond.
    expect(decideAlert(50, 55, NEVER_ALERTED)).toBe(false);
  });

  it("alerts when a kick was given time and the engine never responded", () => {
    // Kicked 10 minutes ago; heartbeat is 50 minutes old, so it predates the
    // kick entirely. No amount of further traffic will fix this one.
    expect(decideAlert(50, 10, NEVER_ALERTED)).toBe(true);
    expect(decideAlert(6 * 60, 30, NEVER_ALERTED)).toBe(true);
  });

  it("throttles a genuine outage to one message per six hours", () => {
    expect(decideAlert(50, 10, 0)).toBe(false);
    expect(decideAlert(50, 10, 5 * 60)).toBe(false);
    expect(decideAlert(50, 10, 6 * 60)).toBe(true);
    expect(decideAlert(50, 10, 24 * 60)).toBe(true);
  });

  it("the kick and alert decisions stay independent", () => {
    // A first sighting kicks but does not alert — the two must not be wired to
    // the same condition, which is how the false alarms happened.
    expect(decideKick(50, null)).toBe("kick");
    expect(decideAlert(50, null, NEVER_ALERTED)).toBe(false);
  });
});
