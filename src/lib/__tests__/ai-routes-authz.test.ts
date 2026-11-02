// Who may change, read or export the knowledge base and the AI configuration
// (2026-11 AI security audit). Before: any signed-in member could upload,
// edit or delete knowledge the bot answers from, export it wholesale, and add
// an "AI function" — a webhook the model calls with customer data.
//
// Every route below must refuse a member and a team lead with 403 BEFORE it
// touches anything: the data modules are replaced by recorders, and the test
// fails if any of them was reached. Also: no workspace → 401, never the
// platform's default business (these routes used to fall back to it).
// Names are synthetic.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: null as { email: string; role: string } | null,
  tenant: "00000000-0000-0000-0000-00000000000a" as string | null,
  touched: [] as string[],
}));

// A module whose every export records that it was reached.
function recorder(name: string) {
  return new Proxy({}, {
    has: () => true,
    get: (_t, key) => {
      if (key === "then" || typeof key === "symbol") return undefined;
      if (key === "__esModule") return true;
      return (..._a: unknown[]) => { h.touched.push(`${name}.${String(key)}`); return Promise.resolve([]); };
    },
  });
}

vi.mock("../auth", () => ({
  currentUser: async () => h.user,
  currentTenantId: async () => (h.user ? h.tenant : null),
  requireAdmin: async () => h.user !== null,
  requireRoleAdmin: async () => h.user?.role === "admin",
  isPlatformOwner: async () => false,
  DEFAULT_TENANT_ID: "00000000-0000-0000-0000-000000000001",
}));
vi.mock("../store", () => recorder("store"));
vi.mock("../kb", () => recorder("kb"));
vi.mock("../aihub", () => recorder("aihub"));
vi.mock("../kbpublish", () => recorder("kbpublish"));
vi.mock("../kbeval", () => recorder("kbeval"));
vi.mock("../kblibrary", () => recorder("kblibrary"));
vi.mock("../kbconcepts", () => recorder("kbconcepts"));
vi.mock("../okfbundle", () => recorder("okfbundle"));
vi.mock("../llm", () => recorder("llm"));
vi.mock("../router/metrics", () => recorder("metrics"));
vi.mock("../router/faq", () => recorder("faq"));
vi.mock("../router/cache", () => recorder("cache"));
vi.mock("../messaging-settings", () => recorder("settings"));
vi.mock("../ai/keys", () => recorder("keys"));
vi.mock("../ai/chat", () => recorder("chat"));
vi.mock("../isolation", () => recorder("isolation"));
vi.mock("../ai-gaps", () => recorder("gaps"));
vi.mock("../team", () => recorder("team"));

const R = "../../app/api/admin";
type Handler = (req: Request, ctx?: unknown) => Promise<Response>;
const ROUTES: [string, string, string][] = [
  ["kb", "GET", "/kb/route"], ["kb", "POST", "/kb/route"], ["kb", "DELETE", "/kb/route"],
  ["kb concepts", "GET", "/kb/concepts/route"], ["kb concepts", "POST", "/kb/concepts/route"],
  ["kb export", "GET", "/kb/concepts/export/route"],
  ["ai functions", "GET", "/ai/functions/route"], ["ai functions", "POST", "/ai/functions/route"], ["ai functions", "DELETE", "/ai/functions/route"],
  ["ai agents", "POST", "/ai/agents/route"], ["ai agents", "DELETE", "/ai/agents/route"],
  ["ai agent generator", "POST", "/ai/agents/generate/route"],
  ["ai prompts", "POST", "/ai/prompts/route"], ["ai prompts", "DELETE", "/ai/prompts/route"],
  ["ai routing", "POST", "/ai/routing/route"],
  ["AI provider key", "POST", "/ai/key/route"], ["AI provider key", "DELETE", "/ai/key/route"],
  ["knowledge isolation mode", "POST", "/ai/isolation/route"],
  ["knowledge gaps", "POST", "/ai/gaps/route"],
  ["grounding audits", "GET", "/grounding/route"],
  ["assistant test console", "POST", "/assistant/test/route"],
];

async function call(path: string, method: string): Promise<Response> {
  const mod = (await import(/* @vite-ignore */ `${R}${path}`)) as Record<string, Handler>;
  const body = method === "GET" ? undefined : JSON.stringify({ id: "x", name: "evil", question: "hi", webhookUrl: "https://attacker.example/x" });
  return mod[method](new Request("https://portal.example/api", { method, body }), { params: Promise.resolve({}) });
}

beforeEach(() => { h.touched = []; h.tenant = "00000000-0000-0000-0000-00000000000a"; });

describe("knowledge and AI configuration are admin-only", () => {
  for (const role of ["member", "lead"]) {
    for (const [what, method, path] of ROUTES) {
      it(`${role}: ${method} ${what} → 403, nothing touched`, async () => {
        h.user = { email: `${role}@example.com`, role };
        const res = await call(path, method);
        expect(res.status).toBe(403);
        expect(h.touched).toEqual([]);
      });
    }
  }

  it("signed out is refused too", async () => {
    h.user = null;
    for (const [, method, path] of ROUTES) {
      const res = await call(path, method);
      expect([401, 403]).toContain(res.status);
    }
    expect(h.touched).toEqual([]);
  });

  it("an admin with no workspace is refused — never served the platform's own business", async () => {
    h.user = { email: "boss@example.com", role: "admin" };
    h.tenant = null;
    for (const [, method, path] of ROUTES) {
      expect([path, method, (await call(path, method)).status]).toEqual([path, method, 401]);
    }
    expect(h.touched).toEqual([]);
  });

  it("an admin gets through to the handler", async () => {
    h.user = { email: "boss@example.com", role: "admin" };
    await call("/kb/route", "GET");
    expect(h.touched.length).toBeGreaterThan(0);
  });
});

describe("persona list for non-admins", () => {
  it("shows names only — never system prompts, models or product notes", async () => {
    vi.resetModules();
    vi.doMock("../aihub", () => ({
      listAgents: async () => [{ id: "a1", name: "Admissions", active: true, persona: "SECRET PERSONA", model: "m", productInfo: "internal pricing" }],
    }));
    h.user = { email: "member@example.com", role: "member" };
    const { GET } = (await import(`${R}/ai/agents/route`)) as Record<string, Handler>;
    const d = await (await GET(new Request("https://portal.example/api"))).json();
    expect(d.agents).toEqual([{ id: "a1", name: "Admissions", active: true }]);
    vi.doUnmock("../aihub");
  });
});
