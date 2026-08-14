import { describe, it, expect } from "vitest";
import {
  withCountryCode, looksLikePhone, cleanName, nameFromEmail,
  nameFromContext, contactsFromCandidates, SCAN_LIMIT,
} from "../scan.js";

describe("withCountryCode", () => {
  it("prefixes a 10-digit local number", () => {
    expect(withCountryCode("9845012345", "91")).toBe("919845012345");
  });

  it("leaves a number that already carries a country code", () => {
    expect(withCountryCode("919845012345", "91")).toBe("919845012345");
    expect(withCountryCode("14155550123", "91")).toBe("14155550123");
  });

  it("drops the trunk zero before deciding", () => {
    expect(withCountryCode("09845012345", "91")).toBe("919845012345");
  });

  it("only trusts an 8-digit local number when a tel: link declared it", () => {
    expect(withCountryCode("61234567", "65")).toBe("61234567");                    // loose text
    expect(withCountryCode("61234567", "65", { minLocal: 8 })).toBe("6561234567"); // tel: href
  });

  it("survives junk", () => {
    expect(withCountryCode("", "91")).toBe("");
    // @ts-expect-error — the collector can hand us anything
    expect(withCountryCode(undefined, undefined)).toBe("");
  });
});

describe("looksLikePhone", () => {
  it("accepts 10–15 digits", () => {
    expect(looksLikePhone("9845012345")).toBe(true);
    expect(looksLikePhone("919845012345")).toBe(true);
  });

  it("rejects too short and too long", () => {
    expect(looksLikePhone("98765432")).toBe(false);
    expect(looksLikePhone("9198765432101234")).toBe(false);
  });

  it("rejects placeholders and straight runs", () => {
    expect(looksLikePhone("0000000000")).toBe(false);
    expect(looksLikePhone("0123456789")).toBe(false);
    expect(looksLikePhone("9876543210")).toBe(false);   // the classic dummy number
  });
});

describe("cleanName", () => {
  it("keeps a plausible human name", () => {
    expect(cleanName("Priya Sharma")).toBe("Priya Sharma");
    expect(cleanName("  Dr. Anil Kumar  ")).toBe("Dr. Anil Kumar");
  });

  it("rejects the words pages put next to a number", () => {
    for (const junk of ["Call us", "WhatsApp", "Contact Sales", "Toll Free", "Read more", "Email"]) {
      expect(cleanName(junk)).toBe("");
    }
  });

  it("rejects anything with digits, an @ or a URL", () => {
    expect(cleanName("Flat 3, MG Road")).toBe("");
    expect(cleanName("priya@acme.com")).toBe("");
    expect(cleanName("www.acme.com")).toBe("");
  });

  it("rejects sentences and empty input", () => {
    expect(cleanName("Reach out to our team whenever you like today")).toBe("");
    expect(cleanName("")).toBe("");
    expect(cleanName("   ")).toBe("");
  });

  it("strips surrounding punctuation", () => {
    expect(cleanName("— Priya Sharma:")).toBe("Priya Sharma");
  });
});

describe("nameFromEmail", () => {
  it("builds a name from a personal mailbox", () => {
    expect(nameFromEmail("priya.sharma@acme.com")).toBe("Priya Sharma");
    expect(nameFromEmail("ANIL_KUMAR@acme.co.in")).toBe("Anil Kumar");
  });

  it("refuses role mailboxes — they belong to a company, not a person", () => {
    for (const box of ["info@acme.com", "sales@acme.com", "careers@acme.com", "no-reply@acme.com"]) {
      expect(nameFromEmail(box)).toBe("");
    }
  });

  it("refuses mailboxes with nothing name-like in them", () => {
    expect(nameFromEmail("a1b2@acme.com")).toBe("");
    expect(nameFromEmail("")).toBe("");
  });
});

describe("nameFromContext", () => {
  it("prefers the line above the number", () => {
    const text = "Our team\nPriya Sharma\n+91 98450 12345\nSales";
    expect(nameFromContext(text, { phone: "+91 98450 12345" })).toBe("Priya Sharma");
  });

  it("falls back to a line after the number", () => {
    expect(nameFromContext("+91 98450 12345\nAnil Kumar", { phone: "9845012345" })).toBe("Anil Kumar");
  });

  it("skips the label and finds the person", () => {
    const text = "Call us\nPriya Sharma\n+91 98450 12345";
    expect(nameFromContext(text, { phone: "9845012345" })).toBe("Priya Sharma");
  });

  it("splits on separators as well as newlines", () => {
    expect(nameFromContext("Priya Sharma · Sales · +91 98450 12345", { phone: "9845012345" })).toBe("Priya Sharma");
  });

  it("returns empty when there's no name to find", () => {
    expect(nameFromContext("Helpline · +91 98450 12345", { phone: "9845012345" })).toBe("");
    expect(nameFromContext("")).toBe("");
  });
});

describe("contactsFromCandidates", () => {
  it("pairs a name with a number found in loose text", () => {
    const { contacts, total } = contactsFromCandidates([
      { text: "Priya Sharma\nSales Manager\n+91 98450 12345" },
    ]);
    expect(total).toBe(1);
    expect(contacts[0]).toMatchObject({ phone: "919845012345", name: "Priya Sharma", email: "" });
  });

  it("trusts a tel: href over the visible text", () => {
    const { contacts } = contactsFromCandidates([
      { tel: "+91 98450 12345", text: "Call us\nPriya Sharma\nCall us" },
    ]);
    expect(contacts[0].phone).toBe("919845012345");
    expect(contacts[0].name).toBe("Priya Sharma");
  });

  it("merges repeat sightings of one number and keeps the best details", () => {
    const { contacts, total } = contactsFromCandidates([
      { text: "Helpline\n+91 98450 12345" },                        // footer: no name
      { text: "Priya Sharma\n+91 98450 12345\npriya@acme.com" },     // card: name + email
    ]);
    expect(total).toBe(1);
    expect(contacts[0]).toMatchObject({ name: "Priya Sharma", email: "priya@acme.com" });
  });

  it("names a contact from their email when the page gives no name", () => {
    const { contacts } = contactsFromCandidates([
      { mail: "priya.sharma@acme.com", tel: "", text: "Email\n+91 98450 12345" },
    ]);
    expect(contacts[0].name).toBe("Priya Sharma");
  });

  it("drops candidates with no reachable number", () => {
    const { contacts, total } = contactsFromCandidates([
      { text: "Order #12345678 shipped" },       // 8 digits from loose text
      { text: "Priced at 1,00,000" },
      { text: "Call 0000000000 now" },
      { mail: "info@acme.com", text: "Email us" },
    ]);
    expect(total).toBe(0);
    expect(contacts).toEqual([]);
  });

  it("caps the list but reports the true total", () => {
    const many = Array.from({ length: SCAN_LIMIT + 5 }, (_, i) => ({
      text: `Person ${String.fromCharCode(65 + (i % 26))}\n+9198450${String(12345 + i).padStart(5, "0")}`,
    }));
    const { contacts, total } = contactsFromCandidates(many);
    expect(total).toBe(SCAN_LIMIT + 5);
    expect(contacts).toHaveLength(SCAN_LIMIT);
  });

  it("honours a non-default country code", () => {
    const { contacts } = contactsFromCandidates([{ text: "Sam Lee\n2025550123" }], { cc: "1" });
    expect(contacts[0].phone).toBe("12025550123");
  });

  it("survives a collector that returns nothing useful", () => {
    expect(contactsFromCandidates([]).contacts).toEqual([]);
    // @ts-expect-error — defensive: the injected collector is not type-checked
    expect(contactsFromCandidates(null).contacts).toEqual([]);
    // @ts-expect-error — same
    expect(contactsFromCandidates([null, {}, { text: 5 }]).contacts).toEqual([]);
  });
});
