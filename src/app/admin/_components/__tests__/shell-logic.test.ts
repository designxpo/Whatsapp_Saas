import { describe, expect, it } from "vitest";
import type { Entitlements, FeatureKey } from "@/lib/entitlement-registry";
import { FEATURE_KEYS } from "@/lib/entitlement-registry";
import {
  attentionLabels, badgeText, chooseNextAction, dueWords, filterPalette, navItemState, paletteEntries, personName,
  setupProgress, trendOf, weekNumbers, TAB_TITLES, type PaletteContext, type TodayItemLike, type WaitingLike,
} from "../shell-logic";
import { bellLabel } from "@/components/alerts-bell";

function ent(off: FeatureKey[] = [], enforcing = true): Entitlements {
  const features = Object.fromEntries(FEATURE_KEYS.map(k => [k, !off.includes(k)])) as Record<FeatureKey, boolean>;
  return { features, limits: { contacts: 0, conversations_per_month: 0, messages_per_month: 0, channels: 0, team_seats: 0 }, plan: "growth", status: "active", paymentStatus: "active", trialEndsAt: null, enforcing, grandfathered: false };
}
const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({ ent: ent(), role: "admin", loaded: true, label: t => TAB_TITLES[t], ...over });
const ids = (c: PaletteContext) => paletteEntries(c).map(e => e.id);

describe("menu visibility", () => {
  it("holds gated items as placeholders until /api/admin/me answers", () => {
    expect(navItemState("home", null, undefined, false)).toBe("show");
    expect(navItemState("growth", null, undefined, false)).toBe("pending");   // admin-only
    expect(navItemState("team", null, undefined, false)).toBe("pending");     // lead/admin
    expect(navItemState("instagram", null, undefined, false)).toBe("pending"); // plan feature
    expect(navItemState("whatsapp", null, undefined, false)).toBe("pending");
  });
  it("applies role and plan once loaded", () => {
    expect(navItemState("growth", ent(), "member", true)).toBe("hide");
    expect(navItemState("growth", ent(), "admin", true)).toBe("show");
    expect(navItemState("team", ent(), "lead", true)).toBe("show");
    expect(navItemState("instagram", ent(["ch_instagram"]), "admin", true)).toBe("hide");
    expect(navItemState("instagram", ent(["ch_instagram"], false), "admin", true)).toBe("show");
  });
  it("shows the WhatsApp shortcut to admins on a plan with WhatsApp", () => {
    expect(navItemState("whatsapp", ent(), "admin", true)).toBe("show");
    expect(navItemState("whatsapp", ent(), "member", true)).toBe("hide");
    expect(navItemState("whatsapp", ent(["ch_whatsapp"]), "admin", true)).toBe("hide");
  });
});

describe("search (command palette)", () => {
  it("offers only what this person may open", () => {
    const member = ids(ctx({ role: "member" }));
    expect(member).toContain("tab:livechat");
    expect(member).not.toContain("tab:growth");
    expect(member).not.toContain("tab:results");
    expect(member).not.toContain("nav:whatsapp");
    expect(member).toContain("settings:general");
    expect(member).not.toContain("settings:team");
    const admin = ids(ctx());
    expect(admin).toEqual(expect.arrayContaining(["tab:growth", "tab:results", "tab:today", "nav:whatsapp", "settings:team", "act:broadcast", "act:import", "act:knowledge", "act:waiting"]));
  });
  it("drops screens the plan doesn't include", () => {
    const list = ids(ctx({ ent: ent(["broadcasts", "flows"]) }));
    expect(list).not.toContain("tab:broadcast");
    expect(list).not.toContain("act:broadcast");
    expect(list).not.toContain("tab:templates");
    expect(list).not.toContain("tab:flows");
  });
  it("offers nothing gated before the person is known", () => {
    const list = ids(ctx({ ent: null, role: undefined, loaded: false }));
    expect(list).toContain("tab:livechat");
    expect(list).not.toContain("tab:broadcast");
    expect(list).not.toContain("settings:team");
  });
  it("lists each destination once (WhatsApp shortcut = Settings › WhatsApp numbers)", () => {
    const list = paletteEntries(ctx());
    expect(list.filter(e => e.tab === "settings" && e.section === "numbers")).toHaveLength(1);
    expect(new Set(list.map(e => e.id)).size).toBe(list.length);
  });
  it("uses the workspace's own words", () => {
    const list = paletteEntries(ctx({ label: t => (t === "contacts" ? "Students" : TAB_TITLES[t]) }));
    expect(list.find(e => e.id === "act:import")?.label).toBe("Import students");
    expect(list.find(e => e.id === "tab:contacts")?.label).toBe("Students");
  });
  it("ranks label-start matches first and needs every word to match", () => {
    const list = paletteEntries(ctx());
    expect(filterPalette(list, "temp")[0].id).toBe("tab:templates");
    expect(filterPalette(list, "team")[0].label).toMatch(/^Team|Settings › Team/);
    expect(filterPalette(list, "settings team").map(e => e.id)).toContain("settings:team");
    expect(filterPalette(list, "zzzz")).toEqual([]);
    expect(filterPalette(list, "  ")).toBe(list);
    // Matches on hidden keywords too, ranked after label hits.
    const csv = filterPalette(list, "csv");
    expect(csv[0].id).toBe("act:import");
  });
});

describe("one number per badge", () => {
  it("names counts in words", () => {
    expect(attentionLabels({ waiting: 3, overdue: 1 })).toEqual({ waiting: "3 waiting for you", overdue: "1 overdue" });
    expect(bellLabel(3, 0)).toBe("3 notifications");
    expect(bellLabel(1, 0)).toBe("1 notification");
    expect(bellLabel(2, 1)).toBe("3 notifications");
    expect(bellLabel(0, 0)).toBe("Notifications");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(120)).toBe("99+");
  });
});

describe("Home's next step", () => {
  const now = Date.parse("2026-11-06T10:00:00Z");
  const min = (m: number) => new Date(now - m * 60_000).toISOString();
  const chat = (id: string, name: string, m: number): WaitingLike => ({ id, name, phone: `9198${id}`, lastInboundAt: min(m), reason: "unanswered" });
  const item = (key: string, over: Partial<TodayItemLike> = {}): TodayItemLike => ({ key, kind: "task", title: `Task ${key}`, person: null, action: "Do it", dueAt: min(-30), overdue: false, open: { tab: "today" }, ...over });

  it("puts the customer who has waited longest first", () => {
    const next = chooseNextAction({ waiting: [chat("1", "Rahul", 9), chat("2", "Priya Sharma", 42)], today: [item("a", { overdue: true, dueAt: min(10) })], now });
    expect(next?.kind).toBe("reply");
    expect(next?.label).toBe("Reply to Priya Sharma · waiting 42 min");
  });
  it("then the most overdue Today item, then the next one due", () => {
    const overdue = chooseNextAction({ waiting: [], today: [item("a"), item("b", { overdue: true, dueAt: min(5) }), item("c", { overdue: true, dueAt: min(50), title: "Call back Meera", action: "Call" })], now });
    expect(overdue).toMatchObject({ kind: "today", urgent: true, label: "Call · Call back Meera" });
    const later = chooseNextAction({ waiting: [], today: [item("a", { dueAt: min(-90) }), item("b", { dueAt: min(-20) })], now });
    expect(later).toMatchObject({ kind: "today", urgent: false });
    expect(later?.kind === "today" && later.item.key).toBe("b");
  });
  it("then unfinished setup, and nothing when all caught up", () => {
    const step = { key: "whatsapp", title: "Connect WhatsApp", status: "todo" as const, fixTab: "settings" };
    expect(chooseNextAction({ waiting: [], today: [], setupNext: step, now })).toMatchObject({ kind: "setup", label: "Finish setup: Connect WhatsApp" });
    expect(chooseNextAction({ waiting: [], today: [], setupNext: null, now })).toBeNull();
  });
  it("never shows a raw web-chat id as a name", () => {
    expect(personName("", "web_8f2a")).toBe("a customer");
    expect(personName(null, "919810000001")).toBe("…0001");
    expect(personName(" Neha ", "x")).toBe("Neha");
  });
  it("says when things are due in words", () => {
    expect(dueWords(min(125), true, now)).toBe("2 h 5 min overdue");
    expect(dueWords(min(-20), false, now)).toBe("Due in 20 min");
    expect(dueWords(null, false, now)).toBe("No due date");
  });
});

describe("setup progress", () => {
  it("counts required steps only and names the next one", () => {
    const p = setupProgress([
      { key: "a", title: "AI", status: "ok" }, { key: "b", title: "WhatsApp", status: "todo" },
      { key: "c", title: "CRM", status: "todo", optional: true }, { key: "d", title: "Knowledge", status: "warn" },
    ]);
    expect(p).toMatchObject({ done: 1, total: 3, complete: false });
    expect(p.next?.title).toBe("WhatsApp");
    expect(setupProgress([{ key: "a", title: "AI", status: "ok" }]).complete).toBe(true);
    expect(setupProgress(null)).toMatchObject({ total: 0, complete: false });
  });
});

describe("key numbers against the week before", () => {
  it("describes change in words with a direction", () => {
    expect(trendOf(110, 100)).toMatchObject({ dir: "up", words: "Up 10% vs previous 7 days" });
    expect(trendOf(50, 100)).toMatchObject({ dir: "down", words: "Down 50% vs previous 7 days" });
    expect(trendOf(5, 5).dir).toBe("same");
    expect(trendOf(4, 0).dir).toBe("new");
    expect(trendOf(0, 0).dir).toBe("none");
  });
  it("takes the previous week as the 14-day total minus the last 7", () => {
    const a7 = { contacts: { newInRange: 30 }, messaging: { totals: { sent: 100 }, repliedInRange: 60, aiRepliesInRange: 40 } };
    const a14 = { contacts: { newInRange: 50 }, messaging: { totals: { sent: 300 }, repliedInRange: 60, aiRepliesInRange: 70 } };
    const rows = weekNumbers(a7, a14, "Students");
    expect(rows.map(r => [r.key, r.current, r.previous])).toEqual([["contacts", 30, 20], ["inbound", 60, 0], ["ai", 40, 30], ["sent", 100, 200]]);
    expect(rows[0].label).toBe("New students");
    expect(rows[3].trend.dir).toBe("down");
  });
});
