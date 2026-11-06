// @vitest-environment jsdom
// The web-chat widget renders bot/agent replies as HTML (links, media, file
// cards). It also runs INSIDE the logged-in admin portal as the support widget,
// so a reply that turns into a live attribute is script execution in another
// account's session. This runs the real generated loader script in a DOM, feeds
// it hostile replies through the poll endpoint, and checks that nothing becomes
// an event-handler attribute while normal links and media still render.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../brand-lookup", () => ({ brandForTenant: async () => ({ partnerId: null, poweredBy: true }) }));
vi.mock("../channels", () => ({
  getChannelBySiteKey: async () => ({ tenantId: "t1", widgetConfig: {} }),
  sanitizeWidgetConfig: () => ({}),
}));

import { GET } from "../../app/api/widget/[siteKey]/loader.js/route";

type Msg = { id?: string; body?: string; mediaUrl?: string | null; mediaType?: string | null; at?: string };
type Reply = { status: number; data: unknown };

let pollMessages: Msg[] = [];
let messageReply: Reply = { status: 200, data: { ok: true } };

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

async function loaderJs(): Promise<string> {
  const r = await GET(new Request("https://app.thetalko.in/api/widget/k/loader.js"), { params: Promise.resolve({ siteKey: "k" }) });
  return r.text();
}

async function boot(): Promise<HTMLElement> {
  const js = await loaderJs();
  new Function(js)();
  (window as unknown as { AlabsWC: { open: () => void } }).AlabsWC.open();
  await flush();
  return document.querySelector(".twc-body") as HTMLElement;
}

function handlerAttrs(root: Element): string[] {
  const found: string[] = [];
  root.querySelectorAll("*").forEach(el => {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) found.push(`${el.tagName.toLowerCase()}[${a.name}]`);
  });
  return found;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).__alabsWC;
  delete (window as unknown as Record<string, unknown>).AlabsWC;
  try { localStorage.clear(); } catch { /* jsdom storage */ }
  pollMessages = [];
  messageReply = { status: 200, data: { ok: true } };
  vi.stubGlobal("setInterval", () => 0);   // no background polling during a test
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const reply: Reply = String(url).includes("/api/widget/poll")
      ? { status: 200, data: { messages: pollMessages } }
      : messageReply;
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.data };
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("hostile replies stay text", () => {
  it("a quote in a link cannot add an event handler", async () => {
    pollMessages = [
      { id: "m1", body: 'Click https://x.com/"onmouseover="alert(1) now' },
      { id: "m2", body: "Or https://x.com/'onmouseover='alert(2) here" },
    ];
    const body = await boot();
    expect(handlerAttrs(body)).toEqual([]);
    const links = Array.from(body.querySelectorAll("a"));
    expect(links.map(a => a.getAttribute("href"))).toEqual(["https://x.com/", "https://x.com/"]);
    // The rest of the payload is shown as plain text, not dropped or executed.
    expect(body.textContent).toContain('"onmouseover="alert(1) now');
    expect(body.textContent).toContain("'onmouseover='alert(2) here");
  });

  it("a quote in a media URL cannot add onerror to the video/img/audio/file", async () => {
    pollMessages = [
      { id: "v", mediaUrl: 'https://a/x.mp4"onerror="alert(1)', mediaType: "video/mp4" },
      { id: "i", mediaUrl: "https://a/x.jpg' onerror='alert(2)", mediaType: "image/jpeg" },
      { id: "a", mediaUrl: 'https://a/x.ogg"onerror="alert(3)', mediaType: "audio/ogg" },
      { id: "d", mediaUrl: 'https://a/x.pdf"onclick="alert(4)', mediaType: "document" },
    ];
    const body = await boot();
    expect(handlerAttrs(body)).toEqual([]);
    const srcs = [
      body.querySelector("video")?.getAttribute("src"),
      body.querySelector("img")?.getAttribute("src"),
      body.querySelector("audio")?.getAttribute("src"),
      body.querySelector("a.twc-file")?.getAttribute("href"),
    ];
    for (const s of srcs) {
      expect(s).toMatch(/^https:\/\/a\//);
      expect(s).not.toMatch(/["\s]/);
    }
  });

  it("a file-card URL with a quote cannot break out of href", async () => {
    pollMessages = [{ id: "f", body: 'Brochure: https://a/b.pdf"onclick="alert(1)' }];
    const body = await boot();
    expect(handlerAttrs(body)).toEqual([]);
    const card = body.querySelector("a.twc-file");
    expect(card?.getAttribute("href")).toBe("https://a/b.pdf");
  });

  it("javascript: and other non-http media are skipped, not linked", async () => {
    pollMessages = [
      { id: "j", mediaUrl: "javascript:alert(1)", mediaType: "image/png" },
      { id: "j2", mediaUrl: "data:text/html,<script>alert(1)</script>", mediaType: "document", body: "see this" },
    ];
    const body = await boot();
    expect(handlerAttrs(body)).toEqual([]);
    expect(body.querySelectorAll("img, video, audio, a").length).toBe(0);
    expect(body.textContent).toContain("see this");   // the text part of the reply still shows
    expect(body.innerHTML).not.toContain("javascript:");
  });

  it("markup in a reply is escaped, not parsed", async () => {
    pollMessages = [{ id: "h", body: "<img src=x onerror=alert(1)> & <b>hi</b>" }];
    const body = await boot();
    expect(handlerAttrs(body)).toEqual([]);
    expect(body.textContent).toContain("<img src=x onerror=alert(1)> & <b>hi</b>");
  });
});

describe("normal replies still look the same", () => {
  it("renders links, WhatsApp markup, file cards and media", async () => {
    pollMessages = [
      { id: "n1", body: "Hi *there* _friend_ ~old~ see https://www.example.com/page?a=1&b=2 and https://cdn.example.com/brochure.pdf" },
      { id: "n2", mediaUrl: "https://cdn.example.com/clip.mp4", mediaType: "video/mp4" },
      { id: "n3", mediaUrl: "https://cdn.example.com/photo.jpg", mediaType: "image/jpeg" },
      { id: "n4", mediaUrl: "https://cdn.example.com/voice.ogg", mediaType: "audio/ogg" },
    ];
    const body = await boot();
    const link = body.querySelector('a[href^="https://www.example.com"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://www.example.com/page?a=1&b=2");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toBe("example.com/page ↗");
    expect(body.querySelector("b")?.textContent).toBe("there");
    expect(body.querySelector("i")?.textContent).toBe("friend");
    expect(body.querySelector("s")?.textContent).toBe("old");
    expect(body.querySelector("a.twc-file")?.getAttribute("href")).toBe("https://cdn.example.com/brochure.pdf");
    expect(body.querySelector("video")?.getAttribute("src")).toBe("https://cdn.example.com/clip.mp4");
    expect(body.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.com/photo.jpg");
    expect(body.querySelector("audio")?.getAttribute("src")).toBe("https://cdn.example.com/voice.ogg");
  });
});

describe("when the server says slow down", () => {
  async function sendHi(body: HTMLElement) {
    const input = document.querySelector(".twc-foot input") as HTMLInputElement;
    input.value = "hello there";
    (document.querySelector(".twc-send") as HTMLButtonElement).click();
    await flush();
    return { input, body };
  }

  it("a 429 shows a calm line and gives the message back to resend", async () => {
    messageReply = { status: 429, data: { error: "Too many messages" } };
    const { input, body } = await sendHi(await boot());
    expect(body.querySelector(".twc-sys")?.textContent).toMatch(/Too many messages right now\. Please wait a moment/);
    expect(body.querySelector(".twc-typing")).toBeNull();
    expect((document.querySelector(".twc-send") as HTMLButtonElement).disabled).toBe(false);
    expect(input.value).toBe("hello there");
  });

  it("any other failed response says something went wrong instead of going quiet", async () => {
    messageReply = { status: 500, data: { error: "boom" } };
    const { body } = await sendHi(await boot());
    expect(body.textContent).toContain("Sorry, something went wrong. Please try again.");
    expect(body.querySelector(".twc-typing")).toBeNull();
  });

  it("a normal reply still renders", async () => {
    messageReply = { status: 200, data: { ok: true, messages: [{ id: "r1", body: "Hello! How can I help?" }] } };
    const { body } = await sendHi(await boot());
    expect(body.textContent).toContain("Hello! How can I help?");
    expect(body.querySelector(".twc-sys")).toBeNull();
  });
});
