// Every partner dashboard API goes through withPartner: no session → 401, and
// owner-only actions (team, brand, prices) refuse staff.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const { currentPartner } = vi.hoisted(() => ({ currentPartner: vi.fn() }));
vi.mock("../partner-portal", () => ({ currentPartner }));

import { withPartner } from "../partner-api";

const ctx = (role: "owner" | "staff") => ({ user: { id: "u1", role }, partner: { id: "p1" }, brand: {}, tokenVersion: 0 });
const ok = async () => NextResponse.json({ ok: true });

beforeEach(() => currentPartner.mockReset());

describe("withPartner", () => {
  it("refuses a caller with no live partner session", async () => {
    currentPartner.mockResolvedValue(null);
    expect((await withPartner(ok)).status).toBe(401);
  });
  it("refuses staff on an owner-only action, and lets owners through", async () => {
    currentPartner.mockResolvedValue(ctx("staff"));
    expect((await withPartner(ok, { ownerOnly: true })).status).toBe(403);
    expect((await withPartner(ok)).status).toBe(200);
    currentPartner.mockResolvedValue(ctx("owner"));
    expect((await withPartner(ok, { ownerOnly: true })).status).toBe(200);
  });
  it("never leaks an internal error message", async () => {
    currentPartner.mockResolvedValue(ctx("owner"));
    const r = await withPartner(async () => { throw new Error("relation secret_table does not exist at line 4"); });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret_table");
  });
});
