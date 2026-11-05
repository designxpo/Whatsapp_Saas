import { describe, expect, it, vi } from "vitest";

// Even an otherwise valid admin session must have an explicit workspace.
// None of these endpoints may substitute the owner's workspace when it is absent.
const h = vi.hoisted(() => ({ touched: [] as string[] }));
vi.mock("../auth", () => ({
  DEFAULT_TENANT_ID: "owner",
  currentTenantId: async () => null,
  currentUser: async () => ({ email: "admin@example.test", role: "admin", tenantId: undefined }),
  requireRoleAdmin: async () => true,
  requireAdmin: async () => true,
}));
vi.mock("../supabase", () => ({ db: () => { h.touched.push("database"); throw new Error("Must not reach database"); } }));
vi.mock("../teams", () => ({ visibleChannelIds: async () => { h.touched.push("locations"); return null; } }));
vi.mock("../feature-guard", () => ({ guardFeature: async () => { h.touched.push("entitlements"); return null; } }));

import { GET as exportReviews } from "../../app/api/admin/reviews/export/route";
import { GET as locationGet, POST as locationPost } from "../../app/api/admin/reviews/location-settings/route";
import { GET as qr } from "../../app/api/admin/review-booster/qr/route";
import { GET as boosterGet, POST as boosterPost } from "../../app/api/admin/review-booster/route";
import { GET as reviewsGet, POST as reviewsPost, DELETE as reviewsDelete } from "../../app/api/admin/reviews/route";
import { POST as settingsPost } from "../../app/api/admin/reviews/settings/route";
import { POST as replyPost } from "../../app/api/admin/reviews/reply/route";
import { POST as policyPost } from "../../app/api/admin/reviews/policy-preview/route";
import { GET as activityGet, POST as activityPost } from "../../app/api/admin/reviews/activity/route";
import { POST as casePost } from "../../app/api/admin/reviews/case/route";
import { GET as contactsGet } from "../../app/api/admin/reviews/contacts/route";
import { GET as reportGet } from "../../app/api/admin/reviews/report/route";

describe("review routes require an explicit workspace", () => {
  const routes: [string, string, (request: Request) => Promise<Response>][] = [
    ["export", "GET", exportReviews], ["location settings", "GET", locationGet],
    ["location settings", "POST", locationPost], ["QR", "GET", qr],
    ["request settings", "GET", boosterGet], ["request settings", "POST", boosterPost],
    ["inbox", "GET", reviewsGet], ["activity", "GET", activityGet], ["activity", "POST", activityPost],
    ["manual review", "POST", reviewsPost], ["review deletion", "DELETE", reviewsDelete],
    ["reply settings", "POST", settingsPost], ["reply", "POST", replyPost], ["policy preview", "POST", policyPost],
    ["case", "POST", casePost], ["contact search", "GET", contactsGet], ["report", "GET", reportGet],
  ];
  for (const [name, method, handler] of routes) {
    it(`${method} ${name} rejects the session before touching data`, async () => {
      h.touched = [];
      const request = new Request("https://app.example.test/api/admin/reviews", {
        method, ...(method === "POST" ? { body: JSON.stringify({ id: "r", channelId: "c", action: "send" }) } : {}),
      });
      expect((await handler(request)).status).toBe(401);
      expect(h.touched).toEqual([]);
    });
  }
});
