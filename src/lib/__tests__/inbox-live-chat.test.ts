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
const filtersButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>("button[aria-haspopup='menu'][aria-label^='Filters']")!;
const openMenu = (el: HTMLElement) => act(async () => { filtersButton(el).click(); });
const menuItem = (el: HTMLElement, re: RegExp) => [...el.querySelectorAll<HTMLElement>("[role='menu'] [role='menuitemradio']")].find(b => re.test((b.textContent ?? "").trim()));
const pill = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label='Remove filter: ${label}']`);

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
    // Assigned to the signed-in person reads "You".
    expect(el.textContent).toMatch(/Assigned to You/);
  });

  it("quick view: All / Waiting for you / Mine, with counts, remembered for the visit", async () => {
    const el = await mount();
    await tick();
    expect(button(el, /^Waiting for you/)?.textContent).toMatch(/Waiting for you2/);
    await act(async () => { button(el, /^Mine/)!.click(); });
    expect(rows(el)).toEqual(["c2"]);
    expect(button(el, /^Mine/)?.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(sessionStorage.getItem("talko-inbox-view")!).filter).toBe("mine");
  });

  it("keeps the rarer filters, the channel and the sort in one Filters menu", async () => {
    const el = await mount();
    await tick();
    // Nothing narrowed yet: no pills, no dot on the button.
    expect(filtersButton(el).getAttribute("aria-label")).toBe("Filters");
    expect(el.querySelector("[aria-label^='Remove filter']")).toBeNull();

    await openMenu(el);
    expect(el.querySelector("[role='menu']")).toBeTruthy();
    expect(filtersButton(el).getAttribute("aria-expanded")).toBe("true");
    // Counts ride along in the menu.
    expect(menuItem(el, /^Unassigned/)?.textContent).toMatch(/Unassigned1/);
    expect(menuItem(el, /^Instagram/)?.textContent).toMatch(/Instagram1/);

    // Instagram: one chat, the menu closes, and one removable pill says so.
    await act(async () => { menuItem(el, /^Instagram/)!.click(); });
    expect(el.querySelector("[role='menu']")).toBeNull();
    expect(rows(el)).toEqual(["c2"]);
    expect(pill(el, "Instagram")).toBeTruthy();
    expect(filtersButton(el).getAttribute("aria-label")).toMatch(/some are on/);
    await act(async () => { pill(el, "Instagram")!.click(); });
    expect(rows(el)).toHaveLength(3);

    // Needs a person: no quick segment is pressed, the pill names it, and it is remembered.
    await openMenu(el);
    await act(async () => { menuItem(el, /^Needs a person/)!.click(); });
    expect(rows(el)).toEqual(["c1"]);
    expect(pill(el, "Needs a person")).toBeTruthy();
    expect(["All", "Waiting", "Mine"].map(l => button(el, new RegExp(`^${l}`))?.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
    expect(JSON.parse(sessionStorage.getItem("talko-inbox-view")!).filter).toBe("needs_person");
    await openMenu(el);
    expect(menuItem(el, /^Needs a person/)?.getAttribute("aria-checked")).toBe("true");
    // Escape closes the menu and gives focus back to the button.
    await act(async () => { el.querySelector("[role='menu']")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(el.querySelector("[role='menu']")).toBeNull();
    expect(document.activeElement).toBe(filtersButton(el));
    await act(async () => { pill(el, "Needs a person")!.click(); });
    expect(rows(el)).toHaveLength(3);
    expect(button(el, /^All/)?.getAttribute("aria-pressed")).toBe("true");

    // Unassigned and the sort live there too.
    await openMenu(el);
    await act(async () => { menuItem(el, /^Unassigned/)!.click(); });
    expect(rows(el)).toEqual(["c1"]);
    await act(async () => { pill(el, "Unassigned")!.click(); });
    await openMenu(el);
    await act(async () => { menuItem(el, /^Longest waiting/)!.click(); });
    expect(rows(el)).toEqual(["c1", "c2", "c3"]);
    expect(JSON.parse(sessionStorage.getItem("talko-inbox-view")!).sort).toBe("longest");
  });

  it("keeps old intent names working: escalated opens Needs a person", async () => {
    const el = await mount({ filter: "escalated" });
    await tick();
    expect(rows(el)).toEqual(["c1"]);
    expect(pill(el, "Needs a person")).toBeTruthy();
    await openMenu(el);
    expect(menuItem(el, /^Needs a person/)?.getAttribute("aria-checked")).toBe("true");
  });

  it("an intent for one channel shows its pill", async () => {
    const el = await mount({ platform: "instagram" });
    await tick();
    expect(rows(el)).toEqual(["c2"]);
    expect(pill(el, "Instagram")).toBeTruthy();
  });

  it("opens with filter 'waiting' from Home / the shell", async () => {
    const el = await mount({ filter: "waiting" });
    await tick();
    expect(rows(el).sort()).toEqual(["c1", "c2"]);
    expect(button(el, /^Waiting for you/)?.getAttribute("aria-pressed")).toBe("true");
    expect(el.querySelector("[aria-label^='Remove filter']")).toBeNull();
  });

  it("folds a details section away and remembers it", async () => {
    localStorage.removeItem("talko-details-open:notes");
    const el = await mount();
    await tick();
    await act(async () => { (el.querySelector("[data-id='c1']") as HTMLElement).click(); });
    await tick();
    // jsdom is phone-width: the details open as a side panel from the header.
    await act(async () => { button(el, /^Contact details$/)!.click(); });
    await tick();
    const toggle = button(document.body, /^Team notes/)!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { toggle.click(); });
    expect(button(document.body, /^Team notes/)!.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("textarea[aria-label='Add a team note']")?.closest("[hidden]")).toBeTruthy();
    expect(localStorage.getItem("talko-details-open:notes")).toBe("0");
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
