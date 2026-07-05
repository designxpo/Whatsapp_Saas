import { NextResponse } from "next/server";
import { isPlatformOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Meta connection doctor — diagnoses exactly why "Connect with Facebook"
// (WhatsApp / Instagram embedded signup) or the channel webhooks aren't working.
// Checks every required env var (distinguishing MISSING from SET-BUT-EMPTY — the
// classic silent failure), live-validates the app credentials against the Graph
// API, and prints the exact webhook callback URLs + verify token status to paste
// into the Meta app dashboard. Read-only; never returns secret values.

type Status = "ok" | "warn" | "error";
type Check = { key: string; title: string; status: Status; detail: string; hint?: string };

// unset (name absent) vs empty (name present, value "") vs set.
function env(name: string): "set" | "empty" | "unset" {
  const v = process.env[name];
  if (v === undefined) return "unset";
  return v.trim() === "" ? "empty" : "set";
}
const bad = (s: "set" | "empty" | "unset") => s !== "set";
const describe = (names: string[]) =>
  names.map(n => `${n}: ${env(n) === "set" ? "✓" : env(n) === "empty" ? "SET BUT EMPTY" : "missing"}`).join(" · ");

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;

// Live check: do the App ID + App Secret actually work? (client_credentials
// returns an app token only for valid pairs.) Then fetch the app's name so the
// operator can confirm it's the right app.
async function checkAppCredentials(): Promise<Check> {
  const key = "graph_credentials", title = "Meta app credentials (live Graph check)";
  if (bad(env("META_APP_ID")) || bad(env("META_APP_SECRET"))) {
    return { key, title, status: "error", detail: describe(["META_APP_ID", "META_APP_SECRET"]), hint: "Fill both values from Meta app dashboard → Settings → Basic, then restart/redeploy." };
  }
  try {
    const u = new URL(`${GRAPH}/oauth/access_token`);
    u.searchParams.set("client_id", process.env.META_APP_ID!);
    u.searchParams.set("client_secret", process.env.META_APP_SECRET!);
    u.searchParams.set("grant_type", "client_credentials");
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    if (!r.ok || !j.access_token) {
      return { key, title, status: "error", detail: j.error?.message || `Graph rejected the credentials (${r.status})`, hint: "App ID/Secret pair is wrong — re-copy the App Secret (Show) from the app's Settings → Basic." };
    }
    const app = await fetch(`${GRAPH}/${process.env.META_APP_ID}?fields=name&access_token=${j.access_token}`, { signal: AbortSignal.timeout(8000) }).then(x => x.json()).catch(() => null);
    return { key, title, status: "ok", detail: app?.name ? `Valid — app “${app.name}” (${process.env.META_APP_ID})` : "Credentials valid" };
  } catch (e) {
    return { key, title, status: "warn", detail: `Could not reach the Graph API: ${e instanceof Error ? e.message : "network error"}`, hint: "Transient network issue — run the doctor again." };
  }
}

// Owner-only: env diagnostics are platform-operator information — tenant
// admins get a 403 and the Setup tab simply hides the panel.
export async function GET(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: "Owner only" }, { status: 403 });

  const site = process.env.NEXT_PUBLIC_SITE_URL || `https://${req.headers.get("host") ?? "your-domain"}`;
  const checks: Check[] = [];

  // 1. WhatsApp embedded signup (the "Connect with Facebook" button on Settings).
  {
    const names = ["NEXT_PUBLIC_META_APP_ID", "NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID", "META_APP_ID", "META_APP_SECRET"];
    const missing = names.filter(n => bad(env(n)));
    checks.push({
      key: "whatsapp_signup", title: "WhatsApp “Connect with Facebook” (embedded signup)",
      status: missing.length ? "error" : "ok",
      detail: describe(names),
      hint: missing.length
        ? `Fill: ${missing.join(", ")}. NEXT_PUBLIC_* values are baked into the build — on Vercel, add them to the project env AND redeploy.`
        : undefined,
    });
  }

  // 2. Instagram embedded signup.
  {
    const names = ["NEXT_PUBLIC_META_APP_ID", "NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID", "META_APP_ID", "META_APP_SECRET"];
    const missing = names.filter(n => bad(env(n)));
    checks.push({
      key: "instagram_signup", title: "Instagram “Connect with Facebook” (embedded signup)",
      status: missing.length ? "error" : "ok",
      detail: describe(names),
      hint: missing.length ? `Fill: ${missing.join(", ")} (same redeploy rule for NEXT_PUBLIC_*).` : undefined,
    });
  }

  // 3. Live app-credential validation.
  checks.push(await checkAppCredentials());

  // 4. WhatsApp webhook (handshake + signature).
  {
    const verifyOk = !bad(env("META_WA_WEBHOOK_VERIFY_TOKEN")) || !bad(env("META_WEBHOOK_VERIFY_TOKEN"));
    const sigOk = !bad(env("META_WA_WEBHOOK_SECRET")) || !bad(env("META_APP_SECRET"));
    checks.push({
      key: "wa_webhook", title: "WhatsApp webhook",
      status: verifyOk && sigOk ? "ok" : "error",
      detail: `Callback: ${site}/api/webhooks/whatsapp · verify token ${verifyOk ? "✓" : "MISSING (META_WA_WEBHOOK_VERIFY_TOKEN or META_WEBHOOK_VERIFY_TOKEN)"} · signature secret ${sigOk ? "✓" : "MISSING (META_WA_WEBHOOK_SECRET or META_APP_SECRET)"}`,
      hint: !verifyOk || !sigOk ? "Meta signs webhooks with your App Secret — setting META_APP_SECRET covers the signature check. The verify token is any string you invent; it must match what you paste in the app dashboard → WhatsApp → Configuration." : undefined,
    });
  }

  // 5. Instagram + Messenger webhooks (shared app secret + verify token).
  {
    const verifyOk = !bad(env("META_WEBHOOK_VERIFY_TOKEN"));
    const sigOk = !bad(env("META_APP_SECRET"));
    checks.push({
      key: "ig_ms_webhook", title: "Instagram & Messenger webhooks",
      status: verifyOk && sigOk ? "ok" : "error",
      detail: `Callbacks: ${site}/api/webhooks/instagram + ${site}/api/webhooks/messenger · verify token (META_WEBHOOK_VERIFY_TOKEN) ${verifyOk ? "✓" : "missing"} · app secret (META_APP_SECRET) ${sigOk ? "✓" : "missing/empty"}`,
      hint: !verifyOk || !sigOk ? "Both come from the same Meta app: App Secret from Settings → Basic; the verify token is your own string, pasted identically in each webhook config." : undefined,
    });
  }

  // 6. Single-number env mode (legacy/simple setup) — informational.
  {
    const names = ["META_WA_ACCESS_TOKEN", "META_WA_PHONE_NUMBER_ID", "META_WA_WABA_ID"];
    const set = names.filter(n => env(n) === "set");
    checks.push({
      key: "env_single_number", title: "Single-number env mode (optional)",
      status: set.length === 0 ? "warn" : set.length === names.length ? "ok" : "error",
      detail: set.length === 0 ? "Not configured — fine when every tenant connects their own number via Settings." : describe(names),
      hint: set.length > 0 && set.length < names.length ? "Partially configured — set all three or none." : undefined,
    });
  }

  const worst: Status = checks.some(c => c.status === "error") ? "error" : checks.some(c => c.status === "warn") ? "warn" : "ok";
  return NextResponse.json({ status: worst, site, checks });
}
