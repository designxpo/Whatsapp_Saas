import { describe, expect, it, vi } from "vitest";
import { deliverVoiceReply } from "../voice/delivery";
function delivery() {
  return {
    synthesize: vi.fn(async () => ({ url: "https://audio.example/reply.mp3" } as { url: string } | null)),
    sendAudio: vi.fn(async () => ({ id: "audio-id" } as { id?: string; error?: string; deliveryUnknown?: boolean })),
    sendText: vi.fn(async () => ({ id: "text-id" })),
  };
}
describe("voice reply delivery", () => {
  it("keeps booking/payment links actionable as text", async () => {
    const d = delivery();
    expect(await deliverVoiceReply("Book at https://example.com/book", true, d)).toEqual({ id: "text-id" });
    expect(d.synthesize).not.toHaveBeenCalled();
    expect(d.sendAudio).not.toHaveBeenCalled();
  });
  it("sends text when voice is disabled or synthesis is unavailable", async () => {
    const d = delivery();
    await deliverVoiceReply("Complete answer", false, d);
    expect(d.synthesize).not.toHaveBeenCalled();
    d.synthesize.mockResolvedValueOnce(null);
    await deliverVoiceReply("Complete answer", true, d);
    expect(d.sendText).toHaveBeenCalledTimes(2);
  });
  it("sends text after an explicit audio rejection", async () => {
    const d = delivery();
    d.sendAudio.mockResolvedValueOnce({ error: "unsupported media" });
    expect(await deliverVoiceReply("Complete answer", true, d)).toEqual({ id: "text-id" });
    expect(d.sendText).toHaveBeenCalledTimes(1);
  });
  it("does not duplicate accepted audio or an ambiguous transport failure", async () => {
    const d = delivery();
    await deliverVoiceReply("hello", true, d);
    expect(d.sendText).not.toHaveBeenCalled();
    d.sendAudio.mockResolvedValueOnce({ error: "timeout after send", deliveryUnknown: true });
    await deliverVoiceReply("hello", true, d);
    expect(d.sendText).not.toHaveBeenCalled();
    d.sendAudio.mockRejectedValueOnce(new Error("connection lost after send"));
    await expect(deliverVoiceReply("hello", true, d)).rejects.toThrow("connection lost");
    expect(d.sendText).not.toHaveBeenCalled();
  });
});
