// @vitest-environment jsdom
// Live Chat inbox, as an agent sees it: placeholders (never "No conversations
// yet") while the list loads, an error with Retry when it fails, waits said in
// words, the new filters (with the old intent names still working), and a
// reply that shows at once and is never lost when sending fails.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/lib/vocab-client", () => ({
  useVocab: () => ({ vocab: { contact: { one: "Contact", many: "Contacts" }, lead: { one: "Lead", many: "Leads" }, pipeline: { one: "Pipeline", many: "Pipelines" }, teamMember: { one: "Agent", many: "Agents" } } }),
}));

const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const CONVOS = [
  { id: "c1", phone: "919810000001", name: "Priya Sharma", status: "escalated", botEnabled: false, lastMessage: "Charged twice", lastInboundAt: ago(42), lastOutboundAt: ago(60), needsReply: true, assignedTo: null, platform: "whatsapp" },
  { id: "c2", phone: "919810000002", name: "Rahul Verma", status: "active", botEnabled: true, lastMessage: "Saturday 4pm?", lastInboundAt: ago(9), lastOutboundAt: ago(12), needsReply: true, assignedTo: "Asha Demo", platform: "instagram" },
  { id: "c3", phone: "919810000003", name: "Neha Gupta", status: "active", botEnabled: true, lastMessage: "Thank you!", lastInboundAt: ago(180), lastOutboundAt: ago(178), needsReply: false, assignedTo: "Karan", platform: "whatsapp" },
];

type Handler = (url: string, init?: RequestInit) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown };
let routes: Record<string, Handler>;
const calls: string[] = [];
beforeEach(() => {
  calls.length = 0;
  try { sessionStorage.clear(); } catch { /* none */ }
  routes = {
    "GET /api/admin/conversations/": () => ({ status: 200, body: { conversation: CONVOS[0], messages: [{ id: "m1", role: "user", body: "Charged twice", source: "inbound", createdAt: ago(42) }], ownerHistory: [], batches: [] } }),
    "GET /api/admin/conversations": () => ({ status: 200, body: { conversations: CONVOS, stages: {}, scopedToTeam: null } }),
    "GET /api/admin/me": () => ({ status: 200, body: { user: { name: "Asha Demo", email: "asha@demo.example" } } }),
    "GET /api/admin/today": () => ({ status: 200, body: { settings: { replyTargetMinutes: 15 } } }),
    "GET /api/admin/inbox/waiting": () => ({ status: 200, body: { count: 2, chats: [{ id: "c1" }, { id: "c2" }] } }),
  };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input).split("?")[0];
    const key = `${(init?.method ?? "GET").toUpperCase()} ${u}`;
    calls.push(key);
    const match = Object.keys(routes).filter(k => key === k || (k.endsWith("/") && key.startsWith(k))).sort((a, b) => b.length - a.length)[0];
    const r = match ? await routes[match](u, init) : { status: 200, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;
});

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

const tick = (ms = 30) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
async function mount(intent: Record<string, unknown> | null = null) {
  const { default: LiveChatTab } = await import("@/app/admin/_tabs/LiveChatTab");
  const el = document.createElement("div"); document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(LiveChatTab, { goTo: () => {}, intent: intent as never, clearIntent: () => {} })); });
  return el;
}
const button = (el: HTMLElement, re: RegExp) => [...el.querySelectorAll("button")].find(b => re.test((b.textContent ?? "").trim()) || re.test(b.getAttribute("aria-label") ?? ""));
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("[data-inbox-row]")].map(r => r.dataset.id);
const group = (el: HTMLElement, label: string) => el.querySelector<HTMLElement>(`[role='group'][aria-label='${label}']`)!;
const inGroup = (el: HTMLElement, label: string, re: RegExp) => [...group(el, label).querySelectorAll("button")].find(b => re.test((b.textContent ?? "").trim()));
const choose = (el: HTMLElement, ariaLabel: string, value: string) => act(async () => {
  const sel = el.querySelector<HTMLSelectElement>(`select[aria-label='${ariaLabel}']`)!;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, value);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});

describe("Live Chat inbox", () => {
  it("shows placeholders, not 'No conversations yet', until the list arrives", async () => {
    let release!: () => void;
    routes["GET /api/admin/conversations"] = () => new Promise(r => { release = () => r({ status: 200, body: { conversations: CONVOS, stages: {} } }); });
    const el = await mount();
    expect(el.textContent).toMatch(/Loading conversations/);
    expect(el.textContent).not.toMatch(/No conversations yet/);
    await act(async () => { release(); });
    await tick();
    expect(rows(el)).toEqual(["c2", "c1", "c3"]);
  });

  it("says how long each customer has waited, in words, against the reply target", async () => {
    const el = await mount();
    await tick();
    expect(el.textContent).toMatch(/Waiting 42 min/);
    expect(el.textContent).toMatch(/past your 15 min reply target/);
    expect(el.textContent).toMatch(/Waiting 9 min/);
    expect(el.textContent).toMatch(/close to your 15 min reply target/);
    expect(el.textContent).toMatch(/Needs a person/);
    expect(el.textContent).toMatch(/AI paused/);
    expect(el.textContent).not.toMatch(/ESCALATED|BOT OFF/);
    // Assigned to the signed-in person reads "@You".
    expect(el.textContent).toMatch(/Assigned to @You/);
  });

  it("shows the filters like yesterday: chips for All / Waiting / Mine / Needs a person, remembered for the visit", async () => {
    const el = await mount();
    await tick();
    // Waiting carries its count; screen readers hear the full name.
    expect(inGroup(el, "Show", /^Waiting/)?.textContent).toMatch(/Waiting \(Waiting for you\)2/);
    await act(async () => { inGroup(el, "Show", /^Mine/)!.click(); });
    expect(rows(el)).toEqual(["c2"]);
    expect(inGroup(el, "Show", /^Mine/)?.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(sessionStorage.getItem("talko-inbox-view")!).filter).toBe("mine");
    await act(async () => { inGroup(el, "Show", /^Needs a person/)!.click(); });
    expect(rows(el)).toEqual(["c1"]);
    expect(JSON.parse(sessionStorage.getItem("talko-inbox-view")!).filter).toBe("needs_person");
    await act(async () => { inGroup(el, "Show", /^All/)!.click(); });
    expect(rows(el)).toHaveLength(3);
  });

  it("filters by channel in the channel box, and keeps the rarer filters and the sort in two small selects", async () => {
    const el = await mount();
    await tick();
    expect(inGroup(el, "Channel", /^Instagram/)?.textContent).toMatch(/Instagram 1/);
    await act(async () => { inGroup(el, "Channel", /^Instagram/)!.click(); });
    expect(rows(el)).toEqual(["c2"]);
    expect(inGroup(el, "Channel", /^Instagram/)?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { inGroup(el, "Channel", /^All/)!.click(); });
    expect(rows(el)).toHaveLength(3);

    // Unassigned (and AI paused) live in "More filters", with counts; no chip is pressed then.
    expect(el.querySelector("select[aria-label='More filters']")?.textContent).toMatch(/Unassigned \(1\)/);
    await choose(el, "More filters", "unassigned");
    expect(rows(el)).toEqual(["c1"]);
    expect(["All", "Waiting", "Mine", "Needs a person"].map(l => inGroup(el, "Show", new RegExp(`^${l}`))?.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false"]);
    await choose(el, "More filters", "");
    expect(rows(el)).toHaveLength(3);

    await choose(el, "Sort chats", "longest");
    expect(rows(el)).toEqual(["c1", "c2", "c3"]);
    expect(JSON.parse(sessionStorage.getItem("talko-inbox-view")!).sort).toBe("longest");
  });

  it("keeps old intent names working: escalated opens Needs a person", async () => {
    const el = await mount({ filter: "escalated" });
    await tick();
    expect(rows(el)).toEqual(["c1"]);
    expect(inGroup(el, "Show", /^Needs a person/)?.getAttribute("aria-pressed")).toBe("true");
  });

  it("an intent for one channel selects it in the channel box", async () => {
    const el = await mount({ platform: "instagram" });
    await tick();
    expect(rows(el)).toEqual(["c2"]);
    expect(inGroup(el, "Channel", /^Instagram/)?.getAttribute("aria-pressed")).toBe("true");
  });

  it("opens with filter 'waiting' from Home / the shell", async () => {
    const el = await mount({ filter: "waiting" });
    await tick();
    expect(rows(el).sort()).toEqual(["c1", "c2"]);
    expect(inGroup(el, "Show", /^Waiting/)?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the contact details as labelled sections, all open", async () => {
    const el = await mount();
    await tick();
    await act(async () => { (el.querySelector("[data-id='c1']") as HTMLElement).click(); });
    await tick();
    // jsdom is phone-width: the details open as a side panel from the header.
    await act(async () => { button(el, /^Contact details$/)!.click(); });
    await tick();
    const headings = [...document.querySelectorAll("section[aria-labelledby^='details-'] h3")].map(h => h.textContent?.trim());
    expect(headings).toEqual(expect.arrayContaining(["Labels", "Team notes", "Assigned to"]));
    const notes = document.querySelector("textarea[aria-label='Add a team note']");
    expect(notes).toBeTruthy();
    expect(notes?.closest("[hidden]")).toBeNull();
  });

  it("shows an error with Retry when the list fails, and recovers", async () => {
    routes["GET /api/admin/conversations"] = () => ({ status: 500, body: {} });
    const el = await mount();
    await tick();
    expect(el.textContent).toMatch(/Couldn't load your chats/);
    expect(el.textContent).not.toMatch(/No conversations yet/);
    routes["GET /api/admin/conversations"] = () => ({ status: 200, body: { conversations: CONVOS, stages: {} } });
    await act(async () => { button(el, /^Retry$/)!.click(); });
    await tick();
    expect(rows(el)).toHaveLength(3);
  });

  it("fetches the composer's lists once per inbox, not once per opened chat", async () => {
    const el = await mount();
    await tick();
    await act(async () => { (el.querySelector("[data-id='c1']") as HTMLElement).click(); });
    await tick();
    await act(async () => { (el.querySelector("[data-id='c2']") as HTMLElement).click(); });
    await tick();
    for (const path of ["/api/admin/quick-replies", "/api/admin/team/members", "/api/admin/canned", "/api/admin/ai/agents", "/api/admin/ai/prompts", "/api/admin/batches"]) {
      expect(calls.filter(c => c === `GET ${path}`)).toHaveLength(1);
    }
  });

  it("shows a reply at once as Sending…, and keeps it as Not sent with Retry when sending fails", async () => {
    routes["POST /api/admin/conversations/"] = () => ({ status: 502, body: { error: "WhatsApp is not connected" } });
    const el = await mount();
    await tick();
    await act(async () => { (el.querySelector("[data-id='c1']") as HTMLElement).click(); });
    await tick();
    const box = el.querySelector("textarea[aria-label='Reply']") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setValue.call(box, "We will refund you today"); box.dispatchEvent(new Event("input", { bubbles: true })); });
    let resolvePost!: () => void;
    routes["POST /api/admin/conversations/"] = () => new Promise(r => { resolvePost = () => r({ status: 502, body: { error: "WhatsApp is not connected" } }); });
    await act(async () => { button(el, /Send reply/)!.click(); });
    expect(el.textContent).toMatch(/We will refund you today/);
    expect(el.textContent).toMatch(/Sending…/);
    await act(async () => { resolvePost(); });
    await tick();
    expect(el.textContent).toMatch(/Not sent/);
    expect(button(el, /^Retry$/)).toBeTruthy();
    // Edit puts the text back in the box.
    await act(async () => { button(el, /^Edit$/)!.click(); });
    expect((el.querySelector("textarea[aria-label='Reply']") as HTMLTextAreaElement).value).toBe("We will refund you today");
  });
});
