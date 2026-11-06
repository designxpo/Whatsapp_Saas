import { describe, it, expect } from "vitest";
import { assertPublicUrl, readCappedBytes, stripCredentialHeaders, isCredentialHeader, sameSiteRedirect } from "@/lib/ssrf";

// All cases use literal IPs or special hostnames so the guard never performs a
// real DNS lookup — the tests are fully offline and deterministic.

describe("assertPublicUrl — blocks unsafe targets", () => {
  const blocked = [
    "http://169.254.169.254/latest/meta-data/",   // cloud metadata (IMDS)
    "http://127.0.0.1/",                            // loopback
    "http://10.0.0.5/",                             // private 10/8
    "http://172.16.4.4/",                           // private 172.16/12
    "http://192.168.1.10/",                         // private 192.168/16
    "http://100.64.0.1/",                           // CGNAT
    "http://0.0.0.0/",                              // unspecified
    "https://[::1]/",                               // IPv6 loopback
    "https://[fd00::1]/",                           // IPv6 unique-local
    "http://localhost/admin",                       // localhost name
    "http://service.internal/",                     // .internal suffix
  ];
  for (const url of blocked) {
    it(`rejects ${url}`, async () => {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    });
  }

  it("rejects non-http(s) protocols", async () => {
    await expect(assertPublicUrl("ftp://example.com/x")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("rejects a malformed URL", async () => {
    await expect(assertPublicUrl("not a url")).rejects.toThrow();
  });
});

describe("readCappedBytes", () => {
  it("preserves binary media without text decoding", async () => {
    const bytes = new Uint8Array([0, 255, 128, 17]);
    expect(await readCappedBytes(new Response(bytes), 4)).toEqual(Buffer.from(bytes));
  });
  it("cancels a lying stream as soon as the accumulated limit is crossed", async () => {
    let delivered = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { delivered++; controller.enqueue(new Uint8Array([0, 1, 2, 3])); },
      cancel() { cancelled = true; },
    });
    await expect(readCappedBytes(new Response(body, { headers: { "content-length": "1" } }), 5)).rejects.toThrow(/too large/);
    expect(cancelled).toBe(true); expect(delivered).toBeLessThan(5);
    expect(body.locked).toBe(false);
  });
  it("aborts a pending read and releases the stream lock", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const controller = new AbortController();
    const pending = readCappedBytes(new Response(body), 100, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true); expect(body.locked).toBe(false);
  });
});

describe("assertPublicUrl — allows public literal IPs", () => {
  it("accepts a public IPv4 literal", async () => {
    const u = await assertPublicUrl("https://8.8.8.8/path");
    expect(u.hostname).toBe("8.8.8.8");
  });
});

describe("readCapped — a tenant URL cannot make the server hold an unbounded body", async () => {
  const { readCapped } = await import("@/lib/ssrf");
  it("reads a body under the limit", async () => {
    expect(await readCapped(new Response("hello"), 10)).toBe("hello");
  });
  it("refuses a declared length over the limit before reading", async () => {
    await expect(readCapped(new Response("x".repeat(20), { headers: { "content-length": "20" } }), 10)).rejects.toThrow(/too large/);
  });
  it("refuses a body that grows past the limit with no declared length", async () => {
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new TextEncoder().encode("abcd")); c.close(); } });
    await expect(readCapped(new Response(stream), 10)).rejects.toThrow(/too large/);
  });
});

describe("stripCredentialHeaders — a cross-origin redirect never carries our credentials", () => {
  const sent = {
    Authorization: "Basic Y2s6Y3M=",
    "X-Shopify-Access-Token": "shpat_secret",
    Cookie: "sid=1",
    "Proxy-Authorization": "Basic x",
    "X-API-Key": "k",
    "api-key": "k2",
    "X-Talko-Signature": "sha256=abc",
    "Content-Type": "application/json",
    "User-Agent": "Talko",
  };
  const kept = (h: Headers) => [...h.keys()].sort();

  it("drops credentials from a plain object, case-insensitively", () => {
    expect(kept(stripCredentialHeaders(sent))).toEqual(["content-type", "user-agent", "x-talko-signature"]);
  });

  it("drops credentials from an array of pairs", () => {
    expect(kept(stripCredentialHeaders(Object.entries(sent)))).toEqual(["content-type", "user-agent", "x-talko-signature"]);
  });

  it("drops credentials from a Headers object without mutating it", () => {
    const h = new Headers(sent);
    expect(kept(stripCredentialHeaders(h))).toEqual(["content-type", "user-agent", "x-talko-signature"]);
    expect(h.get("authorization")).toBe("Basic Y2s6Y3M=");
  });

  it("copes with no headers at all", () => {
    expect(kept(stripCredentialHeaders(undefined))).toEqual([]);
  });

  it("knows which names are credentials", () => {
    for (const n of ["AUTHORIZATION", "x-access-token", "x-auth-token", "x-goog-api-key", "X-Secret"]) expect(isCredentialHeader(n), n).toBe(true);
    for (const n of ["accept", "content-type", "x-request-id", "user-agent", "x-forwarded-for", "x-talko-signature"]) expect(isCredentialHeader(n), n).toBe(false);
  });
});

describe("sameSiteRedirect — which redirects keep the credentials", () => {
  const u = (x: string) => new URL(x);
  it("keeps them for the usual redirects a shop's own server sends", () => {
    expect(sameSiteRedirect(u("http://shop.in/wp-json"), u("https://shop.in/wp-json"))).toBe(true);
    expect(sameSiteRedirect(u("https://shop.in/a"), u("https://www.shop.in/a"))).toBe(true);
    expect(sameSiteRedirect(u("https://www.shop.in/a"), u("https://shop.in/b"))).toBe(true);
  });
  it("drops them for another host, a downgrade or another port", () => {
    expect(sameSiteRedirect(u("https://shop.in/a"), u("https://evil.example/a"))).toBe(false);
    expect(sameSiteRedirect(u("https://shop.in/a"), u("https://shop.in.evil.example/a"))).toBe(false);
    expect(sameSiteRedirect(u("https://shop.in/a"), u("http://shop.in/a"))).toBe(false);
    expect(sameSiteRedirect(u("https://shop.in/a"), u("https://shop.in:8443/a"))).toBe(false);
  });
});
