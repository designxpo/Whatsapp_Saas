import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(), gate: vi.fn(), count: vi.fn(),
}));
vi.mock("../email", () => ({ sendEmail: mocks.send }));
vi.mock("../loginthrottle", () => ({
  loginKey: () => "test:contact", loginThrottle: mocks.gate, recordLoginFailure: mocks.count,
}));
import { POST } from "@/app/api/contact/route";

const valid = { name: "Priya", email: "priya@example.com", topic: "Sales", message: "Please show me WhatsApp setup." };
const request = (body: unknown) => new Request("https://example.com/api/contact", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ allowed: true });
  mocks.count.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ ok: true });
});

describe("public sales enquiries", () => {
  it.each([null, [], "text", 42])("rejects a non-object payload %j without sending email", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rejects oversized and invalid-topic messages", async () => {
    for (const body of [{ ...valid, message: "x".repeat(5001) }, { ...valid, topic: "<script>" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("silently drops the honeypot without spending an email", async () => {
    expect((await POST(request({ ...valid, website: "spam" }))).status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it("honors the server throttle and returns a retry interval", async () => {
    mocks.gate.mockResolvedValue({ allowed: false, retryAfterSec: 120 });
    const response = await POST(request(valid));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("delivers an escaped sales enquiry with a reply address", async () => {
    expect((await POST(request({ ...valid, message: "<b>hello</b>\nPlease help" }))).status).toBe(200);
    expect(mocks.count).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      replyTo: valid.email, type: "contact_form", html: expect.stringContaining("&lt;b&gt;hello&lt;/b&gt;<br />Please help"),
    }));
  });
  it("does not report a successful lead when email delivery fails", async () => {
    mocks.send.mockResolvedValue({ ok: false });
    expect((await POST(request(valid))).status).toBe(502);
  });
});
