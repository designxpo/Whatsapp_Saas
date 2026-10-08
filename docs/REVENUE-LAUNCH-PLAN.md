# First revenue plan — Indian small businesses on WhatsApp

Decision from the user: focus on Indian small businesses using WhatsApp. Start with one reachable service-business segment, such as salons and local home-service teams, where repetitive enquiries and missed follow-ups are easy to measure. Choose the segment where the founder already has warm access; do not buy ads before validating conversion and activation.

## Offer and revenue target

Sell one outcome: **answer routine customer questions and manage every WhatsApp enquiry in one team inbox**. Demonstrate opening hours, services/prices, a lead enquiry and a human handoff using that business's own FAQs. Do not promise guaranteed sales, fixed automation percentages, instant Meta approval or unrestricted outbound messaging.

Use the existing published tiers, without introducing another pricing model:

| Offer | Price | Initial buyer |
| --- | --- | --- |
| Starter | ₹1,999/month | One number, small team, basic FAQ/enquiry workflow |
| Growth | ₹5,999/month | Businesses needing the additional channels, flows and team capacity included in the actual plan |
| Assisted first five pilots | Included onboarding for the first five | Businesses willing to attend setup and weekly feedback sessions |

Keep Meta messaging charges and the customer's AI usage separate and explain them before purchase. Quote the final configured checkout amount and actual plan limits; marketing content alone is not the source of provider entitlements. Do not advertise an onboarding fee or discount until it exists in a reviewed offer and billing path.

First target: five paid Starter businesses = **₹9,995 MRR**. A later scenario of ten Starter plus five Growth = **₹49,985 MRR**. These are arithmetic targets, not forecasts; they exclude provider costs, support, tax treatment, refunds and churn. Count only collected recurring payments, not trials, authorizations or one-time onboarding income.

## Execute in four stages

| Stage | Work | Owner | Exit condition |
| --- | --- | --- | --- |
| Launch prerequisites | Apply the OTP migration DB-first, configure Supabase/email, complete sandbox billing and plan-enforcement checks, connect one development WhatsApp number | Technical operator | All required gates in the project audit have evidence; no paid claim based on an authorization-only payment |
| Week 1: validate the offer | Select 20 warm businesses in one segment; conduct 10 short conversations; prepare three personalized demos with consent | Founder | Three businesses agree to a guided trial and name a concrete enquiry problem |
| Week 2: activate pilots | Set up the first three businesses, add 15–20 real FAQs, test incoming enquiry and human handoff, train the operator | Founder + onboarding operator | Each pilot receives useful real enquiries in the inbox and can operate without daily intervention |
| Weeks 3–4: collect and improve | Review results, offer the fitting paid plan, expand to five paying businesses, ask satisfied customers for an introduction and permission to publish a factual case study | Founder | Five collected subscriptions or documented objections informing the next iteration |

Prefer manually supervised pilots before unrestricted signup and unattended recurring billing. Never bypass payment evidence, request customer secrets in chat, or run broadcasts as an onboarding test.

## Prepared execution in this repository

- Pricing now offers **Request a WhatsApp walkthrough**, linking to `/contact?intent=demo`.
- The sales form starts with business type, enquiry volume and main goal prompts. Form validation and request throttling protect delivery capacity; actual sending still requires Resend.
- Signup is easier on phones and asks optional profiling only when the user chooses to provide it.
- Dashboard first-use guidance directs customers to connection, FAQs, a test and their first enquiry.
- Auth and payment defects were corrected with regression tests; compatible security patches were installed.
- A prospect tracker and scripts below are ready for the founder. No prospects were fabricated or contacted.

## Conversation and demo scripts

Use personally introduced contacts or existing opt-in relationships. These drafts have not been sent.

**Interview opener:** “We're building Talko AI for small businesses that handle customer enquiries on WhatsApp. How many enquiries do you get in a typical week, which questions repeat, and what happens when you're too busy to reply? I'd like to understand your workflow before suggesting anything.”

**Demo invitation, after interest:** “I can show a walkthrough using your opening hours, services and FAQs: one question answered, one lead captured, and one conversation handed to your team. Would that be useful? The Starter subscription is ₹1,999/month; Meta and AI usage are separate. We can first check whether the setup fits your business.”

**12-minute demo:** 2 minutes understanding the problem; 3 minutes answering their actual FAQs; 3 minutes showing inbox/handoff; 2 minutes explaining connection and separate costs; 2 minutes agreeing a trial success measure and setup date. Use a clearly identified development workspace and anonymized/sample customer messages.

**Paid conversion conversation:** “Over the trial, we saw [measured enquiries] and [documented result]. Does that solve the problem we agreed on? If you'd like to keep it running, we can confirm the plan, exact payment amount and cancellation terms, then complete payment through the configured provider.” Do not insert unsupported improvement percentages.

## Pilot success and unit economics

Measure a baseline before setup: weekly enquiries, response delay, missed enquiries and operator time. During the pilot record time to first useful reply, successful handoffs, incorrect answers corrected, weekly active operators and support minutes per business. Review the conversation evidence with the customer; automation volume alone is not customer value.

Track: interested → demo → trial → activated → payment captured → retained. Targets for the first small sample are learning milestones, not statistically reliable conversion rates. If fewer than half of guided trials reach a successful real enquiry within three business days, pause acquisition and fix onboarding.

For each paid workspace, calculate collected subscription revenue minus measured hosting, platform-paid AI/email, gateway fees, refunds and support time at the founder's chosen hourly cost. BYO AI does not make support or infrastructure free. Stop promising included service levels that exceed the contribution margin.

## Operator checklist for each pilot

1. Confirm business/contact consent, current WhatsApp setup, access rights and a suitable plan; explain Meta prerequisites without promising approval time.
2. Let the business connect its number through the supported onboarding flow and enter its provider key securely in workspace settings.
3. Add approved business information and define when to hand off to a person.
4. Test the customer's real questions, edge cases and handoff. Keep outgoing tests within a clearly agreed development scope.
5. Agree the trial outcome, train one responsible operator, and schedule a short check-in.
6. Verify captured payment and effective entitlement before marking converted; record cancellation/support expectations and the next renewal date.

## Outstanding actions

Technical work and launch materials have been executed locally. Service credentials, database migration application, provider dashboard verification, deployment, customer conversations and real collection remain outstanding. Use the environment settings for secure bindings. The founder must provide access to an intended development deployment and actual warm prospects; publication and sending messages need explicit destination/scope authorization.
