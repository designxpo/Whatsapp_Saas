import crypto from "crypto";

function constEq(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export function apiKeyOk(req: Request): boolean {
  return constEq(bearer(req), process.env.BROADCAST_API_KEY);
}

export function cronOk(req: Request): boolean {
  return constEq(bearer(req), process.env.CRON_SECRET);
}
