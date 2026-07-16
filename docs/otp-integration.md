# WhatsApp OTP — Integration Guide (Talko AI)

Send and verify one-time login codes over **WhatsApp**, powered by your Talko AI
workspace (Meta WhatsApp Cloud API under the hood — no third-party BSP
dependency). Your app calls two HTTPS endpoints; the workspace generates,
delivers (as a Meta *authentication* template), rate-limits, and verifies the code.

> **Server-to-server only.** These endpoints are authenticated with your
> **workspace API key** (`ak_live_…`). Call them from **your backend**, never
> from browser/client code — the key must never ship to a browser.

---

## 1. What you get

- `POST /api/otp/send` — generate a fresh code and WhatsApp it to a phone.
- `POST /api/otp/verify` — check a code the user typed.

The workspace handles everything else: crypto-random codes (stored only as
salted hashes), delivery via an approved Meta template, resend cooldown, daily
caps, attempt caps, and single-use expiry. Codes are isolated per workspace —
your key can only send/verify codes for your own workspace.

**Codes are currently 4 digits and expire in 10 minutes.**

---

## 2. Prerequisites (workspace side — done in the Talko AI portal)

Before your integration will work, the workspace must have:

1. A **workspace API key** created (**Settings → API access → Create key**).
   The full key (`ak_live_…`) is shown **once** at creation — copy it then.
2. The platform env `OTP_HASH_SECRET` set and the OTP migration applied
   (`0076_wa_otp.sql`) — platform-owner tasks; the **Settings → OTP service**
   card shows both as status pills.
3. An **approved** WhatsApp *authentication* template on the sending number's
   WhatsApp Business Account (created from **Settings → OTP service**).
   Approval is per number.
4. If you will route by **area** (multiple numbers), the area → number map
   configured in **Settings → OTP service**.

You do not manage any of this in your app — you only need the base URL, the
API key, and (optionally) the area keys.

---

## 3. Configuration your app needs

| Value | Example | Where it comes from |
|---|---|---|
| **Base URL** | `https://<your-talko-domain>` | Your Talko AI portal's domain |
| **`OTP_API_KEY`** | `ak_live_…` | Workspace API key (Settings → API access) — store in your app's server env |
| **Area key** *(optional)* | `delhi`, `mumbai` | Only if sending from different numbers per region |

Store the key in your server environment (Vercel env var, `.env`, secrets
manager) — **never** in client code, git, or logs.

---

## 4. Authentication

Every request must send the workspace API key as a bearer token:

```
Authorization: Bearer <OTP_API_KEY>
```

- The key is compared by salted hash and **fails closed** — a missing, wrong,
  or revoked key returns `401 Unauthorized`.
- The key identifies your **workspace**: codes you send can only be verified
  with a key from the same workspace.
- Rotating: create a new key in **Settings → API access**, switch your app's
  env to it, then revoke the old one.

---

## 5. Endpoints

### 5.1 `POST /api/otp/send`

Generates a new code and delivers it on WhatsApp.

**Headers**
```
Content-Type: application/json
Authorization: Bearer <OTP_API_KEY>
```

**Body**
```jsonc
{
  "phone": "919555525908",   // required — country code + number, digits (see §7)
  "area": "delhi",           // optional — route to this area's number
  "channelId": "…"           // optional — pin a specific number by id (advanced)
}
```
- Omit `area` and `channelId` → the workspace's **default OTP number** is used.
- If `area` is given but not configured → `400` (never a silent send from the
  wrong number).

**Success — `200`**
```json
{ "success": true, "expiresInMinutes": 10 }
```
> The code itself is **never** returned. It only reaches the user's WhatsApp.

**Errors**

| Status | Body (`error`) | Meaning / what to do |
|---|---|---|
| `400` | `phone required` / `Invalid JSON` | Fix the request |
| `400` | `phone must be 8–15 digits` | Bad phone format (see §7) |
| `400` | `OTP area "x" is not configured` | Add the area in Settings → OTP service, or drop it |
| `400` | `OTP number is not available …` / `No WhatsApp number connected …` | The configured number was removed — fix in Settings |
| `401` | `Unauthorized` | Bad/missing/revoked API key |
| `429` | `resend too soon` (+ `retryAfterSeconds`, `Retry-After` header) | User asked again within the 45s cooldown — wait and retry |
| `429` | `daily OTP limit reached for this phone` | 10 sends/phone/day hit |
| `502` | `send failed: <meta reason>` | Meta rejected delivery (e.g. template not approved on that number) |
| `503` | `OTP service not configured …` / `OTP store not ready …` | Platform setup incomplete — contact the platform owner |

### 5.2 `POST /api/otp/verify`

Checks a code the user submitted. Single-use; 5 wrong guesses invalidate the code.

**Headers** — same as above (`Authorization: Bearer …` required).

**Body**
```json
{ "phone": "919555525908", "code": "1234" }
```

**Response — always `200`** (branch on `valid`)
```json
{ "valid": true }
```
```json
{ "valid": false, "reason": "incorrect" }
```

`reason` values: `incorrect`, `expired`, `no_active_code`, `too_many_attempts`,
`bad_input`, `store_unavailable`.

> `verify` does **not** take `area`/`channelId` — it's keyed by phone and works
> regardless of which number sent the code.

---

## 6. Limits & behaviour (enforced per phone, per workspace)

- **Resend cooldown:** 45 seconds between sends to the same phone.
- **Daily cap:** 10 sends per phone per day.
- **Attempt cap:** 5 wrong guesses per code, then it dies.
- **Expiry:** 10 minutes.
- **Single-use:** a correct verify consumes the code.
- These are **per phone number, across all your sending numbers** — a user
  can't get more by hitting different areas.

Your app should surface these to the user: on `429 resend too soon`, disable the
"Resend" button for `retryAfterSeconds`; after `too_many_attempts` or `expired`,
prompt them to request a new code.

---

## 7. Phone number format

- Send **country code + subscriber number**. The service strips non-digits, so
  `919555525908`, `+91 95555 25908`, and `+919555525908` all normalise to the
  same value. **Recommended:** digits only, with country code, no `+`
  (e.g. `919555525908`). A bare local number without the country code will
  **not** be delivered by Meta.
- Must be **8–15 digits** after stripping.
- Use the **same phone string** for `send` and `verify` (normalisation makes
  formatting differences harmless, but keep it consistent).

---

## 8. End-to-end flow

```
1. User enters phone on your site.
2. Your backend → POST /api/otp/send { phone }            → { success: true }
3. User receives WhatsApp: "1234 is your verification code  [Copy code]"
4. User types the code on your site.
5. Your backend → POST /api/otp/verify { phone, code }    → { valid: true }
6. valid === true → your backend creates the session / logs the user in.
```

**Your backend owns the security decision** (creating the session). The service
only tells you whether the code was valid.

---

## 9. Code examples

### 9.1 Node / TypeScript (fetch)

```ts
const OTP_BASE = process.env.OTP_BASE_URL!;   // e.g. https://<your-talko-domain>
const OTP_KEY = process.env.OTP_API_KEY!;     // workspace API key — server env only
const H = { "Content-Type": "application/json", Authorization: `Bearer ${OTP_KEY}` };

async function otpSend(phone: string, area?: string) {
  const res = await fetch(`${OTP_BASE}/api/otp/send`, {
    method: "POST", headers: H,
    body: JSON.stringify({ phone, ...(area ? { area } : {}) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `send failed (${res.status})`);
  return data as { success: true; expiresInMinutes: number };
}

async function otpVerify(phone: string, code: string): Promise<boolean> {
  const res = await fetch(`${OTP_BASE}/api/otp/verify`, {
    method: "POST", headers: H,
    body: JSON.stringify({ phone, code }),
  });
  const data = await res.json();               // always 200 for auth'd calls
  return data.valid === true;
}
```

### 9.2 Next.js — API route handlers (App Router)

Expose thin routes in *your* app so your frontend never sees the key:

```ts
// app/api/otp/send/route.ts
import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const { phone, area } = await req.json();
  const r = await fetch(`${process.env.OTP_BASE_URL}/api/otp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OTP_API_KEY}` },
    body: JSON.stringify({ phone, ...(area ? { area } : {}) }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
```
```ts
// app/api/otp/verify/route.ts
import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const { phone, code } = await req.json();
  const r = await fetch(`${process.env.OTP_BASE_URL}/api/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OTP_API_KEY}` },
    body: JSON.stringify({ phone, code }),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
```
Your React form then calls **your** `/api/otp/*` (same-origin) — the key stays
on the server.

### 9.3 cURL (quick test)

```bash
# send
curl -sS -X POST "$OTP_BASE_URL/api/otp/send" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OTP_API_KEY" \
  -d '{"phone":"919555525908"}'

# verify
curl -sS -X POST "$OTP_BASE_URL/api/otp/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OTP_API_KEY" \
  -d '{"phone":"919555525908","code":"1234"}'
```

---

## 10. Security checklist for the integrating app

- [ ] `OTP_API_KEY` lives in **server** env only — never in client bundles, git, or logs.
- [ ] All OTP calls are made from your **backend** (or a same-origin server route), never the browser.
- [ ] Never log the code or the full phone number (log last 4 digits if needed).
- [ ] Always use **HTTPS**.
- [ ] Treat `verify → { valid: true }` as the *only* trigger for creating a session; don't trust client-reported success.
- [ ] Handle `429` gracefully (cooldown timer, "resend in Ns").
- [ ] If the key is ever exposed, create a new key and **revoke** the old one in Settings → API access.

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` | API key missing/wrong/revoked, or not sent as `Authorization: Bearer …` |
| `503 OTP service not configured` | Platform has no `OTP_HASH_SECRET` set (owner task) |
| `503 OTP store not ready` | Migration `0076_wa_otp.sql` not applied (owner task) |
| `502 send failed: …` | Meta rejected — usually the auth template isn't APPROVED on that number's WABA |
| `400 OTP area "x" is not configured` | Area key not set up in Settings → OTP service |
| `400 OTP number is not available` | The configured number was deleted/changed — re-pick in Settings → OTP service |
| Code never arrives on WhatsApp but API said `success` | Template approved but the number has a delivery/quality issue, or the phone number is missing its country code, or the phone hasn't accepted WhatsApp |
