import { describe, it, expect } from "vitest";
import { money, cartTotal, cartSummary, productMessage, payMessage, ordersSummary } from "../format.js";

// Money is what a tenant notices instantly if it's wrong — a mis-formatted price
// in a customer-facing message is worse than no feature at all.

describe("money", () => {
  it("uses the rupee symbol and Indian grouping by default", () => {
    expect(money(129900)).toBe("₹1,299");
    expect(money(1299000)).toBe("₹12,990");
    // en-IN groups the lakh, not the thousand: 1,29,900 — not 129,900.
    expect(money(12990000)).toBe("₹1,29,900");
  });

  it("drops decimals for whole amounts but keeps real paise", () => {
    expect(money(250000)).toBe("₹2,500");
    expect(money(129950)).toBe("₹1,299.50");
  });

  it("handles other currencies with their own symbol and grouping", () => {
    expect(money(129900, "USD")).toBe("$1,299");
    expect(money(5000, "EUR")).toBe("€50");
    expect(money(5000, "GBP")).toBe("£50");
  });

  it("falls back to the code for a currency it doesn't know", () => {
    expect(money(10000, "JPY")).toBe("JPY 100");
  });

  it("returns blank rather than NaN for junk", () => {
    expect(money(undefined as unknown as number)).toBe("");
    expect(money(Number.NaN)).toBe("");
  });

  it("formats zero as a real amount", () => {
    expect(money(0)).toBe("₹0");
  });
});

describe("cartTotal / cartSummary", () => {
  const items = [
    { productId: "a", name: "Blue Kurta", qty: 2, priceCents: 129900 },
    { productId: "b", name: "Dupatta", qty: 1, priceCents: 49900 },
  ];

  it("multiplies quantity by price", () => {
    expect(cartTotal(items)).toBe(309700);
  });

  it("summarises count and total in one line", () => {
    expect(cartSummary(items)).toBe("3 items · ₹3,097");
  });

  it("says so when the cart is empty", () => {
    expect(cartSummary([])).toBe("Cart is empty");
    expect(cartSummary()).toBe("Cart is empty");
  });

  it("uses the singular for one item", () => {
    expect(cartSummary([{ productId: "a", name: "x", qty: 1, priceCents: 50000 }])).toBe("1 item · ₹500");
  });

  it("ignores malformed lines instead of producing NaN", () => {
    expect(cartTotal([{ qty: 2 }, { priceCents: 100 }] as never)).toBe(0);
  });
});

describe("productMessage", () => {
  it("leads with the name and price", () => {
    const msg = productMessage({ name: "Blue Cotton Kurta", priceCents: 129900, currency: "INR" });
    expect(msg).toBe("Blue Cotton Kurta — ₹1,299");
  });

  it("adds the description and link when the catalog has them", () => {
    const msg = productMessage({
      name: "Kurta", priceCents: 129900, currency: "INR",
      description: "Handloom cotton, size M", buttonUrl: "https://shop.example.in/kurta",
    });
    expect(msg.split("\n")).toEqual(["Kurta — ₹1,299", "Handloom cotton, size M", "https://shop.example.in/kurta"]);
  });

  it("never invents a link when there isn't one", () => {
    expect(productMessage({ name: "Kurta", priceCents: 1000 })).not.toMatch(/http/);
  });
});

describe("payMessage", () => {
  it("states the amount and puts the link on its own line", () => {
    expect(payMessage(309700, "https://pay.example.in/o/123")).toBe(
      "Here's your payment link for ₹3,097:\nhttps://pay.example.in/o/123",
    );
  });
});

describe("ordersSummary", () => {
  it("reads as orders plus lifetime spend", () => {
    expect(ordersSummary({ count: 3, lifetimeCents: 629700, currency: "INR" })).toBe("3 orders · ₹6,297 lifetime");
  });

  it("uses the singular, and omits spend when nothing is paid yet", () => {
    expect(ordersSummary({ count: 1, lifetimeCents: 0, currency: "INR" })).toBe("1 order");
  });

  it("says no orders for a new contact", () => {
    expect(ordersSummary({ count: 0, lifetimeCents: 0 })).toBe("No orders yet");
    expect(ordersSummary(null)).toBe("No orders yet");
  });
});
