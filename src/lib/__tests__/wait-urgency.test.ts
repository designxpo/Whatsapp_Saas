import { describe, it, expect } from "vitest";
import { waitLevel, waitInfo, replyTarget, DEFAULT_REPLY_TARGET_MINUTES } from "../wait-urgency";
import {
  normalizeFilter, normalizeSort, isWaitingForPerson, isMine, matchesFilter, filterCounts, sortChats,
  readSavedView, saveView, INBOX_VIEW_KEY, type InboxChat,
} from "../inbox-view";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("waitLevel against the reply target", () => {
  it("is fine under half the target, soon from half, late from the target", () => {
    expect(waitLevel(0, 15)).toBe("fine");
    expect(waitLevel(7, 15)).toBe("fine");
    expect(waitLevel(7.5, 15)).toBe("soon");
    expect(waitLevel(14, 15)).toBe("soon");
    expect(waitLevel(15, 15)).toBe("late");
    expect(waitLevel(600, 15)).toBe("late");
  });
  it("uses the business's own target", () => {
    expect(waitLevel(20, 60)).toBe("fine");
    expect(waitLevel(30, 60)).toBe("soon");
    expect(waitLevel(60, 60)).toBe("late");
  });
  it("falls back to the default target for a missing or nonsense one", () => {
    expect(replyTarget(undefined)).toBe(DEFAULT_REPLY_TARGET_MINUTES);
    expect(replyTarget(0)).toBe(DEFAULT_REPLY_TARGET_MINUTES);
    expect(replyTarget(-5)).toBe(DEFAULT_REPLY_TARGET_MINUTES);
    expect(replyTarget(Number.NaN)).toBe(DEFAULT_REPLY_TARGET_MINUTES);
    expect(replyTarget(30)).toBe(30);
    expect(waitLevel(15, 0)).toBe("late");
  });
});

describe("waitInfo", () => {
  it("says the wait in words, with the level explained", () => {
    const w = waitInfo(ago(42), 15, NOW)!;
    expect(w.label).toBe("Waiting 42 min");
    expect(w.level).toBe("late");
    expect(w.explain).toBe("past your 15 min reply target");
    expect(waitInfo(ago(125), 15, NOW)!.label).toBe("Waiting 2 h 5 min");
    expect(waitInfo(ago(9), 15, NOW)!.level).toBe("soon");
    expect(waitInfo(ago(9), 15, NOW)!.explain).toMatch(/close to/);
    expect(waitInfo(ago(3), 15, NOW)!.level).toBe("fine");
  });
  it("is null with no usable time, and never negative for a clock ahead", () => {
    expect(waitInfo(null, 15, NOW)).toBeNull();
    expect(waitInfo("not a date", 15, NOW)).toBeNull();
    expect(waitInfo(new Date(NOW + 60_000).toISOString(), 15, NOW)!.minutes).toBe(0);
  });
});

const chat = (over: Partial<InboxChat> & { id: string }): InboxChat => ({
  status: "active", botEnabled: true, needsReply: false, lastInboundAt: ago(60), lastOutboundAt: null, assignedTo: null, ...over,
});

describe("filters", () => {
  it("keeps old intent names working as aliases", () => {
    expect(normalizeFilter("needs_reply")).toBe("waiting");
    expect(normalizeFilter("escalated")).toBe("needs_person");
    expect(normalizeFilter("bot_off")).toBe("ai_paused");
    expect(normalizeFilter("waiting")).toBe("waiting");
    expect(normalizeFilter("mine")).toBe("mine");
    expect(normalizeFilter("nonsense")).toBe("all");
    expect(normalizeFilter(undefined)).toBe("all");
    expect(normalizeSort("longest")).toBe("longest");
    expect(normalizeSort("x")).toBe("newest");
  });

  it("'Waiting for you' follows the alert rule (store.ts waitingForTeam)", () => {
    // The AI still has its two minutes on a fresh message.
    expect(isWaitingForPerson(chat({ id: "a", needsReply: true, lastInboundAt: ago(1) }), NOW)).toBe(false);
    expect(isWaitingForPerson(chat({ id: "a", needsReply: true, lastInboundAt: ago(3) }), NOW)).toBe(true);
    // Handed over or the AI paused: waiting from the first second.
    expect(isWaitingForPerson(chat({ id: "a", needsReply: true, lastInboundAt: ago(0), status: "escalated" }), NOW)).toBe(true);
    expect(isWaitingForPerson(chat({ id: "a", needsReply: true, lastInboundAt: ago(0), botEnabled: false }), NOW)).toBe(true);
    // Not waiting: answered, paused chats, or older than a day.
    expect(isWaitingForPerson(chat({ id: "a", needsReply: false, lastInboundAt: ago(30) }), NOW)).toBe(false);
    expect(isWaitingForPerson(chat({ id: "a", needsReply: true, status: "paused" }), NOW)).toBe(false);
    expect(isWaitingForPerson(chat({ id: "a", needsReply: true, lastInboundAt: ago(25 * 60) }), NOW)).toBe(false);
    // Anything the alerts endpoint reported (ready to pay, approvals, AI off) counts.
    expect(isWaitingForPerson(chat({ id: "z", needsReply: false }), NOW, new Set(["z"]))).toBe(true);
  });

  it("'Mine' matches the signed-in person by name or email, any case", () => {
    const me = { name: "Asha Demo", email: "asha@shop.example" };
    expect(isMine("asha demo", me)).toBe(true);
    expect(isMine("ASHA@shop.example", me)).toBe(true);
    expect(isMine("Karan", me)).toBe(false);
    expect(isMine(null, me)).toBe(false);
    expect(isMine("Asha Demo", null)).toBe(false);
  });

  it("counts every filter over one list", () => {
    const me = { name: "Asha", email: "a@x" };
    const list = [
      chat({ id: "1", needsReply: true, lastInboundAt: ago(42), status: "escalated", botEnabled: false }),
      chat({ id: "2", needsReply: true, lastInboundAt: ago(9), assignedTo: "Asha" }),
      chat({ id: "3", assignedTo: "Karan" }),
      chat({ id: "4", needsReply: true, lastInboundAt: ago(1) }),
    ];
    const counts = filterCounts(list, { now: NOW, me });
    expect(counts).toEqual({ all: 4, waiting: 2, mine: 1, unassigned: 2, needs_person: 1, ai_paused: 1 });
    expect(list.filter(c => matchesFilter(c, "unassigned", { now: NOW })).map(c => c.id)).toEqual(["1", "4"]);
  });
});

describe("sort", () => {
  const list = [
    chat({ id: "recent-answered", lastInboundAt: ago(2), lastOutboundAt: ago(1) }),
    chat({ id: "wait-9", needsReply: true, lastInboundAt: ago(9) }),
    chat({ id: "wait-42", needsReply: true, lastInboundAt: ago(42) }),
    chat({ id: "stale-3-days", needsReply: true, lastInboundAt: ago(3 * 24 * 60) }),
  ];
  it("Newest: the latest message in or out first", () => {
    expect(sortChats(list, "newest", NOW).map(c => c.id)).toEqual(["recent-answered", "wait-9", "wait-42", "stale-3-days"]);
  });
  it("Longest waiting: today's unanswered chats, oldest wait first, then the rest by recency", () => {
    expect(sortChats(list, "longest", NOW).map(c => c.id)).toEqual(["wait-42", "wait-9", "recent-answered", "stale-3-days"]);
  });
  it("does not change the list it was given", () => {
    const copy = [...list];
    sortChats(list, "longest", NOW);
    expect(list).toEqual(copy);
  });
});

describe("remembered view", () => {
  it("round-trips and survives bad or missing storage", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    saveView(s, { filter: "mine", sort: "longest" });
    expect(readSavedView(s)).toEqual({ filter: "mine", sort: "longest" });
    store.set(INBOX_VIEW_KEY, "{not json");
    expect(readSavedView(s)).toEqual({ filter: "all", sort: "newest" });
    store.set(INBOX_VIEW_KEY, JSON.stringify({ filter: "escalated" }));
    expect(readSavedView(s).filter).toBe("needs_person");
    expect(readSavedView(null)).toEqual({ filter: "all", sort: "newest" });
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readSavedView(throwing)).toEqual({ filter: "all", sort: "newest" });
    expect(() => saveView(throwing, { filter: "all", sort: "newest" })).not.toThrow();
  });
});
