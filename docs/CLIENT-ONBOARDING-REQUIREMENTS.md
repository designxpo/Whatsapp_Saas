# Getting your business ready for Talko AI

*Send this document to the client before the onboarding call. Everything they
tick off here means setup day is under an hour instead of a week of back-and-forth.*

---

## The model, in one paragraph

Talko AI runs on **your own Meta Business account and your own AI provider
key** — not ours. We create the Meta app *inside your* Meta Business Manager,
so you own the WhatsApp number, the Instagram connection, the Facebook Page,
and all your data. Because of that, **you get three separate bills**, not
one bundled invoice:

| Who bills you | For what | Paid to |
|---|---|---|
| **Talko AI** | Your monthly platform subscription (the software) | Us |
| **Meta** | WhatsApp conversation-based messaging charges | Meta, directly — your card on your Business Manager |
| **Your AI provider** (Google / OpenAI / Anthropic) | AI reply generation, based on usage | The AI provider, directly — your account, your card |

This means no markup on messaging or AI costs, full transparency into what
you're spending, and you're never locked into our pricing for either. It also
means **three things need to exist before we can go live**: your Meta
Business Manager, your Meta app, and your AI provider API key. Everything
below tells you exactly how to get each one ready.

---

## Quick checklist (tick these before setup day)

- [ ] Facebook account with admin rights, ready to create/administer a Meta Business Manager
- [ ] Business verification documents (see §1) — **start this first, it takes days**
- [ ] A dedicated phone number for WhatsApp, not active in the WhatsApp/WhatsApp Business app
- [ ] A credit/debit card added to your Meta Business Manager (Meta bills you directly)
- [ ] Brand assets: logo, 1–2 line description, category, website URL
- [ ] Decided which channels you want live: WhatsApp / Instagram / Messenger / website web chat
- [ ] An AI provider account + API key (Gemini, OpenAI, or Anthropic — your choice, see §5)
- [ ] Knowledge-base content ready to upload: FAQs, price list, brochure, policies (see §6)
- [ ] List of team members (name + email) who need portal access
- [ ] Decided which optional integrations you want connected (payments / CRM / e-commerce / scheduling — see §7)

---

## 1. WhatsApp — required for the WhatsApp channel

Talko AI connects to the official WhatsApp Business Platform (Meta's Cloud
API) using **your own Meta app**. You stay the owner of your number and your
WhatsApp Business Account (WABA) — Talko AI operates it on your behalf.

### What you need ready

| # | Item | Why / notes |
|---|------|-------------|
| 1 | A **Facebook account** with admin access | Owns/administers your Meta Business Manager |
| 2 | A **Meta Business Manager** (business.facebook.com) | Free — create one if you don't have it |
| 3 | **Business verification documents** | Certificate of incorporation / business licence, **GST or tax ID**, and a utility bill or bank statement showing the business **name + address**. Verification lifts the 250-conversations/day starter cap and unlocks your brand display name |
| 4 | A **dedicated phone number** | Must receive an SMS or voice OTP. ⚠️ It must **NOT** be active in the WhatsApp or WhatsApp Business *app* — delete it there first if it is. Once on the API, it can't go back to the app |
| 5 | Your desired **WhatsApp display name** | Shown to customers; Meta reviews it — use your real business name |
| 6 | A **credit/debit card** | Added to the WABA — this is what Meta bills conversations to, directly |
| 7 | **Brand assets** | Square logo (profile photo), 1–2 line description, category, website URL |

### What happens on setup day (~45 minutes)

1. Confirm the Business Manager and **start business verification** — 2–10
   business days for Meta to approve, so start this before anything else.
2. Create a Meta developer app (developers.facebook.com) and add the
   **WhatsApp** product.
3. Create the WABA, add the phone number, verify with the OTP.
4. Set the display name and add the payment method.
5. Create a **System User** (Admin role), assign the app + WABA, generate a
   **permanent access token** (`whatsapp_business_messaging` +
   `whatsapp_business_management` scopes). ⚠️ Not the 24-hour temporary token.
6. *(Recommended)* Add the Talko AI team as admin/developer on the app so we
   can wire the webhook and test end-to-end with you.

### What you hand to the Talko AI team

| Credential | Where it's found |
|---|---|
| **Phone Number ID** | App dashboard → WhatsApp → API Setup |
| **WABA ID** | Same page |
| **App ID** | App dashboard → Settings → Basic |
| **App Secret** | Same page (click "Show") |
| **Permanent System User token** | From step 5 above |

We paste the webhook URL + verify token into your app's WhatsApp
configuration (or you do it, if we're not app admin), subscribe the
`messages` field, and enter your credentials into your Talko AI workspace —
encrypted at rest.

### Go-live check
Send a WhatsApp message to the number → **Setup** tab in your portal shows
WhatsApp as Ready, and the message appears in Live Chat with an AI reply.

---

## 2. Instagram — only if you want the Instagram channel

### What you need ready

1. Convert your Instagram account to a **Professional (Business) account**
   and link it to a Facebook Page (Instagram app → Settings → Account type).
2. In the **same** Meta app from §1, add the **Instagram** product.
3. Add permissions: `instagram_manage_messages` (required),
   `instagram_manage_comments` (only if you want comment-to-DM replies).
4. Generate a Page Access Token for the linked Page with those permissions.

### What you hand over

| Credential | Notes |
|---|---|
| **Instagram account ID** (IGSID) | Get via `GET /me/accounts?fields=instagram_business_account` with the Page token |
| **Facebook Page ID** | Optional but recommended |
| **Access token** | The Page token with `instagram_manage_messages` |

### Go-live check
DM the Instagram account → appears in Live Chat, channel = Instagram.

---

## 3. Facebook Messenger — only if you want the Messenger channel

### What you need ready

1. Admin access to your Facebook Page.
2. In the same Meta app, add permissions: `pages_messaging` (required),
   `pages_manage_engagement` + `pages_read_engagement` (only for comment-to-DM).
3. Generate a Page Access Token with `pages_messaging`.

### What you hand over

| Credential | Notes |
|---|---|
| **Facebook Page ID** | The Page's numeric ID |
| **Page access token** | With `pages_messaging` |

**Note:** Messenger only allows messaging within a 24-hour window of the
customer's last message, and never cold-messaging — Talko AI enforces this
automatically. Comment-to-DM is the one exception.

---

## 4. Website web chat — only if you want a chat widget on your site

No Meta app needed for this one. We give you a single `<script>` tag to drop
into your site (any platform — WordPress, Shopify, custom). You just need:

- Your website's domain (so the widget knows where it's allowed to load)
- Your logo (for the chat bubble/header) — same asset as §1
- Your brand color (hex code) — optional, defaults to a neutral blue

---

## 5. AI model — your own key, your own bill

Talko AI never hosts or resells AI access — **you bring your own API key**
from whichever provider you prefer, and that provider bills you directly
based on usage:

| Provider | Where to get a key | Typical cost for a small/medium business |
|---|---|---|
| **Google Gemini** | aistudio.google.com/apikey | Usually the cheapest option; a few dollars a month for a few thousand conversations |
| **OpenAI** | platform.openai.com/api-keys | Comparable to Gemini on the smaller models |
| **Anthropic (Claude)** | console.anthropic.com | Slightly higher cost, often chosen for tone/quality |

**How to decide:** if you're cost-sensitive, start with Gemini or OpenAI's
smallest model — both are inexpensive at typical small-business volumes.
Switch providers any time from your portal; nothing else changes. Check the
provider's own pricing page for current rates before committing, since AI
pricing changes over time.

**One technical note:** document search (turning your uploaded FAQs/brochures
into AI-searchable knowledge) runs on Talko AI's shared infrastructure, not
your key — so that part has no extra cost to you. Only the actual reply
generation uses your key.

Without an AI key configured, AI auto-replies stay off — your team can still
answer manually from Live Chat with no key at all.

---

## 6. Knowledge base — what to prepare so the AI answers correctly

Upload anything that describes your business, in whatever format you already
have it — no reformatting needed:

- **Accepted formats:** PDF, Word (.doc/.docx), plain text, Markdown, JSON, or a website URL to crawl
- **Good content to include:** FAQs, pricing/rate sheet, product or service catalog, policies (returns/refunds/cancellation/warranty), business hours, location(s), brochures

The AI answers **only** from what's uploaded here plus general knowledge — it
will never invent a price, policy, or contact detail that isn't in your
documents, so the more complete this is, the better (and safer) your
customers' experience.

---

## 7. Optional integrations — only fill in what you actually plan to use

Each of these is optional and independent — connect only what applies to your
business.

### Payments (send a pay link, get paid inside the chat)
| Provider | Fields needed |
|---|---|
| **Razorpay** | Key ID, Key Secret |
| **Stripe** | Secret key (`sk_live_…`) |

### E-commerce (import your catalog for in-chat browsing/checkout)
| Platform | Fields needed |
|---|---|
| **Shopify** | Store domain (`yourstore.myshopify.com`), Admin API access token (read_products scope) |
| **WooCommerce** | Store URL, Consumer key, Consumer secret (Read access) |

### CRM (sync new leads automatically)
| CRM | Fields needed |
|---|---|
| **LeadSquared** | Access Key, Secret Key, API host, Activity code |
| **HubSpot** | Private App access token (contacts read/write scope) |
| **Pipedrive** | Personal API token |

### Scheduling
| Tool | Fields needed |
|---|---|
| **Cal.com** | API key, Event Type ID |

### Automation / alerts (pipe events to your own tools)
| Destination | Fields needed |
|---|---|
| **Slack / Microsoft Teams** | A destination webhook URL from that tool |
| **Zapier / Make / n8n** | A destination webhook URL — Talko AI signs every delivery so you can verify it's genuinely from us |

If you don't currently use any of these, skip this section entirely — you
can always add one later from **Settings → Integrations**.

---

## 8. Team & access

Send us a list of everyone who needs a portal login:

| Name | Email | Role (Admin / Member) |
|---|---|---|
| | | |

Admins can manage settings, integrations and billing; members can work Live
Chat, broadcasts and contacts without access to sensitive configuration.

---

## 9. Which plan unlocks what

Full, current plan comparison: **[talkoai.vercel.app/pricing](https://talkoai.vercel.app/pricing)**

The short version: WhatsApp + broadcasts work on every plan. **AI Hub
(multiple AI personas), chatbot flows, drip sequences, CRM sync, growth
tools, and the product catalog/cart require the Growth plan or above** —
if "all features" is the goal for this workspace, Growth is the plan to
start on.

---

## 10. Timeline to expect

| Step | Typical time |
|---|---|
| Meta Business verification | 2–10 business days (start immediately) |
| WhatsApp display name approval | Usually same day, up to a few days |
| Message template approval | 24–48 hours per template |
| Everything else (channel connection, AI key, knowledge base, integrations) | Same day, ~45 minutes on the call |

---

## Good to know

- **Your data stays yours.** Chats, contacts, pipeline, campaigns and
  analytics live in your Talko AI workspace, not with Meta or your AI
  provider.
- **Compliance is built in.** Opt-outs (STOP), the 24-hour messaging window,
  and template rules are enforced automatically so your number stays healthy.
- **No lock-in.** Change your AI provider, disconnect an integration, or
  export your contacts any time — nothing here is a one-way door.
