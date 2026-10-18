import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendIgMessage, sendIgMedia, sendIgQuickReplies } from "../instagram";

vi.mock("../moderation", () => ({ moderateText: vi.fn(async () => ({ allowed: true })) }));
const creds = { igUserId: "test-human-agent", token: "test-token" };
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ message_id: "sent" }) }));
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();
const senders = {
  text: (opts: { lastInboundAt?: string; humanAgent?: boolean }) => sendIgMessage(creds, "recipient", "Hello", opts),
  media: (opts: { lastInboundAt?: string; humanAgent?: boolean }) => sendIgMedia(creds, "recipient", "image", "https://example.com/photo.jpg", opts),
  quickReplies: (opts: { lastInboundAt?: string; humanAgent?: boolean }) => sendIgQuickReplies(creds, "recipient", "Hello", [{ title: "Yes", payload: "yes" }], opts),
};

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T12:00:00Z")); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

for (const [name, send] of Object.entries(senders)) {
  describe(name, () => {
    it("sends a four-day-old manual reply with the human-agent tag", async () => {
      expect((await send({ lastInboundAt: ago(96), humanAgent: true })).ok).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      expect(body.tag).toBe("HUMAN_AGENT");
    });
    it("does not tag replies within 24 hours", async () => {
      expect((await send({ lastInboundAt: ago(1), humanAgent: true })).ok).toBe(true);
      const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
      expect(body.tag).toBeUndefined();
    });
    it("keeps automated replies within 24 hours", async () => {
      expect((await send({ lastInboundAt: ago(96) })).blockedBy).toBe("window");
      expect(fetchMock).not.toHaveBeenCalled();
    });
    it("rejects expired human-agent replies and cold messages", async () => {
      expect((await send({ lastInboundAt: ago(168), humanAgent: true })).error).toContain("7-day");
      expect((await send({ humanAgent: true })).blockedBy).toBe("cold");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
}
