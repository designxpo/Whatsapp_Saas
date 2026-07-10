# Talko AI — Industry Simulation Report

*Six industries, one platform: what runs, what passed, and how to set it up.*

Each industry below was simulated as a complete customer journey through Talko AI's **real production code** — the flow engine, broadcast pipeline, drip sequences, commerce, AI grounding and compliance layers — with only the database and Meta APIs mocked. Every behavior listed here is proven by a passing automated test and re-verified on every future code change.

| | |
|---|---|
| **Industry journeys simulated** | 6 |
| **Scenario tests, all passing** | 116 |
| **Total tests in the suite** | 361 |
| **Real bugs found — all fixed & live** | 5 |

**Contents:** [E-commerce](#e-commerce--d2c-skincare-brand) · [EdTech](#edtech--course-academy) · [Healthcare](#healthcare--clinic) · [Real estate](#real-estate--agency) · [Restaurant](#restaurant--food-delivery) · [Travel](#travel--agency) · [Feature matrix](#feature-coverage-across-industries) · [Bugs found & fixed](#real-bugs-the-simulations-caught--all-fixed-and-live)

---

## E-commerce — D2C skincare brand

**21 / 21 tests passed**

> **Use case.** A skincare brand sells on WhatsApp: customers browse products, build a cart, pay through a hosted payment link, and get order updates. Carts left idle trigger an automatic recovery message; a "GET GLOW" keyword link on Instagram bio converts followers into tagged, opted-in contacts who receive a welcome offer.

### What runs — and what the tests proved

| Feature | Proven behavior |
|---|---|
| Product catalog | Per-workspace catalog; re-syncing from an external store updates products in place and never duplicates them. |
| Cart → checkout | Order total computed, pending order created, hosted payment link issued and stored; pre-paid orders skip the link; editing a cart resets its abandonment clock. |
| Abandoned-cart recovery | Idle carts are swept on schedule, enrolled once (and only once) into the recovery drip, and left open for retry if enrollment fails. |
| Order-placed drip | Checkout enrolls the buyer into the post-order sequence and fires an `order.created` webhook to connected systems. |
| Tag-triggered auto-sends | Adding a tag schedules a template send after a configured delay (e.g. welcome offer 1 hour after "glow-lead" is applied); due rows send in order, failures stay pending for retry. |
| Template preflight | Broadcasts are blocked before Meta ever sees them if the template is unapproved, missing variables, or missing its header image. |
| STOP / START compliance | STOP suppresses every phone format of the same person across the platform; repeat STOPs dedupe; START restores; suppression is strictly per workspace. |
| Growth links | wa.me short links prefill the keyword, count clicks and conversions, tag the contact — and that tag chains straight into the auto-send above. |

### How the journey works

1. **Follower taps the bio link** → Talko's growth redirect opens WhatsApp with "GET GLOW" prefilled and counts the click.
2. **First message arrives** → the keyword matches the growth tool, the contact is created, tagged `glow-lead`, and recorded as opted-in.
3. **The tag fires an auto-send** → a welcome-offer template is scheduled with the configured delay and sent when due.
4. **Customer shops** → catalog items go into a cart; checkout produces the payment link; payment confirmation flips the order to paid.
5. **Checkout enrolls the post-order drip** and notifies connected systems via webhook.
6. **If the cart is abandoned instead** → the scheduled sweep enrolls the customer into the recovery sequence — exactly once.
7. **Any STOP at any point** → every future marketing send to that person is suppressed automatically.

### Replicate it for a client

- Import the product catalog (store sync via the integrations API, keyed by the store's product IDs so re-syncs update rather than duplicate).
- Create two sequences in **Chatbot Flows → Sequences** with trigger keys `cart_abandoned` and `order_placed`.
- Connect a payment provider under **Settings → Integrations** so checkout can mint hosted payment links.
- Create a growth link with keyword prefill (e.g. "GET GLOW"), auto-tag, and opt-in recording — put it in the Instagram bio and ads.
- Add an auto-send rule: tag `glow-lead` → welcome-offer template after 1 hour.
- Submit the offer/order-update templates for Meta approval; preflight will hold any broadcast until they're approved.

---

## EdTech — course academy

**20 / 20 tests passed**

> **Use case.** An academy qualifies leads automatically: a prospect messages "courses", picks a program from a menu (typos tolerated), leaves their name and a validated email, and lands in the CRM — while a nurture drip runs until they reply. Website visitors get the same intake through the web-chat widget's question-by-question form.

### What runs — and what the tests proved

| Feature | Proven behavior |
|---|---|
| Intake chatbot flow | Keyword trigger, button menu, step-by-step answers captured into contact attributes; sessions park and resume across messages. |
| Forgiving menu matching | "Data science and gen ai" matches the "Data Science & GenAI" button; ambiguous replies go to the AI instead of guessing; "1"/"2" number picks work. |
| Email validation | A typo'd email is retried politely (max twice); a real question mid-form bails out to the AI instead of nagging; junk is never stored. |
| Personalization | `{{name}}`, `{{course}}`, `{{email}}` render each learner's own details into every flow message. |
| CRM handoff | Captured name renames the conversation, creates/merges the contact, and mirrors email + course to LeadSquared. |
| Web-chat intake form | On the website widget the same intake runs as a chat-native Q&A; a captured phone number links the anonymous visitor to a real contact. |
| Keyword nurture drip | "BROCHURE" enrolls the lead in a drip (deduped per person); the bot stays quiet during the drip; a reply stops it. |
| Plan gating | Feature access follows the workspace's plan with per-workspace overrides; billing errors fail open (never lock a paying customer out). |

### How the journey works

1. **"courses" arrives** → the flow greets by name and shows the program menu as buttons.
2. **The prospect types or taps a choice** → stored as the `course` attribute even with typos.
3. **Name and email are asked one at a time** → email is validated, retried on typos, and the lead lands in Contacts + LeadSquared.
4. **The wrap-up message confirms** — "Your Data Science & GenAI brochure is on its way to priya@…".
5. **Off-script questions any time** ("what's the fee?") → the flow steps aside and the AI answers from the knowledge base.
6. **No reply for a while?** The keyword drip keeps nurturing until they respond — then it stops automatically.

### Replicate it for a client

- Build the intake flow in **Chatbot Flows**: trigger keywords ("courses", "admission"), a buttons node per program, ask nodes for name and email (validation: email) saving to attributes.
- Upload the prospectus/FAQ to **AI Knowledge Base** so off-script questions get grounded answers.
- Create a nurture sequence with keyword `BROCHURE` (or enroll from the flow) — 3–5 spaced messages.
- Connect LeadSquared under **Settings → Integrations**; captured email/course sync automatically.
- Install the web-chat widget on the academy's site — the same flow runs there as a question-by-question chat form.

---

## Healthcare — clinic

**17 / 17 tests passed**

> **Use case.** A family clinic triages WhatsApp messages: appointment requests flow through a menu, "talk to a nurse" hands off to a human immediately, and after-hours messages get an away note. Consent is airtight — reminder broadcasts only reach patients who explicitly opted in, and STOP is honored across every phone format. Voice notes from elderly patients are transcribed for the staff.

### What runs — and what the tests proved

| Feature | Proven behavior |
|---|---|
| Triage flow + human handoff | "Talk to a nurse" escalates the chat to Live Chat, tells the patient, and closes the flow — the bot stays available but a human owns the thread. |
| Dead-end protection | A misconfigured menu button auto-escalates to a human instead of leaving the patient stranded. |
| Welcome & away messages | Per-clinic welcome/away text; the welcome fires exactly once even if Meta delivers the webhook twice. |
| Working hours | Clinic hours respected to the minute — including overnight windows (22:00–06:00) that wrap past midnight, timezone-aware. |
| Consent (opt-in proof) | Every opt-in is recorded with source, proof text and timestamp; marketing audiences exclude anyone unconsented or opted out. |
| STOP / START | STOP suppresses the patient across +91/local number formats, per clinic; START restores and re-records consent. |
| Voice notes | Audio transcription via Gemini or Whisper; any failure resolves to "no transcript" and never breaks message handling. |

### How the journey works

1. **Patient messages "hi"** → one welcome (never duplicated) + the triage menu: appointments, reports, talk to a nurse.
2. **Appointment path** → the flow collects what's needed; **nurse path** → instant escalation to staff in Live Chat.
3. **After hours** → the away message answers honestly; the thread waits for morning staff.
4. **A voice note arrives** → transcribed automatically so staff read it at a glance.
5. **Reminder broadcasts** go only to patients with recorded consent — opted-out or unattested numbers are excluded at send time.

### Replicate it for a client

- Build the triage flow in **Chatbot Flows** with a handoff node on "Talk to a nurse".
- Set welcome/away text and clinic hours in **Settings → Messaging** (overnight windows supported).
- Import the patient list, then treat *inbound messages as consent* — opt-in is recorded automatically with proof.
- Keep reminder/marketing broadcasts on the default "opted-in only" audience — the gate is enforced at send time.
- Add an AI key under **Settings → AI** to enable voice-note transcription.

---

## Real estate — agency

**19 / 19 tests passed**

> **Use case.** An agency qualifies property leads in chat — intent (buy/rent), budget (validated as a number), locality (validated as a city) — then moves them through a visual sales pipeline where each stage change tags the lead, starts the right drip, and updates the CRM. Every new lead and message also streams to the agency's own systems and Slack via signed webhooks.

### What runs — and what the tests proved

| Feature | Proven behavior |
|---|---|
| Qualification flow | Buy/rent menu → budget (number-validated with retry) → locality (city-validated); answers stored as attributes; off-script questions bail out to the AI. |
| Sales Pipeline | Dragging a lead to a stage fires that stage's effects: auto-tag, drip enrollment (proven against the real sequence engine), and a mapped CRM stage push — each only when configured. |
| Signed webhooks | `contact.created` / `message.inbound` fan out only to this agency's connected endpoints, HMAC-signed; one broken endpoint never blocks the others; Slack gets a human-readable line. |
| Webhook security | Signing secrets are generated per connection, shown once, stored encrypted (AES-GCM); deliveries pass an SSRF guard. |
| Attributed wa.me links | Tracked links embed a greeting + reference code; replies resolve the code to the exact campaign/source and count the touch. |
| CRM mirror | City/budget captures sync the lead profile to LeadSquared as they happen. |

### How the journey works

1. **A portal ad's tracked wa.me link** opens WhatsApp with a greeting + hidden ref code — the reply is attributed to that exact ad.
2. **The flow qualifies**: intent buttons, then budget (a non-number gets a polite retry), then locality.
3. **The lead lands in Contacts + LeadSquared** with budget/locality attributes, and `contact.created` hits the agency's webhook + Slack.
4. **An agent drags the card** to "Site visit scheduled" → the stage's tag is applied, the site-visit drip starts, the CRM stage updates.
5. **Any question mid-flow** ("is Whitefield near the metro?") → the AI answers from the agency's knowledge base, scoped by the flow's KB tag.

### Replicate it for a client

- Build the qualification flow in **Chatbot Flows**: buttons for intent, ask nodes with *number* and *city* validation for budget/locality.
- Define stages in **Sales Pipeline** and set per-stage effects: entry tag, drip sequence, CRM stage mapping.
- Create tracked wa.me links per listing portal / campaign in the growth tools so every lead is source-attributed.
- Add webhook connections (endpoint + Slack) under **Settings → Integrations**; store the one-time signing secret in the client's system.
- Upload project sheets/locality FAQs to **AI Knowledge Base**, tagged per project, and set the flow's KB tag.

---

## Restaurant — food delivery

**22 / 22 tests passed**

> **Use case.** A kitchen takes orders in chat — greeting regulars by name, walking delivery vs. pickup through buttons — and runs weekend-special blasts to tagged regulars with per-person names, tracked menu links, and delivery receipts. Safety rails keep the WhatsApp number healthy: daily caps, quality-drop auto-pause, and failure cut-offs.

### What runs — and what the tests proved

| Feature | Proven behavior |
|---|---|
| Order flow | Personalized greeting, delivery/pickup buttons, confirmation; taps, typed titles, "1"/"2" picks and close-enough text all resolve; ambiguous input goes to the AI. |
| Off-script handling | Real questions pass to the AI with the order in progress intact; with AI off, rotating nudges cap at 3 and then hand the chat to a human. |
| Menu shape guards | Button menus cap at WhatsApp's limit of 3 (lists at 10) with blank entries dropped — flows can't break the Meta API. |
| Broadcast end-to-end | A scheduled, tag-segmented campaign renders `{name}` per recipient, sends through the real WhatsApp client code, and logs one row per recipient. |
| Delivery receipts | Sent → delivered → read transitions recorded forward-only (a late "delivered" never downgrades "read"). |
| Number-health rails | Rolling 24-hour cap holds excess sends; a RED quality rating auto-pauses marketing (and auto-resumes); 5 consecutive failures abort early and release the rest for retry. |
| Tracked menu links | Each recipient gets a unique short link in the template button; clicks are counted per person. |
| Plan gating | Starter plans get a clear upgrade prompt on gated features; the suggested upgrade is always an active (never retired) plan. |

### How the journey works

1. **"hi" arrives** → "Hi Rohan! Welcome to Spice Route Kitchen" + order-type buttons.
2. **Delivery or pickup** → tap, type, or number — the flow confirms and the order proceeds.
3. **Saturday 11 am** → the weekend-special campaign fires to the `regulars` tag: every message says the customer's own name and carries their own tracked menu link.
4. **Receipts stream back** → the dashboard shows sent/delivered/read counts that only ever move forward.
5. **If Meta rate-limits or quality drops** → the campaign pauses itself and resumes safely; nothing is lost.

### Replicate it for a client

- Build the order flow in **Chatbot Flows** (greeting with `{{name}}`, buttons for delivery/pickup, confirmation).
- Tag regulars in **Contacts** (import CSV with tags, or tag from conversations).
- Get the weekend-special template approved (body variable for the name + a URL button); preflight blocks the send until it's ready.
- Schedule the blast in **Broadcast** to the tag audience — link tracking is per recipient automatically.
- Leave the safety rails on defaults: daily cap, quality auto-pause, and failure cut-off need no configuration.

---

## Travel — agency

**17 / 17 tests passed**

> **Use case.** A travel agency qualifies trips in chat — destination, travellers, month — with every reply personalized ("I'll craft a Bali itinerary for 4 travellers this December"). Visa questions get AI answers strictly grounded in the agency's own knowledge base — invented prices, phone numbers or links never reach the customer. "Talk to an expert" escalates instantly and pings the team's Slack.

### What runs — and what the tests proved

| Feature | Proven behavior |
|---|---|
| Trip qualification flow | Destination menu → travellers (number-validated — "2" is stored as the answer, not mistaken for a menu pick) → month; all captured as attributes. |
| Deep personalization | `{{name}}`, `{{destination}}`, `{{travellers}}`, `{{travel_month}}` render live mid-flow — each reply reflects everything captured so far. |
| Smart follow-up questions | "and the requirements?" after a Bali visa question is understood in context; a fresh question is never polluted by old topics. |
| Grounding firewall | KB-backed visa fees/durations/URLs pass verbatim; invented currency amounts, phone numbers and links are stripped or deferred; a made-up email is rewritten to the agency's approved inbox. |
| Human handoff | "Talk to a travel expert" (or an explicit human request to the AI) escalates before any automated answer — personalized handoff text, chat marked escalated. |
| Escalation webhook | `conversation.escalated` fires signed to the agency's endpoint + Slack — only theirs, never another workspace's. |
| Itinerary drip | "BALI" keyword enrolls a 3-part itinerary drip; steps send inside WhatsApp's 24-hour window, templates carry past it, and the drip completes cleanly. |

### How the journey works

1. **"plan a trip" arrives** → destination buttons (Bali / Dubai / Kerala).
2. **"How many travellers?"** → the traveller types "2" and it's captured as 2 travellers — validated, retried politely if it's not a number.
3. **Month lands** → the lead is tagged `trip-qualified` and the wrap-up renders every detail back: "Bali · 4 travellers · December".
4. **"Do I need a visa for Bali?"** → the AI retrieves from the agency's visa guide; only facts that exist in the KB survive to the reply.
5. **"Talk to an expert"** → instant escalation; the team's Slack pings with the conversation.
6. **"BALI" keyword** → the 3-day itinerary drip nurtures the lead within messaging-window rules.

### Replicate it for a client

- Build the qualification flow in **Chatbot Flows**: destination buttons (saveAs: destination), number-validated travellers ask, month ask, tag node, handoff button.
- Upload visa guides, package sheets and T&Cs to **AI Knowledge Base** — the grounding firewall only lets KB-backed facts through, so the KB *is* the product knowledge.
- Create the itinerary drip with keyword `BALI` (one per destination), mixing free-form messages with templates for outside-window steps.
- Connect Slack under **Settings → Integrations** subscribed to `conversation.escalated` so experts get pinged instantly.
- Set the agency's real support inbox in AI settings — any AI-invented email is rewritten to it.

---

## Feature coverage across industries

The same platform features recombine per industry — this is what makes onboarding repeatable. A ● means the simulation proved that feature in that industry's journey.

| Feature | E-com | EdTech | Health | Estate | Rest. | Travel |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Chatbot flows (menus, ask + validation) | — | ● | ● | ● | ● | ● |
| Personalization variables | — | ● | — | ● | ● | ● |
| AI answers + knowledge grounding | — | ● | — | ● | ● | ● |
| Human handoff / escalation | — | — | ● | ● | ● | ● |
| Drip sequences | ● | ● | — | ● | — | ● |
| Broadcasts + delivery receipts | — | — | ● | — | ● | — |
| Template preflight | ● | — | — | — | ● | — |
| STOP/START + consent gating | ● | — | ● | — | ● | — |
| Auto-sends (tag-triggered) | ● | — | — | — | — | — |
| Commerce (catalog → cart → payment) | ● | — | — | — | — | — |
| Growth / tracked wa.me links | ● | — | — | ● | ● | — |
| Sales pipeline + stage effects | — | — | — | ● | — | — |
| Signed webhooks + Slack | ● | — | — | ● | — | ● |
| CRM sync (LeadSquared) | — | ● | — | ● | — | — |
| Web-chat widget + chat forms | — | ● | — | — | — | — |
| Voice-note transcription | — | — | ● | — | — | — |
| Working hours / welcome / away | — | — | ● | — | — | — |
| Plan gating / entitlements | — | ● | — | — | ● | — |

---

## Real bugs the simulations caught — all fixed and live

This is the point of the program: five production bugs no manual test had hit, each found by an industry journey, fixed, covered by a regression test, and deployed.

| Severity | Bug | Found by | Status |
|---|---|---|---|
| Medium | **Consent never landed for locally-formatted contacts.** A patient imported as "9812345678" who then messaged in from "919812345678" was never marked opted-in — permanently excluded from every consented broadcast, while STOP for the same person *did* work. Opt-in now matches numbers the same way opt-out always did. | Healthcare | FIXED ✓ |
| Medium | **Digit answers hijacked by the previous menu.** Replying "2" to "How many travellers?" re-ran option 2 of the earlier destination menu — the answer could never be captured and the customer looped forever. Valid answers now win over old-menu rewinds. | Travel | FIXED ✓ |
| Medium | **`{{email}}` rendered blank after capture.** "Your brochure is on its way to {{email}}" printed an empty gap because the reserved token only read the profile column, not the answer just captured. Reserved tokens now fall back to captured attributes, and captured emails land on the contact profile too. | EdTech | FIXED ✓ |
| Low | **First-time customers greeted with a literal "Hi {{name}}!".** Brand-new callers with no contact record saw the raw placeholder. Unknown tokens now resolve to empty text for everyone, as the personalization contract promises. | Restaurant | FIXED ✓ |
| Low | **Contact list misreported consent after STOP.** Sends were correctly suppressed after STOP, but locally-formatted contact rows still displayed "active". Status updates now use the same phone matching as suppression. | E-commerce | FIXED ✓ |

---

> **How these simulations work.** Each suite drives the platform's real production modules — the flow engine, campaign queue, sequence scheduler, commerce, AI retrieval/grounding, compliance and settings layers — through a full customer journey. Only the database and external APIs (Meta, payment, CRM, LLM) are replaced with recorded stand-ins, so what's being verified is exactly the logic that runs in production. The suites live in the codebase (`src/lib/__tests__/scenario-*.test.ts`) and run on every change: any future edit that breaks one of these journeys fails the build before it can ship.

---

*Talko AI · Industry simulation report · Generated 10 Jul 2026 · 116 scenario tests across 6 industries, 361 total suite tests, all passing at time of writing.*
