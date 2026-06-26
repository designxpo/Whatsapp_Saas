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
//   NEXT_PUBLIC_META_GRAPH_VERSION               (optional, defaults v22.0)

const GRAPH_VERSION = process.env.NEXT_PUBLIC_META_GRAPH_VERSION || "v22.0";
const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const WA_CONFIG_ID = process.env.NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID;
const IG_CONFIG_ID = process.env.NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID;

interface FbLoginResponse { authResponse?: { code?: string } | null; status?: string }
interface FbLoginOptions {
  config_id: string;
  response_type: "code";
  override_default_response_type: boolean;
  extras?: Record<string, unknown>;
}
interface FbSdk {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (r: FbLoginResponse) => void, opts: FbLoginOptions): void;
}
declare global {
  interface Window { FB?: FbSdk; fbAsyncInit?: () => void }
}

export const whatsappSignupReady = () => !!APP_ID && !!WA_CONFIG_ID;
export const instagramSignupReady = () => !!APP_ID && !!IG_CONFIG_ID;

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

// WhatsApp Embedded Signup → { code, wabaId, phoneNumberId }.
export async function launchWhatsAppSignup(): Promise<{ code: string; wabaId: string; phoneNumberId: string }> {
  await loadSdk();
  if (!WA_CONFIG_ID) throw new Error("WhatsApp Embedded Signup is not configured yet");
  return new Promise((resolve, reject) => {
    let session: { wabaId?: string; phoneNumberId?: string } = {};
    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.data) {
          session = { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id };
        }
      } catch { /* non-JSON message from the popup — ignore */ }
    };
    window.addEventListener("message", onMessage);
    window.FB!.login((response) => {
      window.removeEventListener("message", onMessage);
      const code = response?.authResponse?.code;
      if (!code) return reject(new Error("Sign-up was cancelled"));
      if (!session.wabaId || !session.phoneNumberId) {
        return reject(new Error("Meta did not return the WhatsApp account details — please complete the whole flow"));
      }
      resolve({ code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId });
    }, {
      config_id: WA_CONFIG_ID,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
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
