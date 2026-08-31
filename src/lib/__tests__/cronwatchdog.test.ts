// The watchdog's threshold policy. Worth pinning because both failure
// directions are real: too eager and every inbound webhook spawns an engine
// run, too lax and a stalled engine stays stalled — which is the bug this whole
// module exists to fix.

import { describe, it, expect } from "vitest";
import { decideKick } from "../cronwatchdog";

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
