# Getting your WhatsApp Business API ready for Talko AI

*Send this document to each client before onboarding. When every box is ticked,
connecting to Talko AI takes under an hour.*

Talko AI connects to the official WhatsApp Business Platform (Meta's Cloud API)
using **your own Meta business account and app**. You stay the owner of your
number, your WhatsApp account and your data — Talko AI operates it for you.

---

## 1. Keep these ready (before setup day)

| # | Item | Why / notes |
|---|------|-------------|
| 1 | A **Facebook account** with admin access | It will own/administer your Meta Business Manager |
| 2 | A **Meta Business Manager** (business.facebook.com) | Free — create one if you don't have it |
| 3 | **Business verification documents** | Certificate of incorporation / business licence, **GST or tax ID**, and a utility bill or bank statement showing the business **name + address**. Verification lifts the 250-conversations/day starter cap and unlocks your brand display name |
| 4 | A **dedicated phone number** | Must be able to receive an SMS or voice OTP. ⚠️ It must **NOT** be registered on the WhatsApp or WhatsApp Business *app* — if it is, delete the account in the app first. Once on the API, the number can't be used in the app anymore |
| 5 | Your desired **WhatsApp display name** | Shown to customers; Meta reviews it — use your real brand/business name |
| 6 | A **credit/debit card** | Added to the WhatsApp account for Meta's conversation-based billing |
| 7 | **Brand assets** | Logo (square, for the profile photo), a 1-2 line business description, business category, website URL |

## 2. Setup day — what happens (≈45 minutes, we can drive if you add us as admin)

1. Confirm the **Business Manager** and start **business verification** (2–10
   business days for Meta to approve — start this first!).
2. Create a **Meta developer app** (developers.facebook.com) and add the
   **WhatsApp** product.
3. Create the **WhatsApp Business Account (WABA)**, add the phone number and
   verify it with the OTP.
4. Set the **display name** and add the **payment method**.
5. Create a **System User** (Admin role), assign it the app + WABA, and generate
   a **permanent access token** with the `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions.
   ⚠️ *Not* the temporary 24-hour token shown on the app dashboard.
6. (Recommended) Add the Talko AI team as **admin/developer** on the app so we
   can wire the webhook and test end-to-end with you.

## 3. What you hand to the Talko AI team

| Credential | Where it's found |
|------------|------------------|
| **Phone Number ID** | App dashboard → WhatsApp → API Setup |
| **WABA ID** (WhatsApp Business Account ID) | Same page |
| **App ID** | App dashboard → Settings → Basic |
| **App Secret** | Same page (click "Show") |
| **Permanent System User token** | From step 5 above |

We give you back the **webhook URL + verify token** to paste into your app's
WhatsApp configuration (or we do it for you as app admin), subscribe the
`messages` webhook field, and enter your credentials into your Talko AI
workspace — your token is encrypted at rest.

## 4. After connection — checklist

- [ ] Send a test message to the number → AI replies from your knowledge base
- [ ] Display name approved (visible in WhatsApp Manager)
- [ ] Business verification approved (unlocks higher messaging tiers)
- [ ] First message templates submitted for approval (we handle this)
- [ ] Team members invited into the Talko AI workspace

## Good to know

- **Your data stays yours.** Chats, contacts, pipeline, campaigns and analytics
  live in your Talko AI workspace, not with Meta.
- **Future-proof.** If Talko AI later moves you onto its Tech Provider platform
  (one-click connect), your number, display name, quality rating and approved
  templates are preserved by Meta, and everything in your Talko AI workspace
  (full chat history included) is untouched. Zero downtime, per-client,
  reversible.
- **Compliance is built in.** Opt-outs (STOP), the 24-hour messaging window and
  template rules are enforced automatically so your number stays healthy.
