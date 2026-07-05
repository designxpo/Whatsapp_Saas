// INDUSTRY SCENARIO — D2C e-commerce (skincare brand "Glow & Co") on Talko AI.
//
// FEATURE CONTRACT locked in by this suite:
//  1. Commerce: the catalog lists per-tenant products; an open cart can be
//     created/replaced (replacing resets the abandonment clock); checkout turns
//     the open cart into an order with the right total, mints a hosted payment
//     link for unpaid orders, enrolls the post-purchase sequence and emits the
//     order.created integration event. No open cart -> checkout returns null.
//  2. Cart recovery: the cron enrolls idle, non-empty carts into the owning
//     tenant's cart_abandoned sequence exactly once; carts that fail to enroll
//     stay open (retried), and tenants without a recovery sequence are skipped.
//  3. Auto-send campaigns: fireTrigger("tag_added" | "api_event") schedules a
//     delayed per-recipient send only when an enabled matching config exists;
//     drainAutoSends sends due rows with the campaign's template and marks each
//     row by its REAL outcome (unattempted rows stay pending for retry).
//  4. Preflight: templateIssues blocks the classic template mistakes in plain
//     English before a send ever hits Meta.
//  5. Opt-out compliance: STOP -> addOptout suppresses the customer (last-10
//     phone matching, so +91 variants are all covered) per tenant only; START
//     -> removeOptout restores them. (The STOP/START regexes themselves live
//     unexported in the webhook route, so the journey is exercised at lib level.)
//  6. Growth: a "GET GLOW" QR/ref-link redirects to a digits-only wa.me link and
//     counts the click; the inbound opt-in text maps back to the tool (substring,
//     case-insensitive, tenant-scoped), counts the conversion, and its tag can
//     chain into the tag_added auto-send.
//
// Real library logic, mocked IO: supabase is a chainable in-memory stub; the
// Meta send layer (whatsapp), channels, quota, sequences and integrations are
// module mocks. Zero network.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Shared mock state (hoisted above the vi.mock factories) ──────────────────
const { tables, mocks } = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  mocks: {
    // sequences (commerce enrolls recovery/post-purchase drips through these)
    getSequenceByTrigger: vi.fn(),
    enroll: vi.fn(),
    // integrations (payment links + event fan-out)
    emitEvent: vi.fn(),
    createPaymentLink: vi.fn(),
    // whatsapp send layer (campaign.ts)
    sendCampaign: vi.fn(),
    getCreds: vi.fn(() => ({ token: "tok", phoneId: "ph", wabaId: "waba" })),
    // channels + quota (campaign.ts)
    credsFor: vi.fn(async () => null),
    getChannel: vi.fn(async () => null),
    isMarketingSendable: vi.fn(() => true),
    getDailyCapForTier: vi.fn(() => 1000),
  },
}));

// ── Chainable, thenable in-memory supabase stub ───────────────────────────────
// Filters collected on the chain; the op (select/insert/update/upsert/delete)
// only runs when the builder is awaited, so update(...).eq(...) works.
vi.mock("@/lib/supabase", () => {
  let autoId = 0;
  type Row = Record<string, unknown>;
  function builder(table: string) {
    const state = {
      filters: [] as ((r: Row) => boolean)[],
      op: "select" as "select" | "insert" | "update" | "upsert" | "delete",
      payload: null as unknown,
      onConflict: null as string | null,
      single: false,
      head: false,
      order: null as { col: string; asc: boolean } | null,
      limit: null as number | null,
    };
    const matches = () => (tables[table] ?? []).filter(r => state.filters.every(f => f(r)));
    function run(): { data: unknown; error: null; count: number | null } {
      const all = (tables[table] ??= []);
      if (state.op === "insert") {
        const list = ([] as Row[]).concat(state.payload as Row | Row[])
          .map(r => ({ id: `${table}-${++autoId}`, created_at: new Date().toISOString(), ...r }));
        all.push(...list);
        return { data: state.single ? list[0] : list, error: null, count: null };
      }
      if (state.op === "upsert") {
        const row = { ...(state.payload as Row) };
        const keys = (state.onConflict ?? "").split(",").map(s => s.trim()).filter(Boolean);
        const hit = keys.length ? all.find(r => keys.every(k => r[k] === row[k])) : undefined;
        if (hit) Object.assign(hit, row);
        else all.push({ id: `${table}-${++autoId}`, created_at: new Date().toISOString(), ...row });
        return { data: null, error: null, count: null };
      }
      if (state.op === "update") {
        const hits = matches();
        for (const r of hits) Object.assign(r, state.payload as Row);
        return { data: state.single ? hits[0] ?? null : hits, error: null, count: null };
      }
      if (state.op === "delete") {
        const hits = new Set(matches());
        tables[table] = all.filter(r => !hits.has(r));
        return { data: null, error: null, count: null };
      }
      // select
      let out = matches().slice();
      if (state.order) {
        const { col, asc } = state.order;
        out.sort((a, b) => {
          const x = a[col] as string | number, y = b[col] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (state.limit != null) out = out.slice(0, state.limit);
      if (state.head) return { data: null, error: null, count: out.length };
      return { data: state.single ? out[0] ?? null : out, error: null, count: out.length };
    }
    const api = {
      select: (_cols?: string, opts?: { head?: boolean; count?: string }) => { if (opts?.head) state.head = true; return api; },
      eq: (col: string, val: unknown) => { state.filters.push(r => r[col] === val); return api; },
      // SQL LIKE with % wildcards (store.ts matches phones by "%<last10>").
      like: (col: string, pattern: string) => {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
        state.filters.push(r => typeof r[col] === "string" && re.test(r[col] as string));
        return api;
      },
      in: (col: string, vals: unknown[]) => { state.filters.push(r => vals.includes(r[col])); return api; },
      lte: (col: string, val: string | number) => { state.filters.push(r => (r[col] as string | number) <= val); return api; },
      gte: (col: string, val: string | number) => { state.filters.push(r => (r[col] as string | number) >= val); return api; },
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) state.filters.push(r => r[col] !== null && r[col] !== undefined);
        return api;
      },
      order: (col: string, opts?: { ascending?: boolean }) => { state.order = { col, asc: opts?.ascending ?? true }; return api; },
      limit: (n: number) => { state.limit = n; return api; },
      single: () => { state.single = true; return api; },
      maybeSingle: () => { state.single = true; return api; },
      insert: (row: unknown) => { state.op = "insert"; state.payload = row; return api; },
      update: (patch: Row) => { state.op = "update"; state.payload = patch; return api; },
      upsert: (row: Row, opts?: { onConflict?: string }) => { state.op = "upsert"; state.payload = row; state.onConflict = opts?.onConflict ?? null; return api; },
      delete: () => { state.op = "delete"; return api; },
      then: (resolve: (v: { data: unknown; error: null; count: number | null }) => unknown, reject?: (e: unknown) => unknown) => {
        try { return Promise.resolve(resolve(run())); }
        catch (e) { if (reject) return Promise.resolve(reject(e)); return Promise.reject(e); }
      },
    };
    return api;
  }
  return { db: () => ({ from: builder }) };
});

vi.mock("@/lib/sequences", () => ({
  getSequenceByTrigger: mocks.getSequenceByTrigger,
  enroll: mocks.enroll,
}));
vi.mock("@/lib/integrations", () => ({
  emitEvent: mocks.emitEvent,
  createPaymentLink: mocks.createPaymentLink,
}));
vi.mock("@/lib/whatsapp", () => ({
  sendCampaign: mocks.sendCampaign,
  getCreds: mocks.getCreds,
}));
vi.mock("@/lib/channels", () => ({
  credsFor: mocks.credsFor,
  getChannel: mocks.getChannel,
  isMarketingSendable: mocks.isMarketingSendable,
}));
vi.mock("@/lib/quota", () => ({
  getDailyCapForTier: mocks.getDailyCapForTier,
}));

// SUTs — real modules, exercised against the stubs above.
import { listProducts, importProducts, upsertCart, getOpenCart, checkoutCart, drainAbandonedCarts, type CartItem } from "@/lib/commerce";
import { fireTrigger } from "@/lib/autosend";
import { drainAutoSends } from "@/lib/campaign";
import { templateIssues } from "@/lib/preflight";
import { addOptout, removeOptout, isOptedOut, optoutSet } from "@/lib/store";
import { resolveGrowthRedirect, growthToolForOptIn, recordGrowthConversion } from "@/lib/growth";
import type { ImportedProduct } from "@/lib/integrations";

// Glow & Co (the skincare brand) and a second tenant to prove isolation.
const GLOW = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const AISHA = "919876543210"; // phones are digits-only in storage

const serumItem: CartItem = { productId: "p-serum", name: "Vitamin C Glow Serum", qty: 1, priceCents: 129900 };
const spfItem: CartItem = { productId: "p-spf", name: "SPF 50 Sunscreen", qty: 2, priceCents: 89900 };

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  mocks.getSequenceByTrigger.mockReset().mockResolvedValue(null);
  mocks.enroll.mockReset().mockResolvedValue(undefined);
  mocks.emitEvent.mockReset().mockResolvedValue(undefined);
  mocks.createPaymentLink.mockReset().mockResolvedValue(null);
  mocks.sendCampaign.mockReset();
});

describe("D2C e-commerce (skincare brand) — Glow & Co on Talko AI", () => {

  // ── 1. Product catalog ──────────────────────────────────────────────────────
  describe("product catalog (commerce)", () => {
    it("lists only this brand's products, newest first, with price/currency defaults mapped", async () => {
      tables["wa_products"] = [
        { id: "p-serum", tenant_id: GLOW, name: "Vitamin C Glow Serum", description: "Brightening serum", price_cents: 129900, currency: "INR", image_url: "https://cdn.glowco.in/serum.jpg", retailer_id: "SERUM-VITC", available: true, created_at: "2026-07-01T00:00:00Z" },
        { id: "p-spf", tenant_id: GLOW, name: "SPF 50 Sunscreen", price_cents: 89900, created_at: "2026-07-02T00:00:00Z" },
        { id: "p-rival", tenant_id: OTHER, name: "Rival Night Cream", price_cents: 10000, created_at: "2026-07-03T00:00:00Z" },
      ];
      const products = await listProducts(GLOW);
      expect(products.map(p => p.id)).toEqual(["p-spf", "p-serum"]); // newest first, no cross-tenant leak
      const serum = products.find(p => p.id === "p-serum")!;
      expect(serum.priceCents).toBe(129900);
      expect(serum.retailerId).toBe("SERUM-VITC");
      const spf = products.find(p => p.id === "p-spf")!;
      expect(spf.currency).toBe("INR");     // default currency for an Indian D2C brand
      expect(spf.available).toBe(true);     // available unless explicitly hidden
      expect(spf.imageUrl).toBeNull();
    });

    it("re-syncing the Shopify catalog updates existing products instead of duplicating them", async () => {
      const sync1: ImportedProduct[] = [
        { externalId: "8801", name: "Vitamin C Glow Serum", description: "30ml", priceCents: 129900, currency: "INR", imageUrl: null, available: true },
        { externalId: "8802", name: "SPF 50 Sunscreen", description: null, priceCents: 89900, currency: "INR", imageUrl: null, available: true },
        { externalId: "", name: "Ghost row", description: null, priceCents: 1, currency: "INR", imageUrl: null, available: true }, // no id -> skipped
      ];
      expect(await importProducts(sync1, "shopify", GLOW)).toEqual({ imported: 2, updated: 0 });
      expect(tables["wa_products"]).toHaveLength(2);
      expect(tables["wa_products"][0].retailer_id).toBe("shopify:8801"); // dedup key

      // Price drop on the serum, second sync: same rows, updated in place.
      const sync2 = sync1.slice(0, 2).map(p => ({ ...p, priceCents: p.externalId === "8801" ? 99900 : p.priceCents }));
      expect(await importProducts(sync2, "shopify", GLOW)).toEqual({ imported: 0, updated: 2 });
      expect(tables["wa_products"]).toHaveLength(2); // still 2 — no duplicate catalog
      expect(tables["wa_products"].find(r => r.retailer_id === "shopify:8801")!.price_cents).toBe(99900);
    });
  });

  // ── 2. Cart -> checkout ─────────────────────────────────────────────────────
  describe("open cart and checkout", () => {
    it("opens a cart, and adding again replaces the items and resets the abandonment clock", async () => {
      const cartId = await upsertCart({ phone: AISHA, items: [serumItem] }, GLOW);
      expect(tables["wa_carts"]).toHaveLength(1);
      expect(tables["wa_carts"][0]).toMatchObject({ tenant_id: GLOW, phone: AISHA, status: "open", platform: "whatsapp" });

      // Aisha adds sunscreen — same open cart, replaced items, recovery re-armed.
      const again = await upsertCart({ phone: AISHA, items: [serumItem, spfItem] }, GLOW);
      expect(again).toBe(cartId);
      expect(tables["wa_carts"]).toHaveLength(1);
      expect(tables["wa_carts"][0].items).toEqual([serumItem, spfItem]);
      expect(tables["wa_carts"][0].recovery_sent).toBe(false);

      const open = await getOpenCart(AISHA, GLOW);
      expect(open?.id).toBe(cartId);
      expect(open?.items).toHaveLength(2);
    });

    it("checkout totals the cart, creates a pending order with a payment link, and fires post-purchase hooks", async () => {
      await upsertCart({ phone: AISHA, items: [serumItem, spfItem] }, GLOW); // 1299.00 + 2x899.00 = 3097.00
      mocks.getSequenceByTrigger.mockResolvedValue({ id: "seq-postpurchase" });
      mocks.createPaymentLink.mockResolvedValue({ url: "https://rzp.io/l/glow3097", id: "plink_1" });

      const r = await checkoutCart({ phone: AISHA }, GLOW);
      expect(r).not.toBeNull();
      expect(r!.totalCents).toBe(309700);
      expect(r!.paymentUrl).toBe("https://rzp.io/l/glow3097");

      const order = tables["wa_orders"][0];
      expect(order).toMatchObject({ tenant_id: GLOW, phone: AISHA, total_cents: 309700, status: "pending" });
      expect(order.payment_ref).toBe("plink_1");                 // link id persisted on the order
      expect(tables["wa_carts"][0].status).toBe("ordered");      // cart closed — recovery can't fire on it

      expect(mocks.createPaymentLink).toHaveBeenCalledWith(GLOW, expect.objectContaining({ amountCents: 309700, phone: AISHA }));
      expect(mocks.getSequenceByTrigger).toHaveBeenCalledWith("order_placed", null, GLOW);
      expect(mocks.enroll).toHaveBeenCalledWith("seq-postpurchase", { phone: AISHA, platform: "whatsapp" }, GLOW);
      expect(mocks.emitEvent).toHaveBeenCalledWith(GLOW, "order.created", { orderId: r!.orderId, phone: AISHA, totalCents: 309700 });
    });

    it("a pre-paid checkout is marked paid with no payment link, and checkout without a cart returns null", async () => {
      // Paid via UPI before checkout (paymentRef supplied) — no link minted.
      await upsertCart({ phone: AISHA, items: [serumItem] }, GLOW);
      const paid = await checkoutCart({ phone: AISHA, paymentRef: "upi_txn_771" }, GLOW);
      expect(paid!.paymentUrl).toBeNull();
      expect(tables["wa_orders"][0]).toMatchObject({ status: "paid", payment_ref: "upi_txn_771" });
      expect(mocks.createPaymentLink).not.toHaveBeenCalled();

      // Free-sample cart (0 total) — nothing to pay, no link either.
      await upsertCart({ phone: "918368904146", items: [{ productId: "p-sample", name: "Sachet Sample", qty: 1, priceCents: 0 }] }, GLOW);
      const free = await checkoutCart({ phone: "918368904146" }, GLOW);
      expect(free!.totalCents).toBe(0);
      expect(free!.paymentUrl).toBeNull();
      expect(mocks.createPaymentLink).not.toHaveBeenCalled();

      // No open cart at all -> null, and no phantom order row.
      expect(await checkoutCart({ phone: "917000000009" }, GLOW)).toBeNull();
      expect(tables["wa_orders"].filter(o => o.phone === "917000000009")).toHaveLength(0);
    });
  });

  // ── 3. Abandoned-cart recovery cron ─────────────────────────────────────────
  describe("abandoned-cart recovery (drainAbandonedCarts)", () => {
    const idleSince = new Date(Date.now() - 2 * 3600_000).toISOString(); // 2h idle

    it("enrolls an idle cart into its own tenant's cart_abandoned sequence exactly once", async () => {
      tables["wa_carts"] = [
        { id: "cart-aisha", tenant_id: GLOW, phone: AISHA, platform: "whatsapp", conversation_id: "conv-1", items: [serumItem], status: "open", recovery_sent: false, updated_at: idleSince },
      ];
      mocks.getSequenceByTrigger.mockImplementation(async (kind: string, _v: unknown, tid: string) =>
        kind === "cart_abandoned" && tid === GLOW ? { id: "seq-recovery" } : null);

      expect(await drainAbandonedCarts(60)).toBe(1);
      expect(mocks.enroll).toHaveBeenCalledWith("seq-recovery", { phone: AISHA, platform: "whatsapp", conversationId: "conv-1" }, GLOW);
      expect(tables["wa_carts"][0]).toMatchObject({ status: "abandoned", recovery_sent: true });

      // Second cron tick: recovery_sent=true keeps her from being nagged twice.
      expect(await drainAbandonedCarts(60)).toBe(0);
      expect(mocks.enroll).toHaveBeenCalledTimes(1);
    });

    it("skips fresh carts, empty carts, and tenants without a recovery sequence", async () => {
      tables["wa_carts"] = [
        { id: "cart-fresh", tenant_id: GLOW, phone: "918368904146", platform: "whatsapp", conversation_id: null, items: [spfItem], status: "open", recovery_sent: false, updated_at: new Date().toISOString() },
        { id: "cart-empty", tenant_id: GLOW, phone: "917000000001", platform: "whatsapp", conversation_id: null, items: [], status: "open", recovery_sent: false, updated_at: idleSince },
        { id: "cart-other", tenant_id: OTHER, phone: "916000000002", platform: "whatsapp", conversation_id: null, items: [serumItem], status: "open", recovery_sent: false, updated_at: idleSince },
      ];
      // Only GLOW configured a recovery sequence; OTHER never opted into recovery.
      mocks.getSequenceByTrigger.mockImplementation(async (kind: string, _v: unknown, tid: string) =>
        kind === "cart_abandoned" && tid === GLOW ? { id: "seq-recovery" } : null);

      expect(await drainAbandonedCarts(60)).toBe(0);
      expect(mocks.enroll).not.toHaveBeenCalled();
      for (const c of tables["wa_carts"]) expect(c).toMatchObject({ status: "open", recovery_sent: false });
    });

    it("a failed enrollment leaves the cart open so the next cron run retries it", async () => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      tables["wa_carts"] = [
        { id: "cart-aisha", tenant_id: GLOW, phone: AISHA, platform: "whatsapp", conversation_id: null, items: [serumItem], status: "open", recovery_sent: false, updated_at: idleSince },
      ];
      mocks.getSequenceByTrigger.mockResolvedValue({ id: "seq-recovery" });
      mocks.enroll.mockRejectedValue(new Error("supabase timeout"));

      expect(await drainAbandonedCarts(60)).toBe(0);
      expect(tables["wa_carts"][0]).toMatchObject({ status: "open", recovery_sent: false }); // not lost
      quiet.mockRestore();
    });
  });

  // ── 4. Auto-send campaign triggers (tag_added / api_event) ──────────────────
  describe("auto-send campaign triggers (fireTrigger + drainAutoSends)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-05T10:00:00Z"));
      tables["wa_campaigns"] = [{
        id: "camp-vip", tenant_id: GLOW, name: "Glow Club VIP offer",
        template_name: "glow_vip_offer", language_code: "en", variables: [],
        status: "draft", auto_send_enabled: true, auto_send_trigger: "tag_added",
        trigger_key: "glow-club", delay_value: 30, delay_unit: "minutes",
        created_at: "2026-07-01T00:00:00Z",
      }];
    });
    afterEach(() => vi.useRealTimers());

    it("tagging a contact 'glow-club' schedules the VIP template 30 minutes out, phone digits-only", async () => {
      const fired = await fireTrigger(
        { trigger: "tag_added", triggerKey: "glow-club", contactId: "c-aisha", phone: "+91 98765 43210", name: "Aisha" },
        GLOW,
      );
      expect(fired).toBe(true);
      expect(tables["wa_scheduled_sends"]).toHaveLength(1);
      expect(tables["wa_scheduled_sends"][0]).toMatchObject({
        tenant_id: GLOW, campaign_id: "camp-vip", contact_id: "c-aisha",
        phone: AISHA,                                // "+91 98765 43210" stored digits-only
        recipient_name: "Aisha", trigger: "tag_added", status: "pending",
        send_after: "2026-07-05T10:30:00.000Z",      // configured 30-minute delay
      });
    });

    it("triggers with no matching enabled config never schedule anything", async () => {
      const base = { contactId: "c-aisha", phone: AISHA, name: "Aisha" };
      // Different tag than the config's trigger_key.
      expect(await fireTrigger({ trigger: "tag_added", triggerKey: "newsletter", ...base }, GLOW)).toBe(false);
      // api_event trigger the brand never configured.
      expect(await fireTrigger({ trigger: "api_event", triggerKey: "order_delivered", ...base }, GLOW)).toBe(false);
      // Same tag, wrong tenant.
      expect(await fireTrigger({ trigger: "tag_added", triggerKey: "glow-club", ...base }, OTHER)).toBe(false);
      expect(tables["wa_scheduled_sends"] ?? []).toHaveLength(0);
    });

    it("drainAutoSends sends due rows with the campaign template and marks each by its real outcome", async () => {
      tables["wa_scheduled_sends"] = [
        { id: "s1", tenant_id: GLOW, campaign_id: "camp-vip", phone: AISHA, recipient_name: "Aisha", trigger: "tag_added", status: "pending", send_after: "2026-07-05T09:30:00.000Z" },
        { id: "s2", tenant_id: GLOW, campaign_id: "camp-vip", phone: "918368904146", recipient_name: "Meera", trigger: "tag_added", status: "pending", send_after: "2026-07-05T09:45:00.000Z" },
        { id: "s3", tenant_id: GLOW, campaign_id: "camp-vip", phone: "917000000001", recipient_name: "Zoya", trigger: "tag_added", status: "pending", send_after: "2026-07-05T09:50:00.000Z" },
        { id: "s4", tenant_id: GLOW, campaign_id: "camp-vip", phone: "916000000002", recipient_name: "Later", trigger: "tag_added", status: "pending", send_after: "2026-07-05T18:00:00.000Z" }, // not due yet
      ];
      // Meta processed only 2 of the 3 due recipients (early-abort contract).
      mocks.sendCampaign.mockResolvedValue({
        results: [{ phone: AISHA, status: "sent" }, { phone: "918368904146", status: "failed" }],
        errors: ["(#131026) Message undeliverable"], sentCount: 1,
      });

      expect(await drainAutoSends()).toEqual({ sent: 1, failed: 1 });

      expect(mocks.sendCampaign).toHaveBeenCalledTimes(1);
      const args = mocks.sendCampaign.mock.calls[0][0];
      expect(args.templateName).toBe("glow_vip_offer");
      expect(args.tenantId).toBe(GLOW);
      expect(args.recipients).toEqual([
        { phone: AISHA, fullName: "Aisha" },
        { phone: "918368904146", fullName: "Meera" },
        { phone: "917000000001", fullName: "Zoya" },
      ]); // due rows only, in send_after order — the 18:00 row is untouched

      const byId = Object.fromEntries(tables["wa_scheduled_sends"].map(r => [r.id as string, r.status]));
      expect(byId).toEqual({ s1: "sent", s2: "failed", s3: "pending", s4: "pending" });
      // s3 was never attempted -> stays pending so the next cron run retries it.
    });
  });

  // ── 5. Template send preflight ──────────────────────────────────────────────
  describe("template send preflight (templateIssues)", () => {
    const recoveryTpl = {
      name: "cart_reminder",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Hey {{1}}, your {{2}} is still in your cart — checkout now for 10% off with code GLOW10." },
      ],
    };

    it("a fully-supplied approved recovery template passes clean", () => {
      const r = templateIssues(recoveryTpl, {
        bodyParams: ["Aisha", "Vitamin C Glow Serum"],
        headerImageUrl: "https://cdn.glowco.in/serum.jpg",
      });
      expect(r.blocking).toEqual([]);
      expect(r.warnings).toEqual([]);
    });

    it("blocks the classic mistakes in plain English: missing values, missing header image, unapproved template", () => {
      // Only the name filled, no product, no header image.
      const partial = templateIssues(recoveryTpl, { bodyParams: ["Aisha"] });
      expect(partial.blocking.some(b => /needs 2 values/.test(b) && /you've filled 1/.test(b))).toBe(true);
      expect(partial.blocking.some(b => /image header/.test(b) && /add the image link/.test(b))).toBe(true);

      // Still in Meta review -> can't send at all.
      const pending = templateIssues({ ...recoveryTpl, status: "PENDING" }, {
        bodyParams: ["Aisha", "Vitamin C Glow Serum"], headerImageUrl: "https://cdn.glowco.in/serum.jpg",
      });
      expect(pending.blocking.some(b => b.includes("isn't approved yet (status: PENDING)"))).toBe(true);

      // Template deleted / typo'd name.
      expect(templateIssues(null).blocking[0]).toMatch(/wasn't found/);
    });

    it("carousel templates are blocked from broadcasts but sendable from a flow with >= 2 cards", () => {
      const carousel = { name: "new_arrivals_carousel", status: "APPROVED", components: [{ type: "CAROUSEL", cards: [] }] };
      const broadcast = templateIssues(carousel, {}, "broadcast");
      expect(broadcast.blocking.some(b => /carousel/.test(b) && /broadcasts can't/.test(b))).toBe(true);

      expect(templateIssues(carousel, { cards: [{}, {}] }, "flow").blocking).toEqual([]);
      expect(templateIssues(carousel, { cards: [{}] }, "flow").blocking.some(b => /at least 2 cards/.test(b))).toBe(true);
    });
  });

  // ── 6. Opt-out compliance (STOP / START journey at lib level) ───────────────
  // The webhook's OPTOUT_RE /^\s*(stop|unsubscribe|cancel|opt[\s-]?out)\s*$/i and
  // OPTIN_RE are route-local (unexported), so this exercises what they drive:
  // addOptout -> isOptedOut suppression -> removeOptout.
  describe("opt-out compliance (store)", () => {
    beforeEach(() => {
      tables["contacts"] = [
        { id: "c-aisha", tenant_id: GLOW, phone: AISHA, name: "Aisha", status: "active" },
      ];
    });

    it("STOP suppresses the customer across +91 phone variants and never double-books the opt-out", async () => {
      await addOptout("+91 98765 43210", "inbound STOP", GLOW);

      expect(tables["wa_optouts"]).toHaveLength(1);
      expect(tables["wa_optouts"][0]).toMatchObject({ tenant_id: GLOW, phone: "9876543210", reason: "inbound STOP" }); // last-10 stored
      expect(tables["contacts"][0].status).toBe("optedout"); // excluded from audiences

      // Any representation of the same person is suppressed.
      expect(await isOptedOut(AISHA, GLOW)).toBe(true);        // country-coded
      expect(await isOptedOut("9876543210", GLOW)).toBe(true); // bare local

      // She rage-sends STOP again — upsert keeps a single row.
      await addOptout(AISHA, "inbound STOP", GLOW);
      expect(tables["wa_optouts"]).toHaveLength(1);
    });

    it("a contact imported with a bare local phone flips to 'optedout' when STOP arrives country-coded", async () => {
      // Meera was CSV-imported as "8368904146" (no +91); her STOP arrives from
      // WhatsApp as "918368904146".
      tables["contacts"].push({ id: "c-meera", tenant_id: GLOW, phone: "8368904146", name: "Meera", status: "active" });
      await addOptout("918368904146", "inbound STOP", GLOW);

      // Suppression is last-10 based, so compliance holds for every variant…
      expect(await isOptedOut("8368904146", GLOW)).toBe(true);
      expect(await isOptedOut("918368904146", GLOW)).toBe(true);
      // …and the contact row is matched by last-10 too (was a bug: exact-digits
      // matching left the local-format row "active" in the UI/audience counts).
      const meera = tables["contacts"].find(c => c.id === "c-meera")!;
      expect(meera.status).toBe("optedout");
    });

    it("an opt-out for Glow & Co never suppresses the same phone for another tenant", async () => {
      await addOptout(AISHA, "inbound STOP", GLOW);
      expect(await isOptedOut(AISHA, OTHER)).toBe(false);
      expect(Array.from(await optoutSet(GLOW))).toEqual(["9876543210"]); // bulk-send suppression set
      expect((await optoutSet(OTHER)).size).toBe(0);
    });

    it("START opts the customer back in: suppression lifted, contact active again", async () => {
      await addOptout(AISHA, "inbound STOP", GLOW);
      expect(await isOptedOut(AISHA, GLOW)).toBe(true);

      await removeOptout("+91 98765 43210", GLOW); // customer replied START
      expect(await isOptedOut(AISHA, GLOW)).toBe(false);
      expect(tables["wa_optouts"]).toHaveLength(0);
      expect(tables["contacts"][0].status).toBe("active");
      expect((await optoutSet(GLOW)).size).toBe(0);
    });
  });

  // ── 7. Growth opt-in — the "GET GLOW" QR campaign ───────────────────────────
  describe("growth tools — 'GET GLOW' opt-in (growth)", () => {
    const glowTool = {
      id: "g-glow", tenant_id: GLOW, name: "GET GLOW packaging QR", kind: "qr", slug: "get-glow",
      active: true, clicks: 4, conversions: 0, prefill: "GET GLOW", tag: "glow-club",
      flow_id: null, sequence_id: null, channel_id: null,
      config: { number: "+91 95552-19007" }, created_at: "2026-06-01T00:00:00Z",
    };

    it("scanning the QR redirects to a digits-only wa.me link with the prefill and counts the click", async () => {
      tables["wa_growth_tools"] = [{ ...glowTool }];
      const url = await resolveGrowthRedirect("get-glow");
      expect(url).toBe(`https://wa.me/919555219007?text=${encodeURIComponent("GET GLOW")}`);
      expect(tables["wa_growth_tools"][0].clicks).toBe(5);
    });

    it("the inbound opt-in matches the tool case-insensitively, counts a conversion, and its tag chains into the auto-send", async () => {
      tables["wa_growth_tools"] = [{ ...glowTool }];
      tables["wa_campaigns"] = [{
        id: "camp-vip", tenant_id: GLOW, template_name: "glow_vip_offer", language_code: "en", variables: [],
        status: "draft", auto_send_enabled: true, auto_send_trigger: "tag_added",
        trigger_key: "glow-club", delay_value: 0, delay_unit: "minutes", created_at: "2026-07-01T00:00:00Z",
      }];

      // Customer edited the prefilled text but kept the keyword.
      const tool = await growthToolForOptIn("Hi! get glow please — saw it on the serum box", GLOW);
      expect(tool?.id).toBe("g-glow");
      expect(tool?.tag).toBe("glow-club");

      await recordGrowthConversion(tool!.id, GLOW);
      expect(tables["wa_growth_tools"][0].conversions).toBe(1);

      // The webhook then tags the contact -> the tag_added automation schedules the offer.
      const fired = await fireTrigger({ trigger: "tag_added", triggerKey: tool!.tag, contactId: "c-aisha", phone: AISHA, name: "Aisha" }, GLOW);
      expect(fired).toBe(true);
      expect(tables["wa_scheduled_sends"]).toHaveLength(1);
      expect(tables["wa_scheduled_sends"][0]).toMatchObject({ campaign_id: "camp-vip", phone: AISHA, status: "pending" });
    });

    it("unrelated messages, other tenants, and blank text never match an opt-in tool", async () => {
      tables["wa_growth_tools"] = [{ ...glowTool }];
      expect(await growthToolForOptIn("hello, do you ship to Pune?", GLOW)).toBeNull();
      expect(await growthToolForOptIn("GET GLOW", OTHER)).toBeNull(); // tool belongs to Glow & Co only
      expect(await growthToolForOptIn("   ", GLOW)).toBeNull();
    });
  });
});
