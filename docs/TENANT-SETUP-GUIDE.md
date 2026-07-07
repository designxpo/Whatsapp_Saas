# Tenant setup guide — onboarding clients on their own Meta app

*For onboarding clients before Talko AI is a registered Tech Provider. Each
client uses their **own** Meta Business Manager, their **own** Meta app, and
their **own** WhatsApp/Instagram/Messenger credentials. Talko AI enters those
credentials into that client's workspace under Settings — nothing is shared
between clients.*

---

## ⚠️ Read this before onboarding client #2

Today, the platform verifies every incoming WhatsApp/Instagram/Messenger
webhook using **one global secret** (`META_APP_SECRET` / `META_WA_WEBHOOK_SECRET`
in the server environment). That's fine for **one** Meta app.

The moment you onboard a **second client with a different Meta app** (different
App Secret), their inbound messages will be **silently rejected** — the webhook
returns `401 Invalid signature` and the client's messages never reach Talko AI,
because their app signs with a different secret than the one the server checks
against.

**Fix required before client #2 goes live:** store each channel's App Secret
per-tenant (already has a home — `wa_channels` — needs one new encrypted
column) and have the three webhook routes try the channel's own secret first,
falling back to the global one. This is a scoped, well-understood change — say
the word and it's built before you sign client #2.

Until that's shipped, **only client #1** can safely use their own distinct
Meta app. If you want to onboard several clients in parallel right now, the
workaround is to add every client as an **admin/developer on one shared Meta
app** (one App ID/Secret, several WABAs/Pages hanging off it) — ask and I'll
add that as an alternate flow below.

---

## 0. What's the same for every client, every scenario

Every setup — whichever channels a client wants — starts the same way, because
WhatsApp, Instagram and Messenger are all "products" added to **one Meta app**.
A client who wants all three channels needs only **one** app with three
products added, not three separate apps.

### 0.1 What the client must have ready

| # | Item | Why |
|---|------|-----|
| 1 | A **Facebook account** with admin rights | Owns/administers the Business Manager |
| 2 | A **Meta Business Manager** (business.facebook.com) | Free to create |
| 3 | **Business verification documents** (only required for WhatsApp) | Certificate of incorporation / business licence, **GST/tax ID**, a utility bill or bank statement with the business **name + address**. Lifts the 250-conversations/day cap and unlocks the display name |
| 4 | Brand assets | Logo, short description, category, website |

### 0.2 Create the one Meta app (do this once per client)

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → type: **Business**.
2. Under **Business portfolio**, attach the client's Business Manager.
3. In **App Settings → Basic**, note the **App ID** and click "Show" to reveal the **App Secret** — you'll need both for every channel below.
4. **Add products** — only add what the client is actually buying:
   - **WhatsApp** → for the WhatsApp scenario
   - **Instagram** → for the Instagram scenario
   - **Facebook Login for Business** + the Page already has Messenger access by default → for the Messenger scenario
5. Add yourself (Talko AI ops) as **Admin** or **Developer** on the app so you can finish the wiring without waiting on the client for every step.

### 0.3 Common webhook facts (all channels)

| Channel | Webhook URL | Verify token env | Signature secret env | Subscribe fields |
|---|---|---|---|---|
| WhatsApp | `https://<your-domain>/api/webhooks/whatsapp` | `META_WA_WEBHOOK_VERIFY_TOKEN` (or shared `META_WEBHOOK_VERIFY_TOKEN`) | `META_WA_WEBHOOK_SECRET` (or shared `META_APP_SECRET`) | `messages` |
| Instagram | `https://<your-domain>/api/webhooks/instagram` | `META_WEBHOOK_VERIFY_TOKEN` | `META_APP_SECRET` | `messages`, `comments` |
| Messenger | `https://<your-domain>/api/webhooks/messenger` | `META_WEBHOOK_VERIFY_TOKEN` (or `META_WA_WEBHOOK_VERIFY_TOKEN`) | `META_APP_SECRET` | `messages`, `feed` |

The **verify token** is any string you invent — paste the identical string into
the app's webhook config and into the server env. Until the per-tenant secret
fix above ships, **use client #1's App Secret as the server's `META_APP_SECRET`**.

Run **Owner Portal → Meta connection doctor** any time to confirm these are
wired correctly, with a live Graph credential check.

---

## Scenario A — WhatsApp only

**Best for:** businesses whose customers are mostly on WhatsApp (D2C, services,
clinics, real estate, restaurants doing order support).

### Client-side steps
1. A **dedicated phone number** that can receive an SMS/voice OTP.
   ⚠️ It must **not** be active in the normal WhatsApp / WhatsApp Business
   *app* — delete it there first, or use a fresh number.
2. In the app, open **WhatsApp → API Setup**. Create/attach the **WhatsApp
   Business Account (WABA)**, add + verify the number.
3. Set the **display name** (Meta reviews it — use the real business name) and
   add a **payment method** to the WABA.
4. Create a **System User** (Admin role) → assign the app + WABA → generate a
   **permanent access token** with `whatsapp_business_messaging` +
   `whatsapp_business_management` scopes. ⚠️ Not the 24-hour temporary token.
5. Start **Business Verification** on the Business Manager (2–10 business days
   — start this on day one, it gates higher messaging limits).

### What the client hands you
- **Phone Number ID** (WhatsApp → API Setup)
- **WABA ID**
- **App ID** + **App Secret** (Settings → Basic)
- **Permanent System User token**

### Where it goes in the portal
**Admin → Settings → WhatsApp numbers → Add manually**
| Portal field | Value |
|---|---|
| Name | e.g. "Main line" |
| Phone Number ID | from API Setup |
| WABA ID | from API Setup |
| Access token | the permanent System User token |
| App ID | the app's App ID |

### Webhook
Subscribe `messages` on `/api/webhooks/whatsapp` (table in §0.3).

### Go-live check
Send a WhatsApp message to the number → **Admin → Setup** tab should show
"WhatsApp" as Ready, and the message should appear in Live Chat with an AI reply.

---

## Scenario B — Instagram only

**Best for:** brands whose audience lives in DMs/comments (fashion, beauty,
influencer-led brands, creators).

### Client-side steps
1. Convert the Instagram account to a **Professional (Business) account** and
   **link it to a Facebook Page** (Instagram app → Settings → Account type,
   or via the Page's Linked Accounts).
2. In the Meta app, add the **Instagram** product.
3. Add permissions: `instagram_manage_messages` (required),
   `instagram_manage_comments` (only if you want comment-to-DM).
4. Generate a **Page Access Token** for the linked Page with those
   permissions (Graph API Explorer, or via a login flow) — this doubles as the
   Instagram access token.

### What the client hands you
- **Instagram account ID** (the IG professional account / IGSID — get it via
  `GET /me/accounts?fields=instagram_business_account` with the Page token)
- **Facebook Page ID** (optional but recommended)
- **Access token** (Page token with `instagram_manage_messages`)

### Where it goes in the portal
**Admin → Instagram → Add manually**
| Portal field | Value |
|---|---|
| Name | e.g. "Brand IG" |
| Instagram account id | the IGSID |
| Facebook Page id | optional |
| Access token | the Page access token |

### Webhook
Subscribe `messages` + `comments` on `/api/webhooks/instagram`.

### Go-live check
DM the Instagram account → appears in Live Chat with channel = Instagram; a
comment (if `instagram_manage_comments` granted) triggers a private reply.

---

## Scenario C — Facebook Messenger only

**Best for:** businesses running most of their marketing/support through a
Facebook Page (local businesses, community-driven brands).

### Client-side steps
1. Confirm you have **Admin** access to the client's **Facebook Page**.
2. In the Meta app, add permissions: `pages_messaging` (required),
   `pages_manage_engagement` + `pages_read_engagement` (only for comment-to-DM).
3. Generate a **Page Access Token** with `pages_messaging`.

### What the client hands you
- **Facebook Page ID**
- **Page access token**

### Where it goes in the portal
**Admin → Facebook → (Messenger card) → connect**
| Portal field | Value |
|---|---|
| Label | e.g. "Support Page" |
| Facebook Page ID | the Page's numeric ID |
| Access token | the Page access token |

### Webhook
Subscribe `messages` + `feed` on `/api/webhooks/messenger`.

### Compliance guardrail (automatic)
Messenger only allows messaging within a **24-hour window** of the customer's
last message, and never cold-messaging — Talko AI enforces this for you.
Comment-to-DM is the one exception (a comment is an opt-in).

### Go-live check
DM the Page → appears in Live Chat with channel = Messenger.

---

## Scenario D — Any 2 channels (e.g. WhatsApp + Instagram)

Use **one Meta app** with both products added — repeat the relevant steps from
Scenario A and B (or A+C, or B+C) against the **same App ID/Secret**, then add
**two channel rows** in the portal (one under Settings → WhatsApp numbers, one
under Instagram/Facebook).

| Combo | Steps to follow |
|---|---|
| WhatsApp + Instagram | §A (WhatsApp) + §B (Instagram) |
| WhatsApp + Messenger | §A (WhatsApp) + §C (Messenger) |
| Instagram + Messenger | §B + §C — often the *same* Page token can cover both if it has both `pages_messaging` and `instagram_manage_messages` |

Webhook subscriptions: subscribe both relevant fields under the **same app**
webhook config (e.g. WhatsApp product → `messages`; Page subscription →
`messages`+`feed`).

**Go-live check:** the Setup tab should show both channels as Ready; test a
message on each independently.

---

## Scenario E — Complete (WhatsApp + Instagram + Messenger)

One Meta app, all three products added. Follow §A + §B + §C in full against the
same App ID/Secret — this is the standard path once a client is ready to
commit to being fully on Talko AI.

**Portal setup order (recommended):** WhatsApp first (usually the primary
channel and the one gating Business Verification), then Instagram, then
Messenger — each takes 10–20 minutes once the Meta app exists.

**Go-live check:** **Admin → Setup** tab shows all three channels Ready, AI
Hub configured, and knowledge base uploaded — the tenant is fully live.

---

## Quick reference — credentials to collect per scenario

| Scenario | Credentials needed |
|---|---|
| WhatsApp only | App ID, App Secret, Phone Number ID, WABA ID, permanent token |
| Instagram only | App ID, App Secret, IG account ID, (Page ID), Page/IG token |
| Messenger only | App ID, App Secret, Page ID, Page token |
| Any 2 | Union of the two scenarios' credentials (one shared App ID/Secret) |
| Complete | Union of all three (one shared App ID/Secret) |

## After any scenario — always finish with

1. **Owner Portal → Meta connection doctor** — confirms env wiring + live Graph
   credential validity (owner-only).
2. **Admin → Setup tab** (tenant-facing) — per-channel Ready/Problem status
   with a "Test now" button for AI/WhatsApp/Instagram/CRM.
3. Upload the client's **knowledge base** (AI Hub) so replies are grounded in
   their real docs/FAQs/pricing before going live to real customers.
4. Submit the client's first **message templates** for WhatsApp approval
   (24–48h) if broadcasts are part of their plan.
