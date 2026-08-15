# Meta onboarding & App Review checklist

How to turn on **self-serve "Connect with Facebook"** onboarding so tenants connect
their own WhatsApp / Instagram / Messenger in one click — no IDs or tokens pasted.

> The code is already built (`src/lib/embedded-signup-client.ts`,
> `src/lib/embeddedsignup.ts`, `/api/admin/onboarding/{whatsapp,instagram}`, and the
> "Connect with Facebook" buttons in the WhatsApp Settings & Instagram tabs). The
> buttons are hidden until the env vars in **Step 6** are set in production. Nothing
> below requires code changes.

## ⚠️ Which host goes in which field

There are TWO live origins and they serve different things. Pasting the wrong one
is the single easiest way to stall a review, because Meta validates these URLs by
fetching them and a 404 reads as "the developer didn't provide it":

| Field | Host | Verified |
|---|---|---|
| Privacy Policy, Terms, legal pages | `https://www.thetalko.in/legal/…` | 200 |
| Webhooks, data-deletion callback, all `/api/…` | `https://app.thetalko.in/api/…` | 200 |
| Allowed Domains for the JavaScript SDK | `https://app.thetalko.in` | portal lives here |
| App Domains | `thetalko.in`, `www.thetalko.in`, `app.thetalko.in` | |

Do NOT use `app.thetalko.in/legal/…` — it 404s (legal pages render on the
marketing host only). The older `whatsapp-saas-navy.vercel.app` deployment still
answers for legal pages but **404s on `/api/webhooks/meta-deletion`**, so any app
still pointing its deletion callback there fails Meta's check.

Re-check each URL with `curl -o /dev/null -w '%{http_code}'` before submitting.

---

## Overview — what you're building

You (the operator) become a Meta **Tech Provider**: ONE Meta app with the WhatsApp,
Facebook Login for Business, Instagram, and Messenger products. Each tenant logs in
through a Meta-hosted popup *inside your portal*, authorises their own assets, and the
app stores a per-tenant token (encrypted in the DB) and auto-subscribes their account
to your webhooks. Tenants never visit Business Manager.

**Effort:** ~90% is Meta's verification + App Review process (days to a few weeks).
~10% is pasting config values into Vercel. Plan for the review lead time.

---

## Step 0 — Prerequisites (have these ready)

- [ ] A **Meta Business Manager** account for *your* company (business.facebook.com).
- [ ] A **Facebook Developer** account (developers.facebook.com) under that business.
- [ ] Legal pages live (already shipped):
  - Privacy Policy → `https://www.thetalko.in/legal/privacy`
  - Terms of Service → `https://www.thetalko.in/legal/terms`
- [ ] Access to the **Vercel** project to set environment variables.
- [ ] A screen recording + written steps of the connect flow (App Review needs this).

---

## Step 1 — Create the Meta app (Tech Provider)

1. developers.facebook.com → **My Apps → Create App**.
2. App type: **Business**. Link it to your Business Manager.
3. In **App settings → Basic**, fill:
   - **App Domains:** `thetalko.in`, `www.thetalko.in`, `app.thetalko.in`
   - **Privacy Policy URL:** `https://www.thetalko.in/legal/privacy`
   - **Terms of Service URL:** `https://www.thetalko.in/legal/terms`
   - **User Data Deletion:** either the data-deletion *instructions URL*
     `https://www.thetalko.in/legal/data-deletion` **or** a callback (see Step 7).
     Prefer the callback — Meta validates it by calling it, and a working callback
     is one fewer thing a reviewer can mark incomplete.
   - App icon (1024×1024), category, contact email.
4. Note the **App ID** and **App Secret** (App settings → Basic). → env in Step 6.

---

## Step 2 — Add products

Add these products to the same app (left sidebar → "Add product"):

- [ ] **WhatsApp**
- [ ] **Facebook Login for Business** (powers the Embedded Signup popups)
- [ ] **Instagram** (Instagram API with Instagram Login / messaging)
- [ ] **Messenger**

---

## Step 3 — Configure webhooks

One callback URL per product, all on the app host — so `…` below means
`https://app.thetalko.in`. The **Verify Token** is any random string *you* invent —
it just has to match the env var. Use a strong random value (e.g. `openssl rand -hex 24`).

| Product | Callback URL | Verify token env var | Subscribe to fields |
|---|---|---|---|
| WhatsApp | `…/api/webhooks/whatsapp` | `META_WA_WEBHOOK_VERIFY_TOKEN` | `messages` (+ `message_template_status_update`) |
| Instagram | `…/api/webhooks/instagram` | `META_WEBHOOK_VERIFY_TOKEN` | `messages`, `comments` |
| Messenger | `…/api/webhooks/messenger` | `META_WEBHOOK_VERIFY_TOKEN` | `messages`, `feed` |

Notes:
- Signature verification: WhatsApp uses `META_WA_WEBHOOK_SECRET`; Instagram & Messenger
  use `META_APP_SECRET`. For a single app, **set `META_WA_WEBHOOK_SECRET` to the same
  value as `META_APP_SECRET`**.
- You can reuse the same verify-token string for all three, but they're read from the
  env vars above — set each one.
- Per-tenant WABAs are subscribed to your app automatically by the onboarding route
  (`POST /{waba}/subscribed_apps`), so you only configure the **app-level** callback
  once here.

---

## Step 4 — Request permissions (Advanced Access via App Review)

In **App Review → Permissions and Features**, request **Advanced Access** for:

**WhatsApp**
- [ ] `whatsapp_business_management`
- [ ] `whatsapp_business_messaging`

**Instagram**
- [ ] `instagram_basic`
- [ ] `instagram_manage_messages`
- [ ] `instagram_manage_comments` (comment-to-DM)

**Pages / Messenger**
- [ ] `pages_messaging`
- [ ] `pages_read_engagement`
- [ ] `pages_show_list`
- [ ] `pages_manage_metadata`
- [ ] `business_management`
- [ ] `pages_read_user_content` — needed for comment-to-DM (private reply to a
      comment). Not yet approved for public use as of this writing; the
      Messenger Login config should ship WITHOUT it until Meta approves it
      (see the App Review submission notes below), or every tenant's connect
      flow breaks the same way an earlier unapproved scope did.
- [ ] `pages_manage_engagement` — powers public comment replies + auto-like.
      **Parked**: not currently requested in the Messenger Login config (not
      approved, and the feature is deprioritized for now). Add back to the
      config once approved, if the feature is revived — no code change
      needed, the scope list lives in the Meta config, not in this repo.

For each, provide: a clear use-case description, the screen recording of the connect
flow, and step-by-step reviewer instructions (test login → click "Connect with
Facebook" → select asset → message flows into the inbox).

---

## Step 5 — Create the Embedded Signup configurations

These produce the `config_id`s the front-end popup uses.

1. **WhatsApp Embedded Signup config**
   - In **WhatsApp → Embedded Signup** (or Facebook Login for Business →
     *Configurations* with the WhatsApp permissions), create a configuration.
   - Copy its **Configuration ID** → `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID`.
   - For **coexistence** (the portal's "Connect existing app number" button —
     tenants keep using the WhatsApp Business phone app AND get the API): the
     same config works; the portal passes
     `featureType: "whatsapp_business_app_onboarding"` at launch time. If the
     configuration UI shows a coexistence / "WhatsApp Business app onboarding"
     option, enable it. See the **Coexistence** section below for eligibility.
2. **Instagram/Login config**
   - In **Facebook Login for Business → Configurations**, create a configuration that
     requests the Instagram + Pages permissions from Step 4.
   - Copy its **Configuration ID** → `NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID`.
3. **Messenger (Facebook Page) config**
   - In **Facebook Login for Business → Configurations**, create a configuration
     requesting `pages_show_list`, `pages_messaging`, `pages_read_engagement` (and
     `pages_manage_metadata`, needed for the webhook feed-field subscription).
     Only include `pages_read_user_content` once it's genuinely Approved in App
     Review — see the note in Step 4.
   - Copy its **Configuration ID** → `NEXT_PUBLIC_META_MESSENGER_CONFIG_ID`.
4. In **Facebook Login for Business → Settings**, add to **Allowed Domains for the
   JavaScript SDK:** `https://app.thetalko.in`.

---

## Step 6 — Set environment variables in Vercel (this flips it on)

Vercel → project → **Settings → Environment Variables** → add for **Production** (and
Preview if you want it there too), then **redeploy**.

| Env var | Value | Public? |
|---|---|---|
| `META_APP_ID` | App ID (Step 1) | server |
| `META_APP_SECRET` | App Secret (Step 1) | server |
| `META_WEBHOOK_VERIFY_TOKEN` | your random string (IG/Messenger webhooks) | server |
| `META_WA_WEBHOOK_VERIFY_TOKEN` | your random string (WhatsApp webhook) | server |
| `META_WA_WEBHOOK_SECRET` | = `META_APP_SECRET` (single-app setup) | server |
| `NEXT_PUBLIC_META_APP_ID` | App ID (same as above) | **public** |
| `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID` | WhatsApp config ID (Step 5) | **public** |
| `NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID` | Instagram config ID (Step 5) | **public** |
| `NEXT_PUBLIC_META_MESSENGER_CONFIG_ID` | Messenger config ID (Step 5) | **public** |
| `META_GRAPH_VERSION` | `v22.0` (optional; default) | server |
| `NEXT_PUBLIC_META_GRAPH_VERSION` | `v22.0` (optional; default) | **public** |

The moment `NEXT_PUBLIC_META_APP_ID` + the config IDs are present, the
"Connect with Facebook" buttons appear (gated by `whatsappSignupReady()` /
`instagramSignupReady()` / `facebookSignupReady()` in
`src/lib/embedded-signup-client.ts`). The `NEXT_PUBLIC_*` ones are baked at
build time, so **redeploy** after adding them.

---

## Step 7 — Data deletion callback (built ✓)

Meta prefers a real **Data Deletion Request Callback** over an instructions URL — it's
already implemented:

- **Callback URL:** `https://app.thetalko.in/api/webhooks/meta-deletion`
  → paste this in **App settings → Basic → User Data Deletion → Data Deletion Request URL**.
- It verifies Meta's `signed_request` against `META_APP_SECRET`, records the request
  (table `meta_deletion_requests`, migration **0061**; falls back to the audit log if
  not yet applied), and returns the required `{ url, confirmation_code }` JSON.
- **Status page:** `https://www.thetalko.in/legal/data-deletion?code=…`
  (also reachable without a code as user-facing deletion instructions).

To enable: apply migration `0061_meta_deletion.sql` in Supabase (optional — the
callback works without it) and ensure `META_APP_SECRET` is set (Step 6).

---

## Step 8 — Go Live

- [ ] Toggle the app from **Development** to **Live** (top bar).
- [ ] Complete **Business Verification** (App Review → Business Verification).
- [ ] Confirm Advanced Access is granted for every permission in Step 4.

---

## Step 9 — Verify end-to-end

1. Open the portal → **Setup & status** tab → the **"Connect with Facebook"** button
   should now appear on the WhatsApp and Instagram steps (only for channels the
   tenant's plan includes — the checklist is plan-aware).
2. Click it → complete the Meta popup with a real test asset.
3. Confirm:
   - [ ] A channel row appears (token stored encrypted; never shown).
   - [ ] **Setup & status** marks the channel **Ready** (live Meta verification passes).
   - [ ] Sending a test message to the number/account shows up in **Live Chat** and the
         AI replies (requires the AI key step done too).

---

## Coexistence — "Connect existing app number" (keep the phone app)

The second connect button in Settings → WhatsApp numbers runs Embedded Signup's
**coexistence** flavour: instead of registering a fresh number, the popup shows a
**QR code the tenant scans from their WhatsApp Business phone app**. The number
then works in BOTH places — the app keeps its chats and stays usable, and the
number additionally becomes sendable via Cloud API (AI, broadcasts, Live Chat).

What the portal does differently for a coexistence connect:
- Skips the Cloud API `/register` call (the QR flow registers the number; calling
  `/register` on a coexistence number fails).
- Saves the channel with `coex = true` (shown as an **APP+API** badge) — needs
  migration `0078_coex.sql`.
- Replies the tenant's team sends **from the phone app** reach the portal via the
  `smb_message_echoes` webhook field (subscribe it in Step 3's field list — NOT
  the similarly-named `message_echoes`) and pause the bot for that conversation.

Eligibility (Meta-side, verify current docs — these move):
- The number must be on the **WhatsApp Business app** (not consumer WhatsApp),
  updated to a recent version, in a supported country (India ✓).
- Direction is **app → API only**. A number already registered pure-API cannot
  add the phone app afterward.
- On connect, Meta disables the app's own greeting/away automations — the
  platform's bot/flows take over.

---

## What still needs the tenant (cannot be removed — Meta requires it)

- They authorise with their own Meta login (consent).
- They own/verify the phone number via OTP — you can't register a number they don't control.
- Their own business verification for higher messaging tiers (they can start limited).
- WhatsApp display-name approval is Meta's review.
- They select an existing Facebook Page / Instagram professional account (you can't create it for them).

---

## Quick env reference (copy/paste targets)

```
# Tech Provider app (server-side)
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=
META_WA_WEBHOOK_VERIFY_TOKEN=
META_WA_WEBHOOK_SECRET=        # = META_APP_SECRET for a single app
META_GRAPH_VERSION=v22.0

# Front-end (public, baked at build → redeploy after changing)
NEXT_PUBLIC_META_APP_ID=
NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID=
NEXT_PUBLIC_META_INSTAGRAM_CONFIG_ID=
NEXT_PUBLIC_META_MESSENGER_CONFIG_ID=
NEXT_PUBLIC_META_GRAPH_VERSION=v22.0
```

## Troubleshooting — "Connect with Facebook" does nothing / onboarding fails

Run **Setup → Meta connection doctor** in the portal (platform owner only) — it
checks every env var, live-validates the app credentials against the Graph API,
and prints the exact webhook callback URLs. The classic pitfalls it catches:

1. **Env var set but EMPTY.** `META_APP_ID=` (no value) is treated as *not
   configured* everywhere — the button stays in Preview mode and the code
   exchange fails. Fill real values, don't just scaffold the names.
2. **`NEXT_PUBLIC_*` without a redeploy.** These are baked into the client
   bundle at build time. On Vercel: add them to the project env **and redeploy**
   — changing the env alone does nothing to the already-built site.
3. **Verify-token name mismatch.** The WhatsApp webhook accepts
   `META_WA_WEBHOOK_VERIFY_TOKEN` **or** `META_WEBHOOK_VERIFY_TOKEN` (fallback),
   so one token can serve all three webhooks.
4. **Signature secret.** Meta signs every webhook with the **App Secret**. The
   WhatsApp route accepts `META_WA_WEBHOOK_SECRET` or falls back to
   `META_APP_SECRET` — for a single app, setting `META_APP_SECRET` is enough.
5. **App in Development Mode.** Embedded signup only completes for Facebook
   users with a role on the app (admin/developer/tester). Fine for internal
   testing; real clients need the app Live + Advanced Access (App Review).
