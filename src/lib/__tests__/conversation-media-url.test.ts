// An agent's "send media" stores the request's `url` as the message's mediaUrl,
// which the web-chat widget renders as an src/href. Only a clean public https
// link may be accepted, checked before anything is fetched, sent or stored.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ appended: [] as unknown[], moderated: [] as string[] }));

vi.mock("next/server", async orig => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("../supabase", () => ({ db: () => { throw new Error("no db in this test"); } }));
vi.mock("../auth", async orig => ({
  ...(await orig<typeof import("../auth")>()),
  currentTenantId: async () => "t1",
  currentUser: async () => ({ email: "agent@example.com", role: "admin" }),
}));
vi.mock("../teams", () => ({ visibleChannelIds: async () => null, canSeeConversation: () => true, asTeam: (x: unknown) => x }));
vi.mock("../feature-guard", () => ({ guardAccount: async () => null }));
vi.mock("../moderation", () => ({ moderateImageUrl: async (u: string) => { h.moderated.push(u); return { allowed: true }; } }));
vi.mock("../team", () => ({ logActivity: () => {} }));
vi.mock("../store", async orig => ({
  ...(await orig<typeof import("../store")>()),
  getConversation: async () => ({ id: "c1", phone: "web:v1", platform: "webchat", channelId: null, lastInboundAt: null, tenantId: "t1" }),
  appendConvMessage: async (m: unknown) => { h.appended.push(m); return { id: "m1" }; },
  touchOutbound: async () => undefined,
}));

import { POST } from "../../app/api/admin/conversations/[id]/route";

function sendMedia(url: string, kind = "image") {
  return POST(new Request("https://app.thetalko.in/api/admin/conversations/c1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "media", url, kind }),
  }), { params: Promise.resolve({ id: "c1" }) });
}

beforeEach(() => { h.appended = []; h.moderated = []; });

describe("send media: the link must be a clean https URL", () => {
  it.each([
    ['https://a/x.mp4"onerror="alert(1)', "video"],
    ["https://a/x.jpg' onerror='alert(1)", "image"],
    ["https://a/x.jpg<script>", "image"],
    ["https://a/x`y.jpg", "image"],
    ["https://a/x y.jpg", "image"],
    ["http://a/x.jpg", "image"],
    ["javascript:alert(1)", "image"],
    ["data:image/png;base64,AAAA", "image"],
    ["/relative/x.jpg", "document"],
    ["not a url", "document"],
  ])("refuses %s", async (url, kind) => {
    const r = await sendMedia(url, kind);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/https:\/\//);
    expect(h.appended).toEqual([]);     // nothing stored
    expect(h.moderated).toEqual([]);    // and nothing fetched to screen it
  });

  it("accepts an upload's Supabase https URL and stores it", async () => {
    const url = "https://abc.supabase.co/storage/v1/object/public/media/upload/0a1b_1730000000000_brochure.pdf";
    const r = await sendMedia(url, "document");
    expect(r.status).toBe(200);
    expect(h.appended).toEqual([expect.objectContaining({ mediaUrl: url })]);
  });
});
