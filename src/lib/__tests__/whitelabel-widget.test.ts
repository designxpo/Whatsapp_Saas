// The website chat widget runs on customers' own sites, so a change here is
// public. Talko's workspaces and Standard partners keep the "Powered by Talko
// AI" line exactly; only a Pro partner's widget drops it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TALKO_BRAND } from "../whitelabel";

const { brandForTenant } = vi.hoisted(() => ({ brandForTenant: vi.fn() }));
vi.mock("../brand-lookup", () => ({ brandForTenant }));
vi.mock("../channels", () => ({
  getChannelBySiteKey: async () => ({ tenantId: "t1", widgetConfig: {} }),
  sanitizeWidgetConfig: () => ({}),
}));

import { GET } from "../../app/api/widget/[siteKey]/loader.js/route";

async function loader(): Promise<string> {
  const r = await GET(new Request("https://app.thetalko.in/api/widget/k/loader.js"), { params: Promise.resolve({ siteKey: "k" }) });
  return r.text();
}
const POW = `<div class="twc-pow">Powered by Talko AI</div>`;

beforeEach(() => brandForTenant.mockReset());

describe("widget Powered-by line", () => {
  it("is unchanged for Talko's own workspaces", async () => {
    brandForTenant.mockResolvedValue(TALKO_BRAND);
    expect(await loader()).toContain(POW);
  });
  it("stays for a Standard partner", async () => {
    brandForTenant.mockResolvedValue({ ...TALKO_BRAND, partnerId: "p1", slug: "x", name: "X", poweredBy: true });
    expect(await loader()).toContain(POW);
  });
  it("is dropped for a Pro partner", async () => {
    brandForTenant.mockResolvedValue({ ...TALKO_BRAND, partnerId: "p1", slug: "x", name: "X", poweredBy: false });
    const js = await loader();
    expect(js).not.toContain("Powered by");
    expect(js).toContain("twc-foot");          // the rest of the widget is intact
  });
});
