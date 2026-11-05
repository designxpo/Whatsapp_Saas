// SSRF guard for server-side fetches of user/tenant-supplied URLs.
//
// Any URL a tenant can set and the server later fetches (KB ingest, flow/AI
// webhooks) must pass assertPublicUrl first, or an attacker can point it at
// cloud metadata (169.254.169.254), localhost, or internal services. We resolve
// the hostname and reject private / loopback / link-local / CGNAT ranges — this
// also defeats DNS names that resolve to internal IPs (DNS rebinding at fetch
// time is further mitigated by re-checking after redirects via safeFetch).

import { lookup } from "dns/promises";
import dns from "dns";
import net from "net";
import { Agent } from "undici";

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true; // be safe
  const [a, b] = p;
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 127) return true;                         // loopback
  if (a === 0) return true;                           // 0.0.0.0/8
  if (a === 169 && b === 254) return true;            // link-local + AWS/GCP metadata
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;            // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;  // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true;  // 192.0.0.0/24 IETF, 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;                 // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && p[2] === 100) return true;               // TEST-NET-2
  if (a === 203 && b === 0 && p[2] === 113) return true;                // TEST-NET-3
  if (a >= 224) return true;                          // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;          // loopback / unspecified
  if (x.startsWith("fe80")) return true;               // link-local
  if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique local fc00::/7
  if (x.startsWith("::ffff:")) return isPrivateV4(x.slice(7)); // IPv4-mapped
  // Forms that embed or reach an IPv4 address: IPv4-compatible (::a.b.c.d,
  // ::7f00:1), NAT64 (64:ff9b::/96) and 6to4 (2002::/16). Any of them can
  // land on an internal v4 host, so none is treated as public.
  if (x.startsWith("::")) return true;
  if (x.startsWith("64:ff9b:")) return true;
  if (x.startsWith("2002:")) return true;
  if (x.startsWith("ff")) return true;                 // multicast
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return net.isIPv6(ip) ? isPrivateV6(ip) : isPrivateV4(ip);
}

// Throws if the URL is non-http(s) or resolves to a non-public address.
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  const host = u.hostname;
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("URL host is not allowed");
  }
  // If the host is a literal IP, check it directly; else resolve all addresses.
  const literals = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map(r => r.address);
  if (!literals.length) throw new Error("URL host did not resolve");
  for (const ip of literals) {
    if (isBlockedIp(ip)) throw new Error("URL resolves to a private or reserved address");
  }
  return u;
}

// ── The connection itself is checked, not just a lookup before it ───────────
//
// assertPublicUrl resolves the name and checks the answers — but fetch() then
// resolves the name AGAIN to connect. A hostile DNS server can answer the
// first lookup with a public address and the second with 169.254.169.254 (DNS
// rebinding), and the check would pass while the connection went inside.
//
// This agent runs the check inside the connection's own lookup: whatever
// address the socket is about to connect to is the address that was checked.
// (A literal IP in the URL never reaches a lookup; assertPublicUrl has
// already checked it.)
export const pinnedLookup = ((hostname: string, options: dns.LookupOptions, cb: (err: Error | null, address: string | dns.LookupAddress[], family?: number) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = addrs as dns.LookupAddress[];
    if (!list.length) return cb(new Error("URL host did not resolve"), "", 4);
    if (list.some(a => isBlockedIp(a.address))) return cb(new Error("URL resolves to a private or reserved address"), "", 4);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as unknown as net.LookupFunction;

const pinnedAgent = new Agent({ connect: { lookup: pinnedLookup } });

/** Default limit for one tenant-supplied fetch, end to end. */
export const SAFE_FETCH_TIMEOUT_MS = 15_000;

// fetch() wrapper that validates the URL (and each redirect hop) against the
// SSRF guard, connects only to the address it validated, and gives up after
// SAFE_FETCH_TIMEOUT_MS unless the caller passed its own signal. Use for all
// server-side fetches of tenant-supplied URLs.
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let url = raw;
  const signal = init.signal ?? AbortSignal.timeout(SAFE_FETCH_TIMEOUT_MS);
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(url);
    // The global fetch (Node's bundled undici) with our agent as its dispatcher:
    // the connection goes through pinnedLookup. `dispatcher` is an undici
    // extension to RequestInit, hence the cast.
    const res = await fetch(url, { ...init, signal, redirect: "manual", dispatcher: pinnedAgent } as RequestInit);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

/**
 * Read a response body, refusing one larger than `maxBytes` — counted as the
 * bytes arrive, so a server that lies about (or omits) Content-Length cannot
 * make the function hold a gigabyte in memory.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readCappedBytes(res, maxBytes));
}

/** Bounded binary reads for media; abort also interrupts a pending stream read. */
export async function readCappedBytes(res: Response, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid response size limit");
  signal?.throwIfAborted();
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`Response too large (${declared} bytes; limit ${maxBytes})`);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new Error(`Response too large (over ${maxBytes} bytes)`); }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
