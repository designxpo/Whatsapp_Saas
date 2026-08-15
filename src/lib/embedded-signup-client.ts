// Client-side Meta Embedded Signup launchers. Loads the Facebook JS SDK once,
// then opens the Meta-hosted popup INSIDE the portal — the tenant authenticates
// with their own Meta account and never visits Business Manager. The popup
// returns an authorization `code` (and, for WhatsApp, a sessionInfo message with
// waba_id + phone_number_id) which the caller POSTs to the onboarding route.
//
// Requires (public) env, set once the operator is an approved Tech Provider:
//   NEXT_PUBLIC_META_APP_ID
//   NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID   (WhatsApp config)
//   NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID         (Instagram config)
//   NEXT_PUBLIC_META_MESSENGER_CONFIG_ID         (Facebook Page config)
//   NEXT_PUBLIC_META_GRAPH_VERSION               (optional, defaults v22.0)

const GRAPH_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || "v22.0";
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const WA_CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
const IG_CONFIG_ID = process.env.NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID;
const FB_CONFIG_ID = process.env.NEXT_PUBLIC_META_MESSENGER_CONFIG_ID;

interface FbLoginResponse { authResponse?: { code?: string; accessToken?: string } | null; status?: string }
interface FbBusinessLoginOptions {
  config_id: string;
  response_type: "code";
  override_default_response_type: boolean;
  extras?: Record<string, unknown>;
}
interface FbSdk {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, opts: FbBusinessLoginOptions): void;
}
declare global {
  interface Window { FB?: FbSdk; fbAsyncInit?: () => void }
}

export const whatsappSignupReady = () => !!APP_ID && !!WA_CONFIG_ID;
export const instagramSignupReady = () => !!APP_ID && !!IG_CONFIG_ID;
export const facebookSignupReady = () => !!APP_ID && !!FB_CONFIG_ID;

// Which NEXT_PUBLIC_* values are absent (unset OR empty — both are baked into
// the client bundle at build time, so fixing them requires a redeploy).
export const whatsappSignupMissing = (): string[] =>
  [!APP_ID && "NEXT_PUBLIC_META_APP_ID", !WA_CONFIG_ID && "NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID"].filter(Boolean) as string[];
export const instagramSignupMissing = (): string[] =>
  [!APP_ID && "NEXT_PUBLIC_META_APP_ID", !IG_CONFIG_ID && "NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID"].filter(Boolean) as string[];
export const facebookSignupMissing = (): string[] =>
  [!APP_ID && "NEXT_PUBLIC_META_APP_ID", !FB_CONFIG_ID && "NEXT_PUBLIC_META_MESSENGER_CONFIG_ID"].filter(Boolean) as string[];

// Preview mode (NEXT_PUBLIC_META_PREVIEW=1): render the "Connect with Facebook"
// buttons even before the Meta Tech Provider app is configured, so the operator
// can see their placement. Clicking shows a "setup pending" message rather than
// launching (the real flow needs APP_ID + a config_id). Remove the env var to hide.
export const metaPreview = () => process.env.NEXT_PUBLIC_META_PREVIEW === "1";

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in a browser"));
  if (window.FB) return Promise.resolve();
  if (!APP_ID) return Promise.reject(new Error("NEXT_PUBLIC_META_APP_ID is not set"));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID!, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => { sdkPromise = null; reject(new Error("Failed to load the Facebook SDK")); };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

// Signup flavours:
//  • "new"  — register a fresh (or API-only) number inside the popup (default).
//  • "coex" — coexistence: connect a number that STAYS on the WhatsApp Business
//    phone app. The popup shows a QR code the user scans from the app; chats and
//    the app keep working, and the number additionally becomes usable via Cloud
//    API. Meta only supports this direction (app → API), never API → app.
export type WaSignupVariant = "new" | "coex";

// extras passed to FB.login — pure so the variant mapping is unit-testable.
export function signupExtras(variant: WaSignupVariant): { setup: Record<string, never>; featureType: string; sessionInfoVersion: string } {
  return {
    setup: {},
    featureType: variant === "coex" ? "whatsapp_business_app_onboarding" : "",
    sessionInfoVersion: "3",
  };
}

// WhatsApp Embedded Signup → { code, wabaId, phoneNumberId }.
export async function launchWhatsAppSignup(variant: WaSignupVariant = "new"): Promise<{ code: string; wabaId: string; phoneNumberId: string }> {
  await loadSdk();
  if (!WA_CONFIG_ID) throw new Error("WhatsApp Embedded Signup is not configured yet");
  return new Promise((resolve, reject) => {
    let session: { wabaId?: string; phoneNumberId?: string } = {};
    const seen: string[] = [];   // WA_EMBEDDED_SIGNUP events, for diagnosis on failure
    const onMessage = (event: MessageEvent) => {
      // https + exact facebook.com or a *.facebook.com subdomain — never a
      // lookalike like "evilfacebook.com", and never a throw: opaque origins
      // ("null" from sandboxed iframes) would crash a bare new URL().
      if (typeof event.origin !== "string") return;
      let origin: URL;
      try { origin = new URL(event.origin); } catch { return; }
      if (origin.protocol !== "https:" || !/(^|\.)facebook\.com$/.test(origin.hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP") {
          seen.push(String(data?.event ?? "?"));
          // Accumulate — waba_id and phone_number_id can arrive in separate messages.
          if (data?.data?.waba_id) session.wabaId = data.data.waba_id;
          if (data?.data?.phone_number_id) session.phoneNumberId = data.data.phone_number_id;
        }
      } catch { /* non-JSON message from the popup — ignore */ }
    };
    window.addEventListener("message", onMessage);
    window.FB!.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) { window.removeEventListener("message", onMessage); return reject(new Error("Sign-up was cancelled")); }
      // The WA_EMBEDDED_SIGNUP sessionInfo message can land a beat AFTER the
      // FB.login callback fires (a known ES race) — poll briefly for it instead
      // of checking once, so a completed flow isn't wrongly rejected.
      const start = Date.now();
      const poll = () => {
        if (session.wabaId && session.phoneNumberId) {
          window.removeEventListener("message", onMessage);
          return resolve({ code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId });
        }
        if (Date.now() - start > 5000) {
          window.removeEventListener("message", onMessage);
          if (typeof console !== "undefined") console.warn("[EmbeddedSignup] no account details after 5s — WA_EMBEDDED_SIGNUP events seen:", seen, "partial session:", session);
          return reject(new Error("Meta did not return the WhatsApp account details — please complete the whole flow"));
        }
        setTimeout(poll, 120);
      };
      poll();
    }, {
      config_id: WA_CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: signupExtras(variant),
    });
  });
}

// Instagram Embedded Signup → { code }. The IG account + Page are resolved
// server-side from the exchanged token (see the onboarding route).
export async function launchInstagramSignup(): Promise<{ code: string }> {
  await loadSdk();
  if (!IG_CONFIG_ID) throw new Error("Instagram Embedded Signup is not configured yet");
  return new Promise((resolve, reject) => {
    window.FB!.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) return reject(new Error("Sign-up was cancelled"));
      resolve({ code });
    }, {
      config_id: IG_CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
    });
  });
}

// Facebook Login for Business (Messenger Page channel) → { code }. The Page(s)
// are resolved server-side from the exchanged token (see the onboarding route),
// same as Instagram. Re-invoked (no re-consent) when the user picks among
// multiple Pages — a Login-for-Business code is single-use, so a fresh popup
// call mints a fresh one, exactly like WhatsApp's "coex" retry already does.
export async function launchFacebookSignup(): Promise<{ code: string }> {
  await loadSdk();
  if (!FB_CONFIG_ID) throw new Error("Facebook Page sign-up is not configured yet");
  return new Promise((resolve, reject) => {
    window.FB!.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) return reject(new Error("Sign-in was cancelled, or no Page access was granted"));
      resolve({ code });
    }, {
      config_id: FB_CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
    });
  });
}
