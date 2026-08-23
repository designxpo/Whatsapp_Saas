import { describe, it, expect } from "vitest";
import { financialYearOf, formatInvoiceNumber, invoiceMoney, INVOICE_SERIES } from "../invoice";

describe("financialYearOf — Indian financial year, computed in IST", () => {
  it("labels a mid-year month with the April it started from", () => {
    // August 2026 sits inside the year that opened 1 April 2026.
    expect(financialYearOf(new Date("2026-08-22T09:00:00Z"))).toBe("2026-27");
  });

  it("keeps January–March in the year that opened the previous April", () => {
    for (const iso of ["2027-01-01T00:00:00Z", "2027-02-14T12:00:00Z", "2027-03-15T06:00:00Z"]) {
      expect(financialYearOf(new Date(iso))).toBe("2026-27");
    }
  });

  it("rolls over at IST midnight on 1 April, NOT at UTC midnight", () => {
    // 18:29 UTC on 31 March is 23:59 IST, still the old year.
    expect(financialYearOf(new Date("2026-03-31T18:29:00Z"))).toBe("2025-26");
    // 18:30 UTC on 31 March is 00:00 IST on 1 April — the new year's first minute.
    // This is the case a server-local (UTC) computation gets wrong: it would
    // number that renewal into a year that closed five and a half hours ago.
    expect(financialYearOf(new Date("2026-03-31T18:30:00Z"))).toBe("2026-27");
  });

  it("treats 31 March in IST as the last day of the old year", () => {
    // 12:00 IST on 31 March 2026.
    expect(financialYearOf(new Date("2026-03-31T06:30:00Z"))).toBe("2025-26");
    // And the very first instant of 31 March IST, which is still 30 March UTC.
    expect(financialYearOf(new Date("2026-03-30T18:30:00Z"))).toBe("2025-26");
  });

  it("treats 1 April in IST as the first day of the new year", () => {
    expect(financialYearOf(new Date("2026-04-01T06:30:00Z"))).toBe("2026-27");
    // 23:59 IST on 1 April is already 2 April in UTC — the mirror of the
    // boundary above, and still the new year.
    expect(financialYearOf(new Date("2026-04-01T18:29:00Z"))).toBe("2026-27");
  });

  it("crosses a century boundary without printing a bare '0'", () => {
    // 2099-00 would be wrong twice over; the second half is zero-padded.
    expect(financialYearOf(new Date("2099-06-01T00:00:00Z"))).toBe("2099-00");
    expect(financialYearOf(new Date("2100-06-01T00:00:00Z"))).toBe("2100-01");
  });

  it("is independent of the machine's timezone (offset math, not local time)", () => {
    // Same instant expressed two ways — the result must not depend on how the
    // Date was constructed or where the test runs.
    const asUtc = new Date("2026-03-31T18:30:00Z");
    const asEpoch = new Date(Date.UTC(2026, 2, 31, 18, 30, 0));
    expect(financialYearOf(asEpoch)).toBe(financialYearOf(asUtc));
    expect(financialYearOf(asEpoch)).toBe("2026-27");
  });
});

describe("formatInvoiceNumber — SERIES/FY/NNNNN", () => {
  it("zero-pads the first number of a series to five digits", () => {
    expect(formatInvoiceNumber("TALKO", "2026-27", 1)).toBe("TALKO/2026-27/00001");
    expect(INVOICE_SERIES).toBe("TALKO");
  });

  it("pads every width up to five digits", () => {
    expect(formatInvoiceNumber("TALKO", "2026-27", 9)).toBe("TALKO/2026-27/00009");
    expect(formatInvoiceNumber("TALKO", "2026-27", 42)).toBe("TALKO/2026-27/00042");
    expect(formatInvoiceNumber("TALKO", "2026-27", 700)).toBe("TALKO/2026-27/00700");
    expect(formatInvoiceNumber("TALKO", "2026-27", 8_311)).toBe("TALKO/2026-27/08311");
    expect(formatInvoiceNumber("TALKO", "2026-27", 99_999)).toBe("TALKO/2026-27/99999");
  });

  it("grows past five digits rather than truncating", () => {
    // Overflowing the pad width must never wrap back to 00000 — the number has
    // to stay unique even in the year we issue our hundred-thousandth invoice.
    expect(formatInvoiceNumber("TALKO", "2026-27", 100_000)).toBe("TALKO/2026-27/100000");
  });

  it("carries the series and financial year through verbatim", () => {
    expect(formatInvoiceNumber("TALKO-CN", "2029-30", 3)).toBe("TALKO-CN/2029-30/00003");
  });

  it("numbers sort lexically in issue order within a series", () => {
    const numbers = [1, 2, 10, 99, 100, 1_000].map(n => formatInvoiceNumber("TALKO", "2026-27", n));
    expect([...numbers].sort()).toEqual(numbers);
  });
});

describe("invoiceMoney — document formatting", () => {
  it("always shows paise, with Indian digit grouping for rupees", () => {
    expect(invoiceMoney(199_900, "INR")).toBe("₹1,999.00");
    // Lakh grouping, not thousands: ₹1,99,900.00 is how an Indian invoice reads.
    expect(invoiceMoney(19_990_000, "INR")).toBe("₹1,99,900.00");
    expect(invoiceMoney(37_013, "inr")).toBe("₹370.13");
    expect(invoiceMoney(0, "INR")).toBe("₹0.00");
  });

  it("prefixes any other currency with its code", () => {
    expect(invoiceMoney(199_900, "USD")).toBe("USD 1,999.00");
  });
});
