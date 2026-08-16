import { NextResponse } from "next/server";
import { getPublicStatus } from "@/lib/publicstatus";

export const dynamic = "force-dynamic";

// GET — public, unauthenticated system status. Returns ONLY the shared
// background-job heartbeat, nothing tenant-identifying (contrast with
// /api/owner/health, which is owner-gated and full of per-tenant detail —
// that route must never be exposed here, even partially).
// Which commit is actually SERVING. "I pushed a fix" and "the fix is live" are
// different facts, and repeatedly conflating them cost several rounds of
// debugging a Meta connect flow that was fixed in the repo and still broken in
// the browser. Vercel injects these at build time; locally they're absent.
// Deliberately just the sha, the ref and the build time — enough to answer
// "is my fix live?" and nothing that describes a tenant.
function build() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null;
  return {
    commit: sha ? sha.slice(0, 7) : null,
    ref: process.env.VERCEL_GIT_COMMIT_REF || null,
    env: process.env.VERCEL_ENV || (process.env.NODE_ENV === "production" ? "production" : "development"),
  };
}

export async function GET() {
  const status = await getPublicStatus();
  return NextResponse.json({ ...status, build: build() });
}
