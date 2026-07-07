# Chatbot Flow Behavior — Tester's Reference

What to expect at each step of a WhatsApp/Instagram/Messenger/web-chat flow,
and exactly what triggers each automated message. Written for whoever is
testing a flow, not just developers. Implementation: `src/lib/flowengine.ts`.
Everything below is per-tenant — each business's flows, Settings toggles, and
nudge/reminder configuration are independent.

If something you observe while testing doesn't match this doc, that's a bug —
report it with the exact message text and roughly when it happened, so it can
be traced against the conversation's stored state.

---

## 1. The three kinds of "waiting" steps

A flow only ever pauses on one of these. Everything else in this doc (nudges,
reminders, rewind) behaves differently depending on which one the person is
currently on.

| Step type | What the person sees | How their reply is read |
|---|---|---|
| **Menu** (buttons or list) | Up to 3 buttons, or a numbered list | Tapping the button/row, typing its exact title, typing its number, or typing a close, unambiguous match ("data science and genai" for "Data Science & GenAI") |
| **Question** (ask) | A single question, no buttons | Free text; validated if the field is email/phone/number |
| **WhatsApp Form** | The native WhatsApp form ("Get Started" button) on WhatsApp; asked field-by-field as chat messages on Instagram/Messenger/web chat | The form submission, or (on chat channels) one typed answer per question |

## 2. Off-script text — what happens when the reply doesn't fit

This is the #1 source of confusing test results, because the SAME typed
message can produce different results depending on the AI toggle and how many
times it's already happened at this exact step.

**On a Menu or an open WhatsApp Form**, when the typed text matches no
button/row/field:

1. **Old menu tap?** If it matches a button from an *earlier* menu in this
   flow, the flow rewinds and re-runs that branch (people tap stale buttons
   constantly — this is silent and correct, not a bug).
2. **Keyword restart?** "hi" / "hello" / "menu" / "start" (or any flow's own
   trigger keyword) restarts that flow from scratch, even mid-conversation.
3. **AI auto-replies ON** (Settings) **and the text reads like a real
   question** (contains "?", or starts with how/what/why/can/tell me/etc.) →
   the **AI answers it**, using the knowledge base. The menu/form keeps
   waiting underneath — answering the AI's message doesn't lose your place.
4. **Otherwise** (AI off, or the text isn't really a question — just typing
   "hii", "ok", or random letters) → the **off-script nudge** fires: one of
   the messages configured in **Settings → Off-script nudge**, rotating
   through the configured variations in order.
5. **After 3 nudges with no resolution** → the bot stops nudging, sends
   *"Connecting you with our team — someone will reply here shortly. 🙌"*,
   marks the conversation **Escalated**, and ends the automated session. From
   here it's a human conversation — the bot will not reinterpret further
   messages as menu picks. (This is what stops the "same two messages
   forever" loop — before this existed, a step 5 that kept failing had no
   exit.)

**On a Question (ask) step** the rules are different — there's no nudge
here (yet), only field-level retry:
- If the field has **no validation**, whatever they type is accepted as the
  answer (no such thing as "off-script" on an unvalidated question).
- If it **does** validate (email/phone/number) and the answer fails: a
  conversational-sounding reply ("how are you", anything with "?") or the
  2nd wrong try ends that step quietly and hands off to the AI (or silence,
  if AI is off) — this path does **not** currently escalate. If you want it
  to match the menu/form behavior above, that's a follow-up worth raising.

**On a WhatsApp Form**, one extra rule up front: typing "[form] …" (the raw
submission payload) always continues the flow, regardless of anything else.

## 3. No-reply reminders — automatic, no builder setup needed

Every waiting step (menu, question, or form) reminds a silent lead **twice**,
by default:

| When | Default message |
|---|---|
| 10 minutes after our last message, no reply | *"Just checking in 👋 Whenever you're ready, reply above and we'll pick up right where we left off."* |
| 1 hour after that, still no reply | *"We're still here to help! 🙂 Reply above to continue — or type "menu" to start over."* |

Rules:
- **Stops instantly on any reply** — even an off-script one. The reminder
  system checks "did anything arrive after our last action", not "did they
  answer correctly".
- **Resets per step** — moving to a new menu/question/form restarts the
  10-min timer fresh at that step.
- **Never breaks WhatsApp's 24-hour customer-service window** — no reminder
  sends outside it.
- A flow builder node can **override** these two defaults with its own
  reminder chain (any number of steps, any wording, any delay) — when it
  does, its chain replaces the defaults entirely for that node.
- Wording is deliberately generic ("reply above", not "tap an option above")
  because the SAME two defaults fire on every step type, including Question
  steps that show no buttons at all.
- Sends run on the conversation's own channel (WhatsApp/Instagram/Messenger/
  web chat) — a WhatsApp default doesn't leak onto an Instagram thread.

## 4. Fresh or idle chat, nothing matches, AI is off

If a message matches **nothing** — no open session, no trigger keyword, not
from an ad-linked flow — and **AI auto-replies are OFF** for that tenant, the
bot opens the tenant's **default flow** (whichever active flow on that
channel is triggered by "menu"/"hi"/"hello"/"start") so the person lands in
the main menu instead of getting silence.

This **only** fires when the chat is genuinely fresh or idle:
- **Never** on an Escalated conversation — a human owns it.
- **Never** within an hour of our last outbound message — a stray remark
  mid-conversation is not treated as "start over".

## 5. Session lifetime — the #1 gotcha when re-testing

A parked flow session (waiting on a menu/question/form) is remembered for
**24 hours**. If you test the same flow on the same number more than once in
a day, clearing your WhatsApp chat history does **not** reset our side —
you'll continue whatever step you were last on, not start fresh. Symptoms
this causes:
- A "brand new" test conversation opens straight into an off-script nudge or
  reminder from your *previous* test session.
- A step's nudge/reminder counters look like they carry across what feels
  like separate tests.

To force a truly clean start: send an explicit trigger keyword ("hi" or
"menu") — that always restarts the flow regardless of what it was doing —
or wait for the 3-nudge escalation to end the stale session automatically.

## 6. Where these are configured

All per-tenant — configuring one workspace never affects another's flows.

| Setting | Location |
|---|---|
| AI auto-replies ON/OFF | Settings → AI auto-replies |
| Off-script nudge ON/OFF + message variations | Settings → Off-script nudge |
| A specific node's own reminder chain | Flow builder → click the node → Reminders |
