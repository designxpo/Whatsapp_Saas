// SSRF guard for server-side fetches of user/tenant-supplied URLs.
//
// Any URL a tenant can set and the server later fetches (KB ingest, flow/AI
// webhooks) must pass assertPublicUrl first, or an attacker can point it at
// cloud metadata (169.254.169.254), localhost, or internal services. We resolve
// the hostname and reject private / loopback / link-local / CGNAT ranges — this
// also defeats DNS names that resolve to internal IPs (DNS rebinding at fetch
// time is further mitigated by re-checking after redirects via safeFetch).

import { lookup } from "dns/promises";
import net from "net";

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
  if (a >= 224) return true;                          // multicast / reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const x = ip.toLowerCase();
  if (x === "::1" || x === "::") return true;          // loopback / unspecified
  if (x.startsWith("fe80")) return true;               // link-local
  if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique local fc00::/7
  if (x.startsWith("::ffff:")) return isPrivateV4(x.slice(7)); // IPv4-mapped
  return false;
}

function isBlockedIp(ip: string): boolean {
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

// fetch() wrapper that validates the URL (and each redirect hop) against the
// SSRF guard. Use for all server-side fetches of tenant-supplied URLs.
export async function safeFetch(raw: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let url = raw;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(url);
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
