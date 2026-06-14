# Platform Plan — inspiration from AiSensy & Interakt

Research date: 2026-06-10. Sources: aisensy.com features/tutorials/help-center,
interakt.shop, G2/comparison reviews. Goal: make this internal tool as
self-explanatory and capable as the commercial platforms, without billing/multi-tenant
complexity.

## What the leaders do well

### AiSensy
- **Guided onboarding**: account → embedded Meta signup → display-name verification
  → first template → first campaign. Help-center quick-start collection mirrors the
  in-app checklist. Heavy handholding to first message.
- **Campaign funnel + smart retargeting** (their killer feature): every broadcast
  shows Sent → Delivered → Read → Replied → Clicked in real time, and you can
  one-click re-broadcast to a behavioral segment ("delivered but not read",
  "read but not clicked").
- Template approval tracking inside the dashboard (10min–1hr turnaround visible).
- Click-to-WhatsApp ads attribution.

### Interakt
- **Nav IA**: Inbox · Contacts · Campaigns ("Market") · Templates · Automation ·
  Commerce · Analytics · Settings — task-oriented, inbox first.
- **Shared team inbox depth**: filters (unassigned/open/resolved), agent assignment,
  labels, private notes, canned/quick replies, working-hours + away message,
  welcome message on first contact.
- **Drag-drop flow builder**: no-code chatbot flows for FAQs/lead capture/order
  tracking; claims ~80% query automation. WhatsApp Flows (native forms) for
  structured data collection.
- Auto-segmentation on customer events; Shopify-first commerce (catalog, cart
  reminders).

## What we already match or beat
- AI answers grounded in a knowledge base (neither does RAG this well)
- Knowledge Router (FAQ/cache/memory) — cost control they don't expose
- CRM deep-link (LeadSquared chat panel + timeline sync)
- Attribute segmentation, opt-out compliance, daily-cap quality protection

## Incubation roadmap (ranked by value ÷ effort)

### Phase 1 — usability (DONE 2026-06-10)
1. ✅ **Home tab with setup checklist** (AiSensy onboarding pattern):
   `/api/admin/system/status` probes every integration and shows
   green/amber steps with fix instructions + a 4-step "how to use" guide.

### Phase 2 — inbox parity (DONE 2026-06-10)
2. ✅ **Quick replies**: wa_quick_replies + Settings tab CRUD; ⚡ picker in
   ThreadPanel (or type /) and chips in /crm/chat.
3. ✅ **Welcome + away messages**: Settings tab toggles; webhook sends greeting
   on first-ever inbound (atomic claimWelcome), away notice outside working
   hours (once/12h per conversation). AI keeps answering either way.
4. ✅ **Conversation labels + agent assignment**: chips + assign in ThreadPanel,
   shown in inbox list with filters (All / Needs reply / Escalated / Human-handled).

### Phase 3 — campaign intelligence (DONE 2026-06-10)
5. ✅ **Campaign funnel view**: click a campaign in History → Read / Delivered /
   Sent / Failed / Skipped bars from wa_send_log.
6. ✅ **Smart retargeting**: "Retarget →" on any funnel segment prefills the
   Broadcast tab with that segment's recipients (opt-outs excluded).
7. **Scheduled + recurring campaigns**: scheduling exists; add recurrence rule.

### Phase 4 — automation builder (DONE 2026-06-10)
8. ✅ **Drag-drop chatbot flow builder** (Chatbot Flows tab → full-screen
   React Flow canvas at /admin/flows/[id]): keyword triggers; node types
   message / buttons / list / media / ask-question (saves to contact
   attribute) / condition (attribute branch) / catalog product / human
   handoff / end. Built-in simulator (dry-run, no WhatsApp needed).
   Engine runs before the AI in the webhook; off-script replies fall through
   to the RAG assistant — smarter than AiSensy/Interakt dead-end fallbacks.
   Catalog senders (sendProduct/sendProductList) ready — needs a catalog
   connected to the WABA in Meta Commerce Manager.
9. **WhatsApp Flows (native forms)** for structured lead capture — later.

### Phase 4b — AI Hub (DONE 2026-06-10, Xbot-inspired)
- ✅ **AI Agents**: persona/constraints/product-info editor with ✨ auto-generated
  structured prompts (PERSONA & ROLE / BEHAVIOR / FLOW / DATA RULES); one
  active agent shapes the bot's system prompt; per-agent model override.
- ✅ **AI Functions**: Gemini function-calling lead capture — the model extracts
  parameters mid-conversation, saves them to contact attributes (feeds
  broadcast segmentation), optionally POSTs to a webhook, optionally hands
  off to a human. Verified end-to-end: name/city/course/phone extracted from
  one natural message and saved.
- ✅ **AI Prompts**: inbox agent-assist (✨ in ThreadPanel) — tone change,
  translate, fix grammar, shorten; CRUD with sample chips in AI Hub tab.
- Fix shipped with it: FAQ router keyword tier now skips messages >12 tokens
  (long conversational messages belong to the agent/LLM, not FAQ lookup).

### Phase 5 — growth surface
10. **Click-to-WhatsApp ads attribution** (referral payload already arrives in
    the webhook — log + report it).
11. **Opt-in widget / wa.me QR generator** page for the website.
12. **Multi-number support** once a second WABA exists.

## Explicitly NOT copying
- Billing/plans/conversation-credit metering (internal tool)
- Multi-tenant workspace switching
- Their generic GPT chatbot add-on (our RAG + router is stronger)
