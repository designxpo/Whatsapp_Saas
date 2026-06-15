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
