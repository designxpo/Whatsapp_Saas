// @vitest-environment jsdom
// The "remaining screens" UX pass: in-page dialogs instead of the browser's
// prompt(), inline form checks, a debounced contact search, and a documents
// error that says what happened instead of "Backend not wired yet".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { bookingProblems } from "@/app/admin/_tabs/BookingsTab";
import { taskProblems } from "@/app/admin/_tabs/TodayTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/BrandContext", () => ({ useBrand: () => ({ partnerId: null, name: "Talko" }) }));
vi.mock("@/lib/vocab-client", () => ({
  useVocab: () => ({ vocab: { contact: { one: "Contact", many: "Contacts" }, lead: { one: "Lead", many: "Leads" }, sequence: { one: "Sequence", many: "Sequences" } } }),
}));

type Handler = (url: URL, init?: RequestInit) => { status?: number; body: unknown };
let routes: Record<string, Handler> = {};
const calls: { url: URL; init?: RequestInit }[] = [];

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ url, init });
    const method = (init?.method ?? "GET").toUpperCase();
    const key = Object.keys(routes).filter(k => { const [m, p] = k.split(" "); return m === method && url.pathname.startsWith(p); })
      .sort((a, b) => b.length - a.length)[0];
    const r = key ? routes[key](url, init) : { body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body } as Response;
  }) as typeof fetch;
});

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

async function mount(load: () => Promise<{ default: ComponentType<never> }>, props: Record<string, unknown> = {}) {
  const { default: Screen } = await load();
  const el = document.createElement("div"); document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(Screen, props as never)); });
  await settle();
  return el;
}
const settle = (ms = 30) => act(async () => { await new Promise(r => setTimeout(r, ms)); });
const byText = (sel: string, re: RegExp) => [...document.querySelectorAll<HTMLElement>(sel)].find(e => re.test(e.textContent ?? ""));
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("inline checks", () => {
  it("booking form names each missing field", () => {
    expect(bookingProblems({ phone: "", at: "", minutes: 30, serviceId: "" })).toEqual({ phone: expect.stringMatching(/WhatsApp number/), at: expect.stringMatching(/date and time/) });
    expect(bookingProblems({ phone: "98765", at: "2026-11-06T10:00", minutes: 30, serviceId: "" }).phone).toMatch(/too short/);
    expect(bookingProblems({ phone: "91 98765 43210", at: "2026-11-06T10:00", minutes: 2, serviceId: "" })).toEqual({ minutes: expect.any(String) });
    // A chosen service sets its own length, so the minutes box isn't checked.
    expect(bookingProblems({ phone: "91 98765 43210", at: "2026-11-06T10:00", minutes: 2, serviceId: "s1" })).toEqual({});
  });
  it("task form needs a title and a due time that hasn't passed", () => {
    const now = Date.parse("2026-11-06T12:00:00");
    expect(taskProblems({ title: " ", due: "" }, now).title).toMatch(/needs doing/);
    expect(taskProblems({ title: "Call back", due: "2026-11-01T10:00" }, now).due).toMatch(/passed/);
    expect(taskProblems({ title: "Call back", due: "2026-11-07T10:00" }, now)).toEqual({});
    expect(taskProblems({ title: "Call back", due: "" }, now)).toEqual({});
  });
});

describe("Bookings — cancelling", () => {
  it("asks for the reason in an in-page dialog and sends it", async () => {
    const promptSpy = vi.fn(() => "should not be used");
    window.prompt = promptSpy;
    const start = new Date(Date.now() + 3 * 3600_000).toISOString();
    const end = new Date(Date.now() + 4 * 3600_000).toISOString();
    routes = {
      "GET /api/admin/bookings/setup": () => ({ body: { services: [], staff: [], canManage: true, team: [], settings: { reminder: { enabled: false, hoursBefore: 3, template: null } } } }),
      "GET /api/admin/bookings": () => ({ body: { bookings: [{ id: "b1", phone: "919876500101", name: "Asha", title: "Haircut", startsAt: start, endsAt: end, status: "booked", source: "manual", channel: "whatsapp", chatKey: "919876500101", serviceName: null, staffName: null, depositCents: 0, deposit: "none", depositUrl: null, reminderSentAt: null, reminderDetail: null, notes: "", cancelReason: null }] } }),
      "PATCH /api/admin/bookings/": () => ({ body: { booking: {} } }),
    };
    await mount(() => import("@/app/admin/_tabs/BookingsTab") as never, { goTo: () => {} });

    await act(async () => { byText("button", /^Cancel$/)!.click(); });
    await settle();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/Cancel this booking\?/);
    const input = document.getElementById("prompt-dialog-input") as HTMLInputElement;
    await act(async () => { type(input, "Customer asked to reschedule"); });
    await act(async () => { byText("button", /^Cancel booking$/)!.click(); });
    await settle();

    const patch = calls.find(c => c.init?.method === "PATCH");
    expect(patch?.url.pathname).toBe("/api/admin/bookings/b1");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ status: "cancelled", cancelReason: "Customer asked to reschedule" });
  });

  it("an empty day explains itself and offers the next step", async () => {
    routes = {
      "GET /api/admin/bookings/setup": () => ({ body: { services: [], staff: [], canManage: true, team: [], settings: { reminder: { enabled: false, hoursBefore: 3, template: null } } } }),
      "GET /api/admin/bookings": () => ({ body: { bookings: [] } }),
    };
    const el = await mount(() => import("@/app/admin/_tabs/BookingsTab") as never, { goTo: () => {} });
    expect(el.textContent).toMatch(/No bookings today/);
    expect(byText("button", /Add a booking/)).toBeTruthy();
    expect(byText("button", /Connect your calendar/)).toBeTruthy();
  });
});

describe("Contacts", () => {
  beforeEach(() => {
    routes = {
      "GET /api/admin/contacts": url => ({ body: { contacts: [{ id: "c1", phone: "919876500101", name: "Asha", email: null, tags: [], status: "active", source: "inbound", createdAt: new Date().toISOString() }], total: url.searchParams.get("search") ? 1 : 40 } }),
      "GET /api/admin/batches": () => ({ body: { batches: [] } }),
      "GET /api/admin/broadcast/limits": () => ({ body: { dailyCap: 1000, sentToday: 100 } }),
    };
  });

  it("waits for typing to pause before searching, and asks once", async () => {
    const el = await mount(() => import("@/app/admin/_tabs/ContactsTab") as never, { goTo: () => {} });
    const searches = () => calls.filter(c => c.url.pathname === "/api/admin/contacts" && c.url.searchParams.get("search")).map(c => c.url.searchParams.get("search"));
    const box = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => { type(box, "A"); });
    await act(async () => { type(box, "As"); });
    await act(async () => { type(box, "Ash"); });
    await settle(120);
    expect(searches()).toEqual([]);           // still typing
    await settle(300);
    expect(searches()).toEqual(["Ash"]);      // one request, for what was finally typed
  });

  it("doesn't call the whole analytics report for today's sends", async () => {
    await mount(() => import("@/app/admin/_tabs/ContactsTab") as never, { goTo: () => {} });
    await settle(50);
    expect(calls.some(c => c.url.pathname === "/api/admin/analytics")).toBe(false);
    expect(calls.some(c => c.url.pathname === "/api/admin/broadcast/limits")).toBe(true);
  });

  it("shows placeholders, not 'No contacts yet', while the list is loading", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/admin/contacts") await gate;
      return { ok: true, status: 200, json: async () => (url.pathname === "/api/admin/contacts" ? { contacts: [], total: 0 } : {}) } as Response;
    }) as typeof fetch;
    const el = await mount(() => import("@/app/admin/_tabs/ContactsTab") as never, { goTo: () => {} });
    expect(el.textContent).not.toMatch(/No contacts yet/);
    expect(el.querySelector(".animate-pulse")).toBeTruthy();
    await act(async () => { release(); });
    await settle();
    expect(el.textContent).toMatch(/No contacts yet/);
  });

  it("pagination arrows are named and the bulk buttons say why they're off", async () => {
    const el = await mount(() => import("@/app/admin/_tabs/ContactsTab") as never, { goTo: () => {} });
    expect(el.querySelector('button[aria-label="Previous page"]')).toBeTruthy();
    expect(el.querySelector('button[aria-label="Next page"]')).toBeTruthy();
    const broadcast = byText("button", /^\s*Broadcast/)!;
    expect(broadcast.hasAttribute("disabled")).toBe(true);
    expect(broadcast.getAttribute("title")).toMatch(/Select contacts first/);
    expect(el.textContent).toMatch(/Select contacts first/);
  });
});

describe("AI Knowledge Base — documents failing to load", () => {
  it("says so plainly, offers Retry, and still lets you add a document", async () => {
    let fail = true;
    routes = {
      "GET /api/admin/kb": url => (url.pathname === "/api/admin/kb" ? (fail ? { status: 500, body: { error: "boom" } } : { body: { documents: [], botEnabled: true } }) : { body: {} }),
    };
    const el = await mount(() => import("@/app/admin/_tabs/AssistantTab") as never, { goTo: () => {} });
    expect(el.textContent).not.toMatch(/Backend not wired|AUTOMATION-PLAN|migrations/);
    expect(el.textContent).toMatch(/Couldn.t load your documents/);
    const upload = byText("label", /Upload a file/)!;
    expect(upload.className).not.toMatch(/pointer-events-none/);

    fail = false;
    await act(async () => { byText("button", /Retry/)!.click(); });
    await settle();
    expect(el.textContent).not.toMatch(/Couldn.t load your documents/);
    expect(el.textContent).toMatch(/No documents yet/);
  });
});

describe("Contacts on a phone", () => {
  it("renders each person as a card with a checkbox, name, number and source", async () => {
    routes = {
      "GET /api/admin/contacts": () => ({ body: { contacts: [{ id: "c1", phone: "919876500101", name: "Asha", email: null, tags: ["vip"], status: "active", source: "instagram", createdAt: new Date().toISOString() }], total: 1 } }),
      "GET /api/admin/batches": () => ({ body: { batches: [] } }),
    };
    const el = await mount(() => import("@/app/admin/_tabs/ContactsTab") as never, { goTo: () => {} });
    const card = el.querySelector(".md\\:hidden li");
    expect(card?.textContent).toMatch(/Asha/);
    expect(card?.textContent).toMatch(/919876500101/);
    expect(card?.textContent).toMatch(/Instagram/);
    expect(card?.querySelector('input[type="checkbox"]')?.getAttribute("aria-label")).toBe("Select Asha");
    expect(el.querySelector(".hidden.md\\:block table")).toBeTruthy();   // the table stays for md and up
  });
});

describe("Google Reviews — an unexpected answer from the server", () => {
  const ok = { reviews: [], total: 0, pageSize: 20, counts: {}, locations: [], settings: { autoMinStars: 6 } };
  for (const [label, reply] of [
    ["an empty body", { body: {} }],
    ["an {error} body", { status: 500, body: { error: "Database is waking up" } }],
    ["a 200 with only an error", { body: { error: "Database is waking up" } }],
    ["a body that isn't JSON", { body: null }],
  ] as const) {
    it(`shows the error with Try again instead of crashing (${label})`, async () => {
      let good = false;
      routes = { "GET /api/admin/reviews": url => (url.pathname === "/api/admin/reviews" ? (good ? { body: ok } : reply) : { body: {} }) };
      const crashes: unknown[] = [];
      const { default: Screen } = await import("@/app/admin/_tabs/ReviewsTab");
      const el = document.createElement("div"); document.body.appendChild(el);
      root = createRoot(el, { onUncaughtError: (e: unknown) => crashes.push(e) } as never);
      await act(async () => { root!.render(createElement(Screen as ComponentType<never>, {} as never)); });
      await settle(60);
      expect(crashes).toEqual([]);
      expect(el.textContent).toMatch(/Reviews couldn.t be loaded|Database is waking up/);
      good = true;
      await act(async () => { byText("button", /Try again/)!.click(); });
      await settle(60);
      expect(crashes).toEqual([]);
      expect(el.textContent).not.toMatch(/Reviews couldn.t be loaded|Database is waking up/);
    });
  }
});
