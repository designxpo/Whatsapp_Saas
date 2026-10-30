// Who may sign in at which address. While white-label is off the rule must
// allow everyone without looking anything up, so the current login is exactly
// what it was; once it is on, each address admits only its own users.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { brandForSlug, brandForTenant, brandForDomain } = vi.hoisted(() => ({ brandForSlug: vi.fn(), brandForTenant: vi.fn(), brandForDomain: vi.fn() }));
// brandForHost resolves a host exactly as the real one does, over the mocked lookups.
vi.mock("../brand-lookup", async () => {
  const wl = await vi.importActual<typeof import("../whitelabel")>("../whitelabel");
  return {
    brandForSlug, brandForTenant, brandForDomain, brandForEmail: vi.fn(),
    brandForHost: async (host: string | null) => {
      const k = wl.partnerHostKind(host, wl.whiteLabelConfig());
      if (!k) return { brand: null, partnerHost: false };
      return { brand: "slug" in k ? await brandForSlug(k.slug) : await brandForDomain(k.domain), partnerHost: true };
    },
  };
});
vi.mock("../auth", () => ({ isPlatformOwnerEmail: (e: string) => e === "owner@talko.test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { loginHostRefusal } from "../brand-server";
import { TALKO_BRAND } from "../whitelabel";

const BRIGHT = { ...TALKO_BRAND, partnerId: "p1", slug: "brightdental", name: "Bright Dental" };
const OTHER = { ...TALKO_BRAND, partnerId: "p2", slug: "other", name: "Other Co" };
const member = { email: "asha@bright.example", tenantId: "t1" };

beforeEach(() => { brandForSlug.mockReset(); brandForTenant.mockReset(); brandForDomain.mockReset(); });
afterEach(() => vi.unstubAllEnvs());

describe("loginHostRefusal", () => {
  it("allows everyone, and reads nothing, while white-label is off", async () => {
    expect(await loginHostRefusal(member, "brightdental.thetalko.in")).toBeNull();
    expect(await loginHostRefusal(member, "app.thetalko.in")).toBeNull();
    expect(brandForSlug).not.toHaveBeenCalled();
    expect(brandForTenant).not.toHaveBeenCalled();
  });

  describe("with white-label on", () => {
    beforeEach(() => vi.stubEnv("WHITE_LABEL_ENABLED", "1"));

    it("admits a partner's own user at the partner's address", async () => {
      brandForSlug.mockResolvedValue(BRIGHT); brandForTenant.mockResolvedValue(BRIGHT);
      expect(await loginHostRefusal(member, "brightdental.thetalko.in")).toBeNull();
    });

    it("refuses another partner's user, and Talko's direct users, at a partner's address", async () => {
      brandForSlug.mockResolvedValue(BRIGHT);
      brandForTenant.mockResolvedValue(OTHER);
      expect(await loginHostRefusal(member, "brightdental.thetalko.in")).toMatch(/isn't part of Bright Dental/);
      brandForTenant.mockResolvedValue(TALKO_BRAND);
      expect(await loginHostRefusal(member, "brightdental.thetalko.in")).toMatch(/isn't part of Bright Dental/);
    });

    it("keeps the platform owner off partner addresses", async () => {
      brandForSlug.mockResolvedValue(BRIGHT);
      expect(await loginHostRefusal({ email: "owner@talko.test", tenantId: "default" }, "brightdental.thetalko.in")).toMatch(/owner/i);
    });

    it("refuses an address no open partner owns", async () => {
      brandForSlug.mockResolvedValue(null);
      expect(await loginHostRefusal(member, "ghost.thetalko.in")).toMatch(/isn't active/);
    });

    it("lets Talko's direct users in at Talko's address as before", async () => {
      brandForTenant.mockResolvedValue(TALKO_BRAND);
      expect(await loginHostRefusal(member, "app.thetalko.in")).toBeNull();
      expect(brandForSlug).not.toHaveBeenCalled();
    });

    it("sends a partner's user from Talko's address to their own", async () => {
      brandForTenant.mockResolvedValue(BRIGHT);
      expect(await loginHostRefusal(member, "app.thetalko.in")).toBe("Your workspace signs in at https://brightdental.thetalko.in.");
    });

    it("sends them to the partner's own domain once it's verified", async () => {
      brandForTenant.mockResolvedValue({ ...BRIGHT, domain: "portal.brightdental.in" });
      expect(await loginHostRefusal(member, "app.thetalko.in")).toBe("Your workspace signs in at https://portal.brightdental.in.");
    });

    it("treats a partner's own domain like its sub-address", async () => {
      brandForDomain.mockResolvedValue(BRIGHT); brandForTenant.mockResolvedValue(BRIGHT);
      expect(await loginHostRefusal(member, "portal.brightdental.in")).toBeNull();
      brandForTenant.mockResolvedValue(OTHER);
      expect(await loginHostRefusal(member, "portal.brightdental.in")).toMatch(/isn't part of Bright Dental/);
      brandForDomain.mockResolvedValue(null);   // not verified / unknown domain
      expect(await loginHostRefusal(member, "portal.unknown.in")).toMatch(/isn't active/);
    });

    it("never treats Vercel previews or localhost as a partner domain", async () => {
      brandForTenant.mockResolvedValue(TALKO_BRAND);
      expect(await loginHostRefusal(member, "talko-git-main.vercel.app")).toBeNull();
      expect(await loginHostRefusal(member, "localhost:3000")).toBeNull();
      expect(brandForDomain).not.toHaveBeenCalled();
    });
  });
});
