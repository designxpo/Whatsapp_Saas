// Meta WhatsApp Embedded Signup — per-tenant WABA onboarding.
//
// Flow (Tech Provider app):
//   1. Frontend opens FB.login({ config_id: META_EMBEDDED_SIGNUP_CONFIG_ID,
//      response_type: 'code', override_default_response_type: true }). The
//      WhatsApp Embedded Signup dialog returns an authorization `code`, and a
//      `message` event carries sessionInfo { waba_id, phone_number_id }.
//   2. Frontend POSTs { code, wabaId, phoneNumberId, name } to
//      /api/admin/onboarding/whatsapp.
//   3. This module exchanges the code for a long-lived business token, subscribes
//      our app to the tenant's WABA webhooks, and (best-effort) registers the
//      number. The caller persists the result via saveChannel (token encrypted).
//
// Requires env: META_APP_ID, META_APP_SECRET (separate Tech Provider app).

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v22.0"}`;

export interface ExchangeResult {
  ok: boolean;
  token?: string;
  error?: string;
}

// Exchange the Embedded Signup authorization code for a business access token.
export async function exchangeSignupCode(code: string): Promise<ExchangeResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return { ok: false, error: "META_APP_ID / META_APP_SECRET not configured" };
  if (!code) return { ok: false, error: "Missing signup code" };

  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);

  try {
    const r = await fetch(url, { method: "GET" });
    const j = await r.json();
    if (!r.ok || !j.access_token) {
      return { ok: false, error: j.error?.message || `Token exchange failed (${r.status})` };
    }
    return { ok: true, token: j.access_token as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Token exchange error" };
  }
}

// Subscribe our app to the tenant's WABA so inbound messages hit our webhook.
export async function subscribeWaba(wabaId: string, token: string): Promise<{ ok: boolean; error?: string }> {
  if (!wabaId || !token) return { ok: false, error: "Missing wabaId / token" };
  try {
    const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    if (!r.ok || j.success === false) return { ok: false, error: j.error?.message || `Subscribe failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Subscribe error" };
  }
}

// Register the phone number on Cloud API (best-effort; some flows pre-register).
export async function registerPhone(phoneNumberId: string, token: string, pin?: string): Promise<{ ok: boolean; error?: string }> {
  if (!phoneNumberId || !token) return { ok: false, error: "Missing phoneNumberId / token" };
  try {
    const r = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin: pin || "000000" }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.error?.message || `Register failed (${r.status})` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Register error" };
  }
}
