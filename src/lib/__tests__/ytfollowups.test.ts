import { describe, it, expect } from "vitest";
import { mentionsHandle, pickFollowUps, threadHistory, addressTo, watchDue, pruneWatch, MAX_REPLIES_PER_THREAD } from "../ytfollowups";
import type { YtReply, YtThread } from "../youtube";

const SELF = "UC_self";
const HANDLE = "@spiritualtalksofficiall";
const NOW = new Date("2026-10-19T06:00:00Z");
const r = (id: string, by: string | null, at: string, text: string, name = `@${by}`): YtReply => ({ id, authorChannelId: by, authorName: name, publishedAt: at, text });
// The real thread from 2026-10-13: a comment, our AI reply, then the commenter
// tapping "reply" on ours — which tags the channel automatically.
const thread = (replies: YtReply[]): YtThread => ({
  id: "T1", videoId: "v1", channelId: SELF, totalReplies: replies.length,
  top: r("T1", "pearl", "2026-10-13T16:24:25Z", "But she was not originally from Bengal 😅"),
  replies,
});
const ours = r("T1.a", SELF, "2026-10-13T16:25:24Z", "That is very true! Many revered figures…", "@Spiritualtalksofficiall");
const pick = (t: YtThread, seen = "2026-10-13T16:25:24Z") => pickFollowUps(t, { selfChannelId: SELF, handle: HANDLE, seen, now: NOW }).map(x => x.id);

describe("mentionsHandle", () => {
  it("matches YouTube's auto-inserted tag: zero-width space, different case", () => {
    expect(mentionsHandle("​@Spiritualtalksofficiall It’s so beautiful", HANDLE)).toBe(true);
  });
  it("does not match a longer handle that merely starts the same", () => {
    expect(mentionsHandle("@spiritualtalksofficiallfan hi", HANDLE)).toBe(false);
  });
  it("is false without a handle", () => { expect(mentionsHandle("@x", null)).toBe(false); });
});

describe("pickFollowUps", () => {
  it("answers a reply that tags the channel after our answer (the 13 Oct thread)", () => {
    expect(pick(thread([ours, r("T1.b", "pearl", "2026-10-13T16:55:42Z", "​@Spiritualtalksofficiall It’s so beautiful how…")]))).toEqual(["T1.b"]);
  });

  it("answers the opener continuing their thread without a tag", () => {
    expect(pick(thread([ours, r("T1.b", "pearl", "2026-10-14T10:00:00Z", "thank you, tell me more")]))).toEqual(["T1.b"]);
  });

  it("anyone who tags the channel gets an answer, not just the opener", () => {
    expect(pick(thread([ours, r("T1.b", "other", "2026-10-14T10:00:00Z", "@Spiritualtalksofficiall what about Kali?")]))).toEqual(["T1.b"]);
  });

  it("stays out of viewers talking to each other", () => {
    expect(pick(thread([ours, r("T1.b", "other", "2026-10-14T10:00:00Z", "I agree with you")]))).toEqual([]);
    // …including the opener, when they are answering someone else.
    expect(pick(thread([ours, r("T1.b", "pearl", "2026-10-14T10:00:00Z", "@other no, you're wrong")]))).toEqual([]);
  });

  it("never answers in a thread the channel hasn't replied in", () => {
    expect(pick(thread([r("T1.b", "pearl", "2026-10-14T10:00:00Z", `${HANDLE} hello?`)]))).toEqual([]);
  });

  it("skips what was already read, and what we've already answered", () => {
    const b = r("T1.b", "pearl", "2026-10-14T10:00:00Z", `${HANDLE} q1`);
    expect(pick(thread([ours, b]), "2026-10-14T10:00:00Z")).toEqual([]);
    const ours2 = r("T1.c", SELF, "2026-10-14T10:05:00Z", "answer");
    expect(pick(thread([ours, b, ours2]))).toEqual([]);
  });

  it("answers a burst from one person once — their latest", () => {
    expect(pick(thread([ours,
      r("T1.b", "pearl", "2026-10-14T10:00:00Z", `${HANDLE} one`),
      r("T1.c", "pearl", "2026-10-14T10:01:00Z", `${HANDLE} two`)]))).toEqual(["T1.c"]);
  });

  it("stops at the per-thread cap, so a back-and-forth can't loop forever", () => {
    const many = Array.from({ length: MAX_REPLIES_PER_THREAD }, (_, i) => r(`T1.s${i}`, SELF, `2026-10-14T0${i}:00:00Z`, "ours"));
    expect(pick(thread([...many, r("T1.z", "pearl", "2026-10-14T09:30:00Z", `${HANDLE} again`)]))).toEqual([]);
  });

  it("ignores replies older than the watch window", () => {
    const early = r("T1.a", SELF, "2026-10-10T00:00:00Z", "ours");
    expect(pick(thread([early, r("T1.b", "pearl", "2026-10-11T10:00:00Z", `${HANDLE} old`)]), "2026-10-01T00:00:00Z")).toEqual([]);
    expect(pick(thread([early, r("T1.b", "pearl", "2026-10-13T10:00:00Z", `${HANDLE} recent`)]), "2026-10-01T00:00:00Z")).toEqual(["T1.b"]);
  });
});

describe("threadHistory / addressTo", () => {
  it("gives the AI the thread as a conversation, tags stripped, ours as assistant", () => {
    const b = r("T1.b", "pearl", "2026-10-13T16:55:42Z", "​@Spiritualtalksofficiall It’s so beautiful");
    expect(threadHistory(thread([ours, b]), SELF, b)).toEqual([
      { role: "user", body: "But she was not originally from Bengal 😅" },
      { role: "assistant", body: "That is very true! Many revered figures…" },
      { role: "user", body: "It’s so beautiful" },
    ]);
  });
  it("addresses the reply to its author, once", () => {
    expect(addressTo("@pearlsingh1698", "Jai Mata Di")).toBe("@pearlsingh1698 Jai Mata Di");
    expect(addressTo("@pearlsingh1698", "@pearlsingh1698 Jai")).toBe("@pearlsingh1698 Jai");
    expect(addressTo("Pearl", "Jai")).toBe("Jai");
  });
});

describe("watch cadence", () => {
  const w = (active: string, checkedAt?: string) => ({ checkedAt, threads: { T1: { seen: active, active } } });
  it("checks lively threads every tick, quiet ones every 15 minutes", () => {
    expect(watchDue(w("2026-10-19T05:30:00Z", "2026-10-19T05:59:00Z"), NOW)).toBe(true);
    expect(watchDue(w("2026-10-18T00:00:00Z", "2026-10-19T05:50:00Z"), NOW)).toBe(false);
    expect(watchDue(w("2026-10-18T00:00:00Z", "2026-10-19T05:40:00Z"), NOW)).toBe(true);
    expect(watchDue({ threads: {} }, NOW)).toBe(false);
  });
  it("forgets threads quiet for a week", () => {
    expect(Object.keys(pruneWatch(w("2026-10-11T00:00:00Z"), NOW).threads)).toEqual([]);
    expect(Object.keys(pruneWatch(w("2026-10-15T00:00:00Z"), NOW).threads)).toEqual(["T1"]);
  });
});
