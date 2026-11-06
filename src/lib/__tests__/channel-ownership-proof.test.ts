// The "paste a token" Facebook Page and Instagram forms used to save the TYPED
// id whenever Meta couldn't resolve the token. A junk token plus another
// business's public Page id then routed that business's Messenger inbox here.
// Real connections — a Page token, a user/system-user token that can open the
// Page, a corrected canonical id, an edit with an expired token — must keep
// working.
import { describe, it, expect, vi } from "vitest";

vi.mock("../supabase", () => ({ db: () => ({}) }));
import { proveChannelId } from "../channels";

const VICTIM = "102938475610293";
const MINE = "556677889900112";

describe("Facebook Page: the saved id must be one the token proves", () => {
  it("refuses a junk token with someone else's Page id (the takeover)", () => {
    const r = proveChannelId({ kind: "page", typedId: VICTIM, resolved: { error: "Invalid OAuth access token" }, tokenOpensTypedPage: false });
    expect(r.ok).toBe(false);
  });

  it("refuses a real token for a different account, and names that account", () => {
    const r = proveChannelId({ kind: "page", typedId: VICTIM, resolved: { id: MINE, name: "My Shop" }, tokenOpensTypedPage: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("My Shop");
  });

  it("accepts a Page token whose /me is the typed Page", () => {
    expect(proveChannelId({ kind: "page", typedId: MINE, resolved: { id: MINE } })).toEqual({ ok: true, id: MINE, corrected: false });
  });

  it("accepts a user/system-user token that could open the typed Page, saving Meta's canonical id", () => {
    expect(proveChannelId({ kind: "page", typedId: VICTIM, resolved: { id: MINE }, tokenOpensTypedPage: true })).toEqual({ ok: true, id: MINE, corrected: true });
  });

  it("lets an admin rename or pause an already-connected Page whose token has expired", () => {
    expect(proveChannelId({ kind: "page", typedId: MINE, resolved: { error: "Session has expired" }, unchangedEdit: true })).toEqual({ ok: true, id: MINE, corrected: false });
  });

  it("does not let an edit switch to a new Page on an unresolvable token", () => {
    expect(proveChannelId({ kind: "page", typedId: VICTIM, resolved: { error: "x" }, unchangedEdit: false }).ok).toBe(false);
  });
});

describe("Instagram account: the token's own account is saved", () => {
  it("refuses a junk token with someone else's account id", () => {
    expect(proveChannelId({ kind: "instagram", typedId: VICTIM, resolved: { error: "Invalid OAuth access token" } }).ok).toBe(false);
  });

  it("saves the token's own account id even when a different one was typed", () => {
    expect(proveChannelId({ kind: "instagram", typedId: VICTIM, resolved: { id: MINE, username: "myshop" } })).toEqual({ ok: true, id: MINE, corrected: true });
  });

  it("keeps an unchanged edit working when the token has expired", () => {
    expect(proveChannelId({ kind: "instagram", typedId: MINE, resolved: { error: "expired" }, unchangedEdit: true }).ok).toBe(true);
  });
});
