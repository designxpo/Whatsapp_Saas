// Private team notes on a conversation (migration 20261030120000). What must hold:
//  - a note can never reach the customer, the AI or the CRM — it lives in its
//    own table, which nothing that reads messages touches;
//  - someone who cannot open a chat cannot read or write its notes;
//  - a note is deleted only by its author, or by an admin.
// Names and numbers are synthetic.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  user: { email: "asha@example.com", name: "Asha", role: "member" } as Record<string, unknown> | null,
  conv: { id: "c1", channelId: "ch-sales" } as Record<string, unknown> | null,
  allowed: ["ch-sales"] as string[] | null,
  added: [] as { body: string; author: unknown }[],
  deleteBy: null as unknown,
  deleted: true,
  tenants: [] as unknown[],
}));

vi.mock("../auth", () => ({ currentUser: async () => h.user, currentTenantId: async () => (h.user ? "t-acme" : null) }));
vi.mock("../teams", () => ({
  visibleChannelIds: async () => h.allowed,
  canSeeConversation: (allowed: string[] | null, ch: string | null) => allowed === null || (!!ch && allowed.includes(ch)),
}));
vi.mock("../team", () => ({ logActivity: () => {} }));
vi.mock("../store", () => ({
  NOTE_MAX: 2000,
  getConversation: async (_id: string, tid: string) => { h.tenants.push(tid); return h.conv; },
  listConversationNotes: async (tid: string) => { h.tenants.push(tid); return [{ id: "n1", authorEmail: "asha@example.com", authorName: "Asha", body: "Wants the EMI option", createdAt: "" }]; },
  addConversationNote: async (tid: string, _c: string, author: unknown, body: string) => { h.tenants.push(tid); h.added.push({ body, author }); return { id: "n2", body }; },
  deleteConversationNote: async (tid: string, _c: string, _n: string, by: unknown) => { h.tenants.push(tid); h.deleteBy = by; return h.deleted; },
}));

const route = await import("../../app/api/admin/conversations/[id]/notes/route");
const ctx = { params: Promise.resolve({ id: "c1" }) };
const req = (method: string, body?: object, qs = "") => new Request(`https://portal.example/api/admin/conversations/c1/notes${qs}`, { method, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  h.user = { email: "asha@example.com", name: "Asha", role: "member" };
  h.conv = { id: "c1", channelId: "ch-sales" }; h.allowed = ["ch-sales"];
  h.added = []; h.deleteBy = null; h.deleted = true; h.tenants = [];
});

describe("who can see a chat's notes", () => {
  it("the team that can open the chat reads them, and is told who it is", async () => {
    const d = await (await route.GET(req("GET"), ctx)).json();
    expect(d.notes).toHaveLength(1);
    expect(d.viewer).toEqual({ email: "asha@example.com", isAdmin: false });
  });

  it("every read and write is for the signed-in business", async () => {
    await route.GET(req("GET"), ctx);
    await route.POST(req("POST", { body: "hi" }), ctx);
    expect(new Set(h.tenants)).toEqual(new Set(["t-acme"]));
  });

  it("another team's chat is a 404 — for reading and for writing", async () => {
    h.allowed = ["ch-ops"];
    expect((await route.GET(req("GET"), ctx)).status).toBe(404);
    expect((await route.POST(req("POST", { body: "hi" }), ctx)).status).toBe(404);
    expect(h.added).toEqual([]);
  });

  it("signed out is a 401", async () => {
    h.user = null;
    expect((await route.GET(req("GET"), ctx)).status).toBe(401);
  });
});

describe("writing and deleting", () => {
  it("adds a trimmed note as the signed-in person", async () => {
    expect((await route.POST(req("POST", { body: "  Father decides — call after 7  " }), ctx)).status).toBe(200);
    expect(h.added).toEqual([{ body: "Father decides — call after 7", author: { email: "asha@example.com", name: "Asha" } }]);
  });

  it("refuses an empty or overlong note", async () => {
    expect((await route.POST(req("POST", { body: "   " }), ctx)).status).toBe(400);
    expect((await route.POST(req("POST", { body: "x".repeat(2001) }), ctx)).status).toBe(400);
  });

  it("deletes as the author, or as an admin — and says so when it is neither", async () => {
    await route.DELETE(req("DELETE", undefined, "?noteId=n1"), ctx);
    expect(h.deleteBy).toEqual({ email: "asha@example.com", isAdmin: false });
    h.user = { email: "boss@example.com", role: "admin" };
    await route.DELETE(req("DELETE", undefined, "?noteId=n1"), ctx);
    expect(h.deleteBy).toEqual({ email: "boss@example.com", isAdmin: true });
    h.deleted = false;
    expect((await route.DELETE(req("DELETE", undefined, "?noteId=n1"), ctx)).status).toBe(403);
  });
});

describe("a note can never reach the customer, the AI or the CRM", () => {
  // Everything under src/ that mentions the notes table. Only the store
  // functions and this test may: the AI's history, the widget's poll, the CRM
  // sync and exports all read wa_conv_messages, and must never read notes.
  function filesUnder(dir: string): string[] {
    return readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  }
  it("only the store reads or writes the notes table", () => {
    const users = filesUnder(join(process.cwd(), "src"))
      .filter(p => !p.includes("__tests__"))
      .filter(p => readFileSync(p, "utf8").includes("wa_conversation_notes"))
      .map(p => p.slice(p.indexOf("src/")));
    expect(users).toEqual(["src/lib/store.ts"]);
  });
});
