import { describe, it, expect, vi } from "vitest";

// A WhatsApp Business Profile save failure used to reach the tenant as Meta's
// raw sentence — "(#100) Invalid parameter" says nothing about WHICH field
// (About, Address, Description, Email, industry) was rejected, and "(#10)"
// read as a generic permission error when the actual fix is reconnecting the
// number, not anything editable on the profile form itself.

vi.mock("../store", () => ({ insertLog: async () => {}, optoutSet: async () => new Set(), contactVarsByPhones: async () => new Map() }));
vi.mock("../mergefields", () => ({ fillVars: (v: string) => v, flattenForTemplate: (v: string) => v }));
vi.mock("../links", () => ({ getTrackedUrls: async () => [], mintLinks: async () => [] }));
vi.mock("../leadsquared", () => ({ enqueueCrmSyncBatch: async () => {}, lsqConfigured: () => false }));
vi.mock("../moderation", () => ({ moderateText: async () => ({ allowed: true }), collectStrings: () => [] }));

import { describeProfileError } from "../whatsapp";

describe("describeProfileError", () => {
  it("prefers Meta's own tenant-facing wording (error_user_msg) when Meta wrote one", () => {
    expect(describeProfileError({ error_user_msg: "Meta's own considered sentence" }, 400)).toBe("Meta's own considered sentence");
  });

  it("translates a permission error (#10) into a reconnect instruction, not a generic permission complaint", () => {
    const msg = describeProfileError({ code: 10, message: "Permission denied" }, 403);
    expect(msg).toMatch(/reconnect/i);
    expect(msg).toMatch(/permission to manage/i);
  });

  it("treats HTTP 401/403 the same as code 10 even without that exact code", () => {
    expect(describeProfileError({ message: "some other wording" }, 401)).toMatch(/reconnect/i);
    expect(describeProfileError({ message: "some other wording" }, 403)).toMatch(/reconnect/i);
  });

  it("names an invalid-field rejection (#100) as a field problem, not a permission one", () => {
    const msg = describeProfileError({ code: 100, message: "Param about must be a UTF-8 string" }, 400);
    expect(msg).toMatch(/rejected one of these fields/i);
    expect(msg).toContain("Param about must be a UTF-8 string");   // Meta's detail still surfaces, just framed
    expect(msg).not.toMatch(/reconnect/i);   // must not be confused with the permission case
  });

  it("falls back to error_data.details when message is absent", () => {
    const msg = describeProfileError({ code: 100, error_data: { details: "vertical value not recognised" } }, 400);
    expect(msg).toContain("vertical value not recognised");
  });

  it("never returns an empty string even with a completely bare error", () => {
    expect(describeProfileError(undefined, 500)).toMatch(/HTTP 500/);
    expect(describeProfileError({}, 502)).toMatch(/HTTP 502/);
  });
});
