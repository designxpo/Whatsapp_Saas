import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMedia, sendMedia } from "../whatsapp";
const channel = { token: "tenant-channel-token", phoneId: "phone-a", wabaId: "waba-a" };
afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp voice media boundaries", () => {
  it("uses channel credentials and reads a bounded media stream", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://8.8.8.8/audio", mime_type: "audio/ogg" })))
      .mockResolvedValueOnce(new Response("OggSvoice"));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadMedia("media-a", channel)).toEqual({ data: Buffer.from("OggSvoice"), mimeType: "audio/ogg" });
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer tenant-channel-token");
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer tenant-channel-token");
    expect(fetcher.mock.calls[1][1].redirect).toBe("manual");
  });
  it("does not forward the channel token through a redirect", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://8.8.8.8/audio" })))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://1.1.1.1/stolen" } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadMedia("media-a", channel)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("refuses private media destinations before sending credentials there", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ url: "http://127.0.0.1/audio" })));
    vi.stubGlobal("fetch", fetcher);
    expect(await downloadMedia("media-a", channel)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes a rejected audio send from unknown delivery after a network failure", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported media", code: 131053 } }), { status: 400 }))
      .mockRejectedValueOnce(new Error("Connection closed"));
    vi.stubGlobal("fetch", fetcher);
    const rejected = await sendMedia("15550000", "audio", "https://media.example/audio.mp3", undefined, channel);
    expect(rejected.error).toBe("Unsupported media"); expect(rejected.deliveryUnknown).not.toBe(true);
    const unknown = await sendMedia("15550000", "audio", "https://media.example/audio.mp3", undefined, channel);
    expect(unknown.deliveryUnknown).toBe(true);
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
