// Who may sign in at which address. While white-label is off the rule must
// allow everyone without looking anything up, so the current login is exactly
// what it was; once it is on, each address admits only its own users.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { brandForSlug, brandForTenant } = vi.hoisted(() => ({ brandForSlug: vi.fn(), brandForTenant: vi.fn() }));
vi.mock("../brand-lookup", () => ({ brandForSlug, brandForTenant, brandForEmail: vi.fn() }));
vi.mock("../auth", () => ({ isPlatformOwnerEmail: (e: string) => e === "owner@talko.test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { loginHostRefusal } from "../brand-server";
import { TALKO_BRAND } from "../whitelabel";

const BRIGHT = { ...TALKO_BRAND, partnerId: "p1", slug: "brightdental", name: "Bright Dental" };
const OTHER = { ...TALKO_BRAND, partnerId: "p2", slug: "other", name: "Other Co" };
const member = { email: "asha@bright.example", tenantId: "t1" };

beforeEach(() => { brandForSlug.mockReset(); brandForTenant.mockReset(); });
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
  });
});
