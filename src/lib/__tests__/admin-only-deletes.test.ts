// Deleting an approved WhatsApp template at Meta, and taking someone OFF the
// Do Not Contact list (messaging a person who said stop), are admin-only. A
// member or team lead gets 403 before anything at Meta or in the database is
// touched; an admin gets through. Adding to the opt-out list stays open.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: null as { email: string; role: string } | null,
  touched: [] as string[],
}));

vi.mock("@/lib/auth", async () => {
  const { NextResponse } = await import("next/server");
  return {
    currentUser: async () => h.user,
    currentTenantId: async () => (h.user ? "00000000-0000-0000-0000-00000000000a" : null),
    requireRoleAdmin: async () => h.user?.role === "admin",
    noSession: () => NextResponse.json({ error: "Your session has ended. Sign in again." }, { status: 401 }),
    DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000001",
  };
});
vi.mock("@/lib/store", () => ({
  listOptouts: async () => { h.touched.push("store.listOptouts"); return []; },
  addOptout: async () => { h.touched.push("store.addOptout"); },
  removeOptout: async () => { h.touched.push("store.removeOptout"); },
}));
vi.mock("@/lib/team", () => ({ logActivity: () => {} }));
vi.mock("@/lib/channels", () => ({
  credsFor: async () => { h.touched.push("channels.credsFor"); return { id: "c1" }; },
  explicitDefaultChannel: async () => { h.touched.push("channels.default"); return "c1"; },
}));
vi.mock("@/lib/whatsapp", () => ({
  fetchTemplates: async () => [], createTemplate: async () => ({ success: true }), editTemplate: async () => ({ success: true }),
  deleteTemplate: async () => { h.touched.push("whatsapp.deleteTemplate"); return { success: true }; },
  EDITABLE_TEMPLATE_STATUSES: ["APPROVED", "REJECTED", "PAUSED"],
}));
vi.mock("@/lib/links", () => ({
  setTemplateMeta: async () => {}, getTrackedUrls: async () => [], siteUrl: () => "https://x", trackingOrigin: () => "https://x",
}));

import { DELETE as deleteTemplate } from "../../app/api/admin/templates/route";
import { DELETE as deleteOptout, POST as addOptout } from "../../app/api/admin/optouts/route";

const json = (body: unknown, method = "DELETE") =>
  new Request("http://x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => { h.touched.length = 0; h.user = null; });

describe.each([
  ["template DELETE", () => deleteTemplate(json({ name: "order_update" })), "whatsapp.deleteTemplate"],
  ["opt-out DELETE", () => deleteOptout(json({ phone: "919800000001" })), "store.removeOptout"],
])("%s", (_label, call, sideEffect) => {
  for (const role of ["member", "lead"]) {
    it(`refuses a ${role} with 403 and touches nothing`, async () => {
      h.user = { email: `${role}@acme.test`, role };
      const res = await call();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Admins only" });
      expect(h.touched).toEqual([]);
    });
  }

  it("refuses a signed-out caller", async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.touched).toEqual([]);
  });

  it("lets an admin through", async () => {
    h.user = { email: "admin@acme.test", role: "admin" };
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.touched).toContain(sideEffect);
  });
});

describe("opt-out POST (suppressing) stays open to members", () => {
  it("a member can still add someone to the Do Not Contact list", async () => {
    h.user = { email: "member@acme.test", role: "member" };
    const res = await addOptout(json({ phone: "919800000001" }, "POST"));
    expect(res.status).toBe(200);
    expect(h.touched).toEqual(["store.addOptout"]);
  });
});
