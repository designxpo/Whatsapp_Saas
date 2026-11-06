// @vitest-environment jsdom
// Smoke test: each of these portal screens mounts and shows its content with
// typical API answers (including empty ones and a setup-pending workspace)
// without throwing — a screen that crashes on load fails here, not in front
// of a customer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/BrandContext", () => ({ useBrand: () => ({ partnerId: null, name: "Talko" }) }));
vi.mock("@/lib/vocab-client", () => ({ useVocab: () => ({ vocab: { contact: { one: "Contact", many: "Contacts" }, lead: { one: "Lead", many: "Leads" } } }) }));

const NOW = new Date().toISOString();
const API: Record<string, unknown> = {
  "/api/admin/integration-health": { problems: [{ key: "wa:1:restricted", area: "whatsapp", severity: "critical", title: "WhatsApp number “Main” is restricted", detail: "x", since: NOW, fix: { label: "Check the number", tab: "setup" } }], checked: [{ area: "whatsapp", name: "Main", ok: false }], unmatchedPayments: [{ id: "u", provider: "razorpay", paymentKey: "pay_1", amountCents: 100, reason: "no_order", orderId: null, createdAt: NOW, candidates: [] }], deadDeliveries: 0 },
  "/api/admin/integrations": { integrations: [] },
  "/api/admin/inbound": { connections: [], googleShareEmail: null },
  "/api/admin/today": { items: [{ key: "reply:1", kind: "reply", title: "Asha", detail: "hi", person: null, action: "Reply", dueAt: NOW, overdue: true, mine: false, open: { tab: "livechat", phone: "91" } }], settings: { replyTargetMinutes: 15, alertEmails: false, alertHours: { start: 9, end: 20 }, unpaidReminder: { enabled: false, afterMinutes: 60 }, integrationEmails: true }, setupPending: false, responseTimes: null, counts: { overdue: 1, dueToday: 0, unassigned: 1, mine: 0 }, team: [], me: { id: "u1", role: "admin", canManage: true } },
  "/api/admin/results": { days: 30, revenueCents: 0, paidOrders: 0, currency: "INR", bySource: [], ads: [], broadcasts: [], social: [], aiReads: null, missed: { readyNotPaid: 0, unpaidOrders: 0, unpaidValueCents: 0 } },
  "/api/admin/bookings/setup": { services: [], staff: [], setupPending: true, canManage: true, team: [], settings: { reminder: { enabled: false, hoursBefore: 3, template: null } } },
  "/api/admin/bookings": { bookings: [], setupPending: true },
};
globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
  const u = String(url);
  const key = Object.keys(API).filter(k => u.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return { ok: true, status: 200, json: async () => (key ? API[key] : {}) } as Response;
}) as typeof fetch;

afterEach(() => { document.body.innerHTML = ""; });

async function mount(load: () => Promise<{ default: ComponentType<never> }>, props: Record<string, unknown> = {}) {
  const { default: Screen } = await load();
  const el = document.createElement("div"); document.body.appendChild(el);
  const crashes: unknown[] = [];
  const root = createRoot(el, { onUncaughtError: (e: unknown) => crashes.push(e), onRecoverableError: () => {} } as never);
  await act(async () => { root.render(createElement(Screen, props as never)); });
  await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  return { text: el.textContent ?? "", crashes };
}

describe("portal screens mount", () => {
  const goTo = () => {};
  it("Integrations, with a broken connection and a payment to check", async () => {
    const r = await mount(() => import("@/app/admin/_tabs/IntegrationsTab") as never, { goTo });
    expect(r.crashes).toEqual([]);
    expect(r.text).toMatch(/1 connection needs attention/);
    expect(r.text).toMatch(/Payments to check/);
  });
  it("Today", async () => {
    const r = await mount(() => import("@/app/admin/_tabs/TodayTab") as never, { goTo });
    expect(r.crashes).toEqual([]);
    expect(r.text).toMatch(/Customer waiting/);
  });
  it("Results with no orders yet", async () => {
    const r = await mount(() => import("@/app/admin/_tabs/ResultsTab") as never);
    expect(r.crashes).toEqual([]);
    expect(r.text).toMatch(/No paid orders in this period yet/);
  });
  it("Bookings before its setup is finished", async () => {
    const r = await mount(() => import("@/app/admin/_tabs/BookingsTab") as never, { goTo });
    expect(r.crashes).toEqual([]);
    expect(r.text).toMatch(/still being set up/);
  });
});
