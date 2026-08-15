# Talko Copilot — browser extension

Capture a lead from **any** web page into Talko in one click, then reach them on
WhatsApp with your approved templates. The extension is a thin client of your own
Talko backend — it never talks to WhatsApp, LinkedIn, or any other platform
directly, never acts in the background, and records every lead it adds in your
portal.

Covers **Phase 1** (capture + quick actions) and **Phase 2** (inbox side-panel +
draft-reply overlay) from the product plan.

---

## What it does

**Phase 1 — capture & quick actions**

| Feature | How | Where it lands in the portal |
| --- | --- | --- |
| **Capture anywhere** | Highlight a name + phone on any page → a floating **Add to Talko** chip → click it | Contacts, tagged `extension` + `web-capture` + `source:<site>`; fires the `contact_added` automation |
| **Right-click capture** | Select text → right-click → *Add "…" to Talko as a lead* | same as above |
| **Keyboard capture** | Select text → `Alt+Shift+L` | same as above |
| **Manual capture** | Toolbar icon → fill the form (pre-filled from your selection + the page URL) | same, plus any tags you add |
| **Where-from record** | Every capture also posts a `web_capture` event carrying the `source_url` | Event/automation history |
| **Scan page for contacts** | Popup → **Scan page** → every name, number and email on the page you're looking at, listed for review → tick who to keep → **Add to Talko** | Contacts, tagged `page-scan` + `web-capture` + `source:<site>` |
| **Quick WhatsApp link + QR** | Popup builds a `wa.me` click-to-chat link and a printable QR | opens WhatsApp — you send, manually |
| **Light / dark / system theme** | The switch in the panel header (or Settings → Appearance) themes the panel, popup, settings page and the on-page chip together | preference only, saved in `chrome.storage.sync` |

**Phase 2 — inbox & AI drafts**

| Feature | How | Where it lands in the portal |
| --- | --- | --- |
| **Needs-reply badge** | The toolbar icon shows a count of conversations waiting for a reply, refreshed every few minutes | reads `/api/inbox?needsReply=1` |
| **Inbox side-panel** | Popup → **Inbox** → your conversations, with the portal's own filters: **Chats / Comments**, status (All / Needs reply / Escalated / Human) and search by name or number | reads your live conversations |
| **Split by source channel** | Tabs for **All / WhatsApp / Instagram / Facebook / Web chat** (the portal's own labels), each with a live count; every row also carries a channel badge on its avatar | reads `/api/inbox?platform=…` |
| **Thread controls** | Pause or resume the AI, **Escalate** / Mark active, one-tap **quick replies**, Open in portal | same actions as the portal's Live Chat |
| **Reply from the panel** | Open a thread → type (or **✨ Draft with AI**) → **Send**. Works on **WhatsApp, Instagram, Facebook and web chat** — each goes out through its own official API | logged on the thread as an agent reply; pauses the bot |
| **Window-aware sending** | Free-form inside the 24h window. WhatsApp additionally offers a picker of your **approved templates** when it's closed; Instagram/Facebook have no template option, so the panel says to wait for the customer; web chat has no window at all | respects each platform's messaging policy |
| **Draft-reply overlay** | On YouTube / Google Business, highlight a comment/review → **✨ Draft reply** → copies an AI draft grounded only in that text | you paste & post it yourself |

**Phase 3 — know the customer, and close the sale**

| Feature | How | Where it lands in the portal |
| --- | --- | --- |
| **Context card** | Every thread opens with who they are: order count, lifetime spend, last order, lead source, pipeline stage | reads Contacts + Orders + Pipeline |
| **CRM edits in the chat** | Add/remove tags, save a private note, move the pipeline stage — without leaving the conversation | Contacts + Sales Pipeline (stage effects fire, incl. the CRM push) |
| **Contacts book** | A third tab searches **all** contacts, not just open chats, so you can message a past customer first | opens the chat, or starts one with an approved template |
| **Send a product** | Search your catalog in the composer → **Send** drops name, price and link into the reply | Catalog |
| **Take payment** | **+ Cart** builds the order → **Send payment link** creates it and drafts the link for you to send | Orders (cart → order → paid) |

Everything is **human-in-the-loop**: nothing is captured, drafted, or sent
without a click.

---

## Bonus: find leads elsewhere (not a Talko channel)

Everything above stays inside Talko's actual domain: official APIs (WhatsApp
Cloud API, Instagram Messaging, Facebook Pages), an inbox, a CRM. **Find leads**
is a separate, smaller thing bolted onto the same popup — a prospecting helper
for platforms Talko doesn't and can't integrate with.

| Feature | How | Where it lands |
| --- | --- | --- |
| **Find leads** | Popup → **Find leads** → every high-intent post/comment on the page you're looking at (Reddit, X, LinkedIn, Discord, or any other page) — someone asking for a recommendation, complaining about a tool, comparing options, asking about pricing → **✨ Draft opener** writes a short, grounded DM opener to copy | Nowhere in Talko. Paste the opener into that platform's own DM composer yourself |

Why it's kept separate: Talko has no official messaging API for Reddit, X,
LinkedIn or Discord DMs, so a reply there can never appear in Talko's inbox,
and (since a Talko contact requires a phone number) a social handle can't be
saved as one either. This feature only helps you *find* and *start* a
conversation elsewhere — once someone replies, that's a conversation on their
platform, not a Talko one. If you get their number from it, use **Grab
selection** or the manual capture form to bring them into Talko properly.

---

## Install (unpacked, for testing)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the Talko Copilot icon → **Settings** (or right-click the icon → Options).
5. In your Talko portal, go to **Settings → API keys**, create a key
   (`ak_live_…`), and paste it into the extension. Click **Test connection** —
   it should show *Connected — <your workspace>*.

The key is stored only in your browser (`chrome.storage.sync`) and sent only to
your workspace over HTTPS.

**Plan requirement:** Copilot's connect step and everything in Phase 2/3 below
(the Inbox side-panel, AI drafts, Find leads) need a **Creator Pro, Growth, or
Scale** plan — Creator and Starter don't include it, and **Test connection**
will show *Upgrade required* instead of connecting. Basic capture (**Grab
selection** / **Scan page** → Contacts) isn't gated and works on every plan,
since it shares `/api/contacts` with the general Developer API.

---

## Permissions — and why each is needed

Minimal by design (this list is what a Chrome Web Store reviewer will see):

| Permission | Why |
| --- | --- |
| `storage` | Save your API key and capture defaults locally |
| `contextMenus` | The right-click "Add to Talko" item |
| `activeTab` + `scripting` | Read the current tab **when you invoke the extension**: the text you highlighted (Grab selection), its visible text once to list the contact details on it (Scan page), or its visible posts/comments once to find high-intent ones (Find leads). Only on your click, only the tab in front of you, never in the background |
| `notifications` | Confirm "Lead added" after a right-click / keyboard capture |
| `sidePanel` | The inbox side-panel |
| `alarms` | Poll every few minutes for conversations that need a reply (the toolbar count) |
| `host_permissions: https://app.thetalko.in/*` | Talk to **your** Talko API (and nothing else) |
| `content_scripts: <all_urls>` | Show the capture chip when you select text. The script reads **only `window.getSelection()`** on your action — it does not read page content otherwise, and never automates the page |

No `tabs` history, no `webRequest`, no cookies, no third-party hosts.

---

## Architecture

```
 content.js / popup.js / context menu / shortcut
        │  (only your highlighted text + the page URL)
        ▼
 background.js  ── the ONLY place that calls the API
        │  Authorization: Bearer ak_live_…
        ▼
 https://app.thetalko.in
   GET  /api/whoami                        → validate key + show workspace
   POST /api/contacts                      → lead saved + welcome automation
                                             (also the Scan page bulk import)
   POST /api/events                        → web_capture record (source_url)
   GET  /api/inbox                         → recent conversations
   GET  /api/inbox/thread                  → one thread's messages
   POST /api/inbox/reply                   → send a reply on the chat's own channel
   POST /api/inbox/actions                 → pause/resume the AI, escalate
   GET  /api/inbox/quick-replies           → the tenant's canned replies
   GET  /api/inbox/contact                 → contact + orders + pipeline stage
   POST /api/inbox/contact                 → tags / note / stage
   GET  /api/inbox/contacts                → search the whole contact book
   GET  /api/inbox/commerce                → catalog + this chat's open cart
   POST /api/inbox/commerce                → build the cart, create a pay link
   POST /api/inbox/suggest                 → AI-drafted reply for a thread
   GET  /api/inbox/templates               → approved templates for a thread's number
   POST /api/assist/draft                  → draft a public reply to a review/comment
   POST /api/assist/outreach               → draft a private DM opener for a found lead
        ▼
 Your Talko portal (Contacts, Conversations, Automations, Activity)
```

`background.js` is the only component that reaches the network — content scripts
message it, so the host_permission bypasses CORS and no page can see your key.

## Files

```
manifest.json         MV3 manifest
icons/                16 / 48 / 128 px
src/
  api.js                  thin API client (whoami, addLead/addLeads, inbox, draft)
  wa.js                   pure helpers (phone parse, wa.me link, QR url)
  scan.js                 pure page-scan parser (candidates → reviewable contacts)
  signals.js              pure intent-signal scorer (candidates → high-intent leads)
  theme.js                light / dark / system, shared by every surface
  tokens.css              the one palette + the theme contract
  channels.js             channel labels + plain-language messaging-window wording
  format.js               money, cart and product-message formatting
  background.js           service worker — context menu, shortcut, API calls
  popup.html/.css/.js     toolbar capture form + quick actions + Inbox launcher
  options.html/…          connection + capture defaults
  content.js/.css         selection chip — capture + draft-reply
  sidepanel.html/.css/.js the inbox (list → thread → AI draft → send)
```

## Compliance notes

- **Messaging:** every send goes through the official API for that channel via
  your backend — WhatsApp Cloud API, Instagram Messaging, Facebook Pages — inside
  each platform's 24-hour window, with approved templates where WhatsApp requires
  them, honouring opt-outs. No unofficial clients and no browser automation.
- **Reading pages:** three moments only, all started by the tenant — the text
  they highlight, one pass over the visible text of the current tab when they
  press **Scan page**, and one pass over the visible posts/comments on the
  current tab when they press **Find leads**. Results are *proposals*: they stay
  in the popup, and a drafted opener is copy-only — never sent, never posted,
  never auto-connected to anyone. Nothing is crawled, no other tab is touched,
  nothing runs in the background, and no site is ever automated (no
  auto-connect, no auto-message, no auto-DM) — that's what keeps accounts safe
  and the listing reviewable.
- **Data:** the tenant stays the data controller; captured leads go only to that
  tenant's Talko workspace. A lead is stored *not opted-in* unless you tick the
  consent box, and only opted-in contacts enter marketing broadcasts.
