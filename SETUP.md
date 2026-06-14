# Alabs Connect — Go-Live Setup

Current status (2026-06-12): **code, database (all migrations 0001–0013), and
Gemini AI are done.** What remains is the Meta/WhatsApp side, secret rotation,
deployment, and the webhook handshake. Parts A–E below take it to fully live.

---

## Part A — Meta / WhatsApp (the only real blocker; ≈1–2 days incl. verification)

### A1. Business Manager + business verification
1. Go to **business.facebook.com** → use (or create) the company Business Manager.
2. **Settings → Business info → Start verification** — upload GST / CIN /
   utility bill matching the legal business name. Approval: hours to ~2 days.
   - Unverified = capped at **250 conversations/day**. Verified = **Tier 1
     (1,000/day)**, auto-scales to 10K/100K with healthy quality.

### A2. Meta developer app
1. **developers.facebook.com → My Apps → Create App → type "Business"** →
   link it to your Business Manager.
2. Dashboard → **Add product → WhatsApp → Set up**.
3. From **App settings → Basic**, note:
   - **App ID** → `META_WA_APP_ID` (needed for template media uploads)
   - **App Secret** → `META_WA_WEBHOOK_SECRET` (verifies webhook signatures)

### A3. Phone number + WABA
1. App → **WhatsApp → API Setup** (Meta creates a WABA automatically).
2. **Add your real phone number** — it must NOT be active on the WhatsApp /
   WA Business app (migrate it off first if it is). Verify with the OTP.
3. Set the **display name** (e.g. "AnalytixLabs") — approved within hours.
4. From the API Setup page note:
   - **Phone number ID** → `META_WA_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** → `META_WA_WABA_ID`

### A4. Permanent access token (never use the 24-hour test token)
1. **Business Manager → Settings → Users → System users → Add** —
   name `wa-broadcaster`, role **Admin**.
2. **Add assets:** assign the **app** (full control) AND the **WABA** (full control).
3. **Generate token:** select the app, expiry **Never**, permissions:
   `whatsapp_business_messaging` + `whatsapp_business_management`.
4. Copy immediately (shown once) → `META_WA_ACCESS_TOKEN`.

### A5. Billing
**WhatsApp Manager → Billing & payments** → add a payment method. Meta charges
per conversation (India ≈ ₹0.78 marketing / ₹0.30 utility; service replies have
a free monthly tier). Marketing template sends fail without billing.

---

## Part B — Environment variables

### B1. Meta values → `.env.local` (dev) AND Vercel env (prod)
```
META_WA_ACCESS_TOKEN=          ← A4
META_WA_PHONE_NUMBER_ID=       ← A3
META_WA_WABA_ID=               ← A3
META_WA_APP_ID=                ← A2 App ID
META_WA_WEBHOOK_SECRET=        ← A2 App Secret
META_WA_WEBHOOK_VERIFY_TOKEN=  ← any random string YOU invent (reused in Part D)
```

### B2. Rotate the `test-*` placeholders (security)
Generate with `openssl rand -hex 24`:
```
ADMIN_PASSWORD=      ← real portal login
ADMIN_JWT_SECRET=    ← rotate for prod
BROADCAST_API_KEY=   ← external systems → /api/events, /api/broadcast, /api/contacts
CRON_SECRET=         ← guards /api/cron/process-queue
CRM_API_KEY=         ← LSQ automations → /api/crm/send (already random, keep)
CRM_PANEL_TOKEN=     ← /crm/chat embed token (already random, keep)
```

### B3. Production URL — set BEFORE creating click-tracked templates
```
NEXT_PUBLIC_SITE_URL=https://<your-domain>
```
Click-tracking links (`/r/<code>`) are minted on this domain and the dynamic
URL is baked into templates at submission time.

> ⚠ LSQ access keys contain `$` (e.g. `u$rf…`). In `.env.local` escape it as
> `u\$rf…`; in the Vercel UI paste the RAW value (no backslash).

---

## Part C — Deploy to Vercel

1. **vercel.com → Add New → Project** → import `dhaval-alabs/wa-automation`.
2. **Settings → Environment Variables** → paste every var from `.env.example`
   with real values (Production scope).
3. Deploy; attach the custom domain that matches `NEXT_PUBLIC_SITE_URL`.
4. **Cron (queue drain, reminders, API rules, scheduled campaigns):**
   the endpoint is `POST /api/cron/process-queue` guarded by
   `Authorization: Bearer $CRON_SECRET`. Easiest reliable setup: a free
   external pinger (cron-job.org / UptimeRobot) hitting it every minute with
   that header. (Vercel's built-in cron sends unauthenticated GETs, so the
   external pinger is simpler than reworking auth.)

---

## Part D — Webhook handshake

1. Meta app → **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://<your-domain>/api/webhooks/whatsapp`
   - Verify token: exactly your `META_WA_WEBHOOK_VERIFY_TOKEN`
   - **Verify and save** — the deployed app answers the handshake.
2. Under **Webhook fields → Manage**, subscribe to **`messages`** — that one
   field covers inbound texts, button/list replies, WhatsApp-form submissions,
   and delivered/read receipts.

---

## Part E — 15-minute smoke test (in the portal)

1. **Login** with the new password → Home checklist should be all green.
2. **Templates** → create `hello_test` (Utility, body `Hello {{1}}!`) →
   Submit → **Sync Status** until APPROVED (usually minutes).
3. **Broadcast** → audience *recipients* → your own number → `hello_test` →
   Send → message lands on your phone.
4. **Reply** with a course question → AI answers from the knowledge base →
   thread visible in Team Inbox.
5. **Flows** → activate a flow triggered by `hi` → send "hi" → tap buttons;
   type something off-script → AI picks it up.
6. **WhatsApp Forms** → create + publish a form → send via a flow's
   "WhatsApp form" block → submit → answers appear as contact attributes.
7. **Click tracking** → template with URL button + Enable Click Tracking →
   broadcast to yourself → tap → Campaign detail shows Clicked.
8. **LSQ (optional)** → message from a phone that exists as an LSQ lead →
   activity appears on the lead's timeline (activity code 210).

---

## Part F — Week-1 hardening

- Watch **quality rating** in WhatsApp Manager; ramp broadcast volume
  gradually (Meta auto-upgrades tiers after ~7 days of healthy sends).
- Gemini key is free-tier — enable billing on Google AI Studio to avoid 503s.
- Adding more numbers: **Settings → WhatsApp numbers** (keep them under ONE
  Meta app so a single webhook + secret serves all; each number can have its
  own AI persona, flows, templates, and broadcasts).

---

## Reference — what each external service unlocks

| Service | Status | Unlocks |
|---|---|---|
| Supabase (all migrations 0001–0013 applied) | ✅ done | contacts, campaigns, inbox, KB, router, click tracking, API rules, channels |
| Google Gemini | ✅ done (free tier) | AI replies, embeddings, personas, agent routing |
| Meta WhatsApp Cloud API | ⬜ Part A | actually sending/receiving anything |
| Vercel + cron | ⬜ Part C | production URL, background queue/reminders |
| Webhook registration | ⬜ Part D | inbound messages, statuses, form submissions |
| LeadSquared keys | ✅ set | CRM chat panel + timeline sync |

### LeadSquared embed (for reference)
Lead Details custom tab URL:
```
https://<your-domain>/crm/chat?phone=@{Lead:Phone,}&name=@{Lead:FirstName,}&agent=@{Owner:EmailAddress,}&token=<CRM_PANEL_TOKEN>
```
Automation webhook: `POST https://<your-domain>/api/crm/send` with
`Authorization: Bearer <CRM_API_KEY>` and JSON
`{ "phone": "@{Lead:Phone,}", "templateName": "...", "templateParams": ["..."] }`.
