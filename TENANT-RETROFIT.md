# Tenant-write retrofit — making multi-tenancy real end-to-end

Goal: every read filters by `tenant_id` and every write stamps it, sourced from
the correct tenant for the context. **Contacts is done as the reference pattern.**

## The golden rule — where the tenant comes from (NEVER a magic default)
A blanket "default tenant" fallback in the data layer is DANGEROUS for
background contexts (it would mix tenants). Always source the tenant from the
entry point:

| Entry point | Tenant source |
|---|---|
| Admin API route (`/api/admin/*`) | `await currentTenantId()` (the session) |
| Owner impersonation | session tenantId (already set by impersonate) |
| Inbound webhook (WhatsApp/IG) | the **channel's** `tenantId` (`getChannelBy…(...).tenantId`) |
| Cron / background jobs | **iterate per tenant** — never assume one |
| Signup | the freshly created tenantId |

Store functions take `tenantId = DEFAULT_TENANT_ID` so existing callers compile,
but the real tenant must be threaded from the entry point above.

## Pattern (as applied to Contacts)
1. Store fn: add `tenantId` param; `.eq("tenant_id", tid)` on every read; stamp
   `tenant_id` on every write; thread it into helper calls (e.g.
   `getContactByPhone(phone, tid)`).
2. Route: `const tid = (await currentTenantId()) ?? DEFAULT_TENANT_ID;` and pass
   `tid` into each store call.
3. Webhook: pass `channel.tenantId`.

## Status
- ✅ **Contacts** — listContacts / recipientsForAudience / addContactTag /
  setContactAttributes / updateContactProfile / getContactByPhone /
  countContacts / upsertContacts + contacts route.
- ✅ **Settings / secrets** — getTenantSetting/setTenantSetting (done earlier).
- ✅ **Channels** — listChannels(tenantId) + save scoped (done earlier).
- ✅ **Semantic cache** — tenant-scoped (0020).
- ✅ **Sequence enroll / drip** — carries tenant via enrollment rows.
- ✅ **Conversations + messages** — getOrCreateConversation / getConversationByPhone /
  listConversations / appendConvMessage scoped + stamped; threaded from both
  webhooks (`channel.tenantId`) and the inbox route (`currentTenantId`).
  `Conversation.tenantId` now carried on the type/mapper, so `assistant.ts` uses
  `conv.tenantId` for the daily cap. *Still to thread:* flowengine tag/attribute
  writes — tracked under the Flows/AI domain below.
- ✅ **Campaigns + queue + send log + cron** — `Campaign.tenantId` on the
  type/mapper; createCampaign/getCampaign(optional scope)/listCampaigns/
  listAutomations/getAutoSend/disableAutomation/enqueue/insertLog/dailySentCount/
  scheduleSend/getAnalytics all tenant-aware. `sendCampaign` (whatsapp.ts) carries
  `tenantId` → stamps the send log. `campaign.ts` drains use `campaign.tenantId`
  (per-tenant daily headroom + log). `broadcast.ts`/`autosend.ts`/`apirules.ts`
  threaded; admin routes pass `currentTenantId()`.
  **Key finding — the cron is NOT the feared sharp edge:** every send resolves
  credentials from `credsFor(campaign.channelId)` (the campaign's *own* channel),
  so iterating campaigns globally never sends through another tenant's number. No
  per-tenant cron loop is required for credential safety — only per-tenant daily
  caps (now done: `dailySentCount(tenantId)`, and `drainRuleSends` computes
  headroom per tenant and releases the claim back to `pending` when a tenant is
  capped). *Pending:* per-tenant **API keys** — `/api/broadcast`, `/api/events`,
  `/api/contacts` use a single shared `BROADCAST_API_KEY` (`apiKeyOk`) and
  therefore resolve to the default tenant; when public API keys become
  per-tenant, thread the resolved tenant into `runBroadcast`/`processEvent`/
  `fireTrigger`/`getContactByPhone` there (Phase: public-API). Also `flowengine`/
  `commerce` `sendCampaign` calls still default — tracked under Flows/commerce.

- ✅ **Opt-outs** — `optoutSet(tenantId)` / `listOptouts(tenantId)` /
  add/removeOptout scoped + stamped; threaded into `sendCampaign`
  (`params.tenantId`), `assistant` (`conv.tenantId`), both webhooks
  (`channel.tenantId`/`tid`), and the admin optouts route. A STOP for one
  business never suppresses another's sends.
- ✅ **Quick replies** — list/create/delete scoped; admin route passes
  `currentTenantId()`. (CRM thread panel defaults — shared-token integration.)
- ✅ **KB / RAG** — createDocument/setDocStatus/listDocuments/deleteDocument/
  replaceChunks/matchChunks scoped + stamped; `kb.ts` ingest/retrieve thread
  `tenantId`. **New migration 0026** rewrites `match_kb_chunks` to take
  `p_tenant_id` and filter (so one tenant's RAG never grounds on another's
  docs — mirrors the 0020 `match_semantic_cache` pattern). `generateReply`
  gained a `tenantId` param → `retrieve(..., tenantId)`, threaded from the IG
  webhook, assistant, assistant-test, and flow-simulate.
- ✅ **Templates / click-links** — `setTemplateMeta`/`getTrackedUrls`
  tenant-scoped (composite PK `(tenant_id, template_name)` from 0020);
  `mintLinks` stamps `tenant_id`; `sendCampaign`/`sendTemplateTest` thread it;
  templates route passes `currentTenantId()`. Click-stats query by
  `campaign_id` (ownership pre-checked in the funnel route). **Forms (waforms):**
  live on Meta under the channel's WABA → already isolated by channel creds, no
  local tenant column needed.

## Apply before going live
Run migration **0026_kb_tenant_match.sql** alongside 0019–0025 on the SaaS
Supabase (it redefines the KB match RPC with the required `p_tenant_id` arg —
`matchChunks` now passes it, so the old 2-arg RPC would error).

## Remaining (apply the same pattern)
Per domain: add `tenantId` to the store fns, scope reads/writes, thread from the
route/webhook/cron.

| Domain (store.ts unless noted) | Functions | Entry points to thread |
|---|---|---|
| **Conversations** | getOrCreateConversation, getConversationByPhone, getConversation, listConversations, set/assign/labels, touchInbound/Outbound, claimReply, conversationsNeedingReply | livechat routes (`currentTenantId`); WA+IG webhooks (`channel.tenantId`); cron `conversationsNeedingReply` → per-tenant |
| **Conversation messages** | appendConvMessage, getConvHistory, messageLogged | same as conversations |
| **Campaigns + queue + send log** | createCampaign, listCampaigns, getCampaign, enqueue, claimPending, markQueue, insertLog, logCounts, dailySentCount, getAnalytics | campaigns/broadcast routes; cron `drainQueue`/`drainAutoSends` → **per-tenant loop** |
| **Opt-outs** | addOptout/removeOptout/listOptouts/optoutSet | routes; webhook (`channel.tenantId`) |
| **Quick replies** | list/create/delete | settings route |
| **KB (RAG)** | createDocument/listDocuments/replaceChunks/matchChunks | kb routes; `matchChunks` RPC needs a tenant arg (like the cache RPC) |
| **Flows** | listFlows/getFlow (flowengine) | already filters by channel; add tenant filter; webhook passes channel tenant |
| **AI agents / functions / prompts** | aihub.ts | aihub routes |
| **Ads** | ads.ts, adflow.ts, adsmeta.ts, adrules.ts | ads routes; per-tenant Meta creds from the channel/tenant vault |
| **Templates / forms** | template_meta, waforms | routes |

## Cron is the sharp edge
`drainQueue`, `drainAutoSends`, `drainRuleSends`, `drainFlowReminders`,
`drainSequences`, `drainAbandonedCarts`, `conversationsNeedingReply` currently
run globally. Each must either already carry tenant on its rows (sequences,
enrollments, carts do) or be refactored to **process per tenant** so sends use
that tenant's channel/credentials. Audit each before enabling real tenants.

## Verification
Best done against a **live multi-tenant Supabase** with 2+ tenants: confirm
tenant A never sees/writes tenant B's rows. Until then, typecheck + build guard
the mechanical correctness only.
