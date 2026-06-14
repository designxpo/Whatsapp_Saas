# Gap Analysis — vs. AiSensy (internal WhatsApp automation tool)

Comparison of the current app against AiSensy's feature set, with a prioritized
roadmap. Goal: a complete internal WhatsApp automation platform.

Legend: ✅ done · 🟡 partial · 🔵 planned (UI/plan exists) · ❌ missing

---

## What we already have (the foundation is solid)

| Capability | State | Where |
|---|---|---|
| Broadcast to all / tag / pasted list | ✅ | `broadcast.ts`, admin Broadcast tab |
| Approved-template send + `{name}` substitution | ✅ | `whatsapp.ts:sendCampaign` |
| Header-image on templates + upload | ✅ | `supabase.ts`, `/api/upload` |
| Background queue + cron drain | ✅ | `campaign.ts`, `/api/cron/process-queue` |
| Daily send cap (tier safety) | ✅ | `drainQueue` |
| Opt-out suppression + STOP list | ✅ | `store.ts`, Opt-outs tab |
| Delivered / read webhook tracking | ✅ | `webhooks/whatsapp` (statuses) |
| Per-recipient send log | ✅ | `wa_send_log` |
| One-time scheduled broadcasts | ✅ | `broadcast.ts` (`scheduledFor`) |
| Single-step event auto-sends (contact_added / api_event + delay) | ✅ | `autosend.ts`, Automations tab |
| Contacts: CSV import, tags, search, API push | ✅ | Contacts tab, `/api/contacts` |
| Campaign history + counts | ✅ | Campaigns tab |
| Server-to-server API (Bearer) | ✅ | `/api/broadcast`, `/api/contacts`, `/api/events` |
| Admin auth (JWT password) | ✅ | `auth.ts` |
| AI auto-reply (Gemini + RAG) | ✅ | full backend + Team Inbox built (needs creds to go live) |

**This is a strong outbound + automation engine.** The gaps are mostly **inbound,
conversational, and team/ops** features — exactly what makes AiSensy a "platform"
rather than a broadcaster.

---

## Critical gaps (core to being "like AiSensy")

| # | Feature | State | Why it matters | Effort |
|---|---|---|---|---|
| 1 | **Two-way / inbound messages** | ✅ built | Nothing inbound works without this — it's the base for inbox, chatbot, AI reply | M |
| 2 | **Team Inbox / Live Chat** | ✅ v1 built (threads, manual reply, bot toggle, escalate) | Agents read & manually reply to conversations; the heart of AiSensy | L |
| 3 | **Template management (create/submit)** | ✅ built (create/submit/delete + status UI) | Create + submit templates for Meta approval from the UI, track status | M |
| 4 | **Interactive messages** (quick-reply & CTA buttons, list, carousel) | ✅ buttons+lists built (carousel ❌) | Buttons drive most WhatsApp engagement & chatbot flows | M |
| 5 | **Rich media send** (image/video/doc/audio/location) | ✅ sendMedia built (location ❌) | Send any media in broadcasts & replies | S |
| 6 | **No-code chatbot flow builder** | ❌ | Keyword/menu/button flows without an LLM — AiSensy's signature feature | L |
| 7 | **Multi-agent + RBAC** | ❌ single password | Multiple users, roles (admin/manager/agent), permissions | M |
| 8 | **Analytics dashboard** | ✅ v1 built (rates, 14-day volume, conv stats) | Delivery/read/reply rates, volume over time, agent stats, funnel | M |
| 9 | **Advanced segmentation** (attributes, last-active, behavior) | 🟡 tags + attribute filters built | Dynamic audiences beyond a single tag | M |
| 10 | **Custom contact attributes / fields** | ✅ built (jsonb attributes + audience filter) | Personalization & segmentation depend on richer contact data | S |

---

## Secondary gaps (expected in a complete platform)

| Feature | State | Notes |
|---|---|---|
| Drip campaigns / multi-step sequences | 🟡 single-step only | Chain messages with delays & branches |
| Recurring / repeat campaigns | 🟡 one-time only | Daily/weekly schedules |
| Agent routing & auto-assignment | ❌ | Round-robin / rules-based chat assignment |
| Quick replies / canned responses + labels | ❌ | Inbox productivity |
| Opt-in growth tools | ❌ | wa.me links, QR codes, chat widget, opt-in forms |
| Click-to-WhatsApp Ads integration | ❌ | FB/IG ad → conversation attribution |
| Integrations (Shopify, Sheets, Zapier, CRM) | 🟡 generic API | Prebuilt connectors |
| WhatsApp Catalog / Commerce / Payments | ❌ | Product catalog, cart, order, pay |
| WhatsApp Flows (Meta native forms) | ❌ | In-chat structured forms |
| Multi-number / multi-WABA | ❌ | Manage several numbers (discussed earlier) |
| Conversation-based cost / wallet tracking | ❌ | Meta's per-conversation pricing visibility |
| Audit log / activity trail | ❌ | Who did what (matters once multi-agent) |
| Retargeting (resend to non-openers) | ❌ | Re-engage by delivery/read status |
| 24h session-window tracking + template fallback | ❌ | Enforced once inbound exists |

---

## Where we can beat AiSensy (our differentiator)

The **Gemini + RAG AI assistant** (already planned) is a genuine edge — AiSensy's
chatbot is largely rule-based; doc-grounded AI replies are more capable. Lean into:

- **AI-grounded auto-reply** over the business knowledge base (planned).
- **AI-assisted agent replies** — suggest a draft in the inbox for a human to approve.
- **AI broadcast composer** — generate/personalize campaign copy.
- **AI intent routing** — classify inbound and route/escalate intelligently.
- **Hybrid bot↔human handoff** — AI handles routine, escalates cleanly to the inbox.

---

## Recommended roadmap (internal-tool priorities)

Sequenced so each milestone is usable on its own. Internal use means we can
**skip** billing/wallet, white-label, and multi-tenant for now.

**Milestone 1 — Make it conversational (unlocks everything inbound)**
- Inbound message handling (gap 1) → conversations + message store
- 24h-window tracking
- Team Inbox v1: read threads, manual reply, bot on/off toggle (gap 2)
- Rich media send (gap 5)

**Milestone 2 — The AI assistant (our edge, plan already written)**
- Gemini + RAG backend behind the AI Assistant tab (AUTOMATION-PLAN.md)
- KB ingestion (PDF/Word/text/URL → pgvector)
- AI-suggested replies in the inbox (hybrid handoff)

**Milestone 3 — Engagement depth**
- Interactive buttons / list / CTA messages (gap 4)
- Template management: create + submit + status (gap 3)
- Custom contact attributes + advanced segmentation (gaps 9, 10)
- Quick replies, labels, canned responses

**Milestone 4 — Flows & ops**
- No-code chatbot flow builder (gap 6) — keyword/menu/button trees
- Multi-step drip sequences + recurring campaigns
- Analytics dashboard (gap 8)
- Multi-agent + RBAC + audit log (gap 7) — needed once a team uses it

**Milestone 5 — Growth & integrations**
- Opt-in tools (wa.me, QR, widget)
- Integrations (Sheets/Shopify/Zapier/CRM)
- Click-to-WhatsApp ads, retargeting
- Multi-number, catalog/commerce (if needed)

---

## Suggested next step

Milestone 1 is the unlock — without inbound messaging, the inbox, chatbot, and AI
reply all stay blocked. It also reuses infra we already have (webhook signature
verification, Supabase, cron). The AI Assistant tab UI is already built and waiting
for it.
