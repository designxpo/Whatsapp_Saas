import { describe, it, expect } from "vitest";
import { assertPublicUrl } from "@/lib/ssrf";

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

describe("assertPublicUrl — allows public literal IPs", () => {
  it("accepts a public IPv4 literal", async () => {
    const u = await assertPublicUrl("https://8.8.8.8/path");
    expect(u.hostname).toBe("8.8.8.8");
  });
});
