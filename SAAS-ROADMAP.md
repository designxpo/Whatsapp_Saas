# Alabs Connect — SaaS conversion roadmap

This repo is a clean fork of the internal `wa-broadcaster`. Goal: turn the
single-tenant internal WhatsApp/Meta-Ads platform into a multi-tenant SaaS.
Tenancy model: **shared DB + Postgres RLS** (with app-layer scoping as the
primary guard, since the service-role client bypasses RLS).

The internal `wa-broadcaster` repo stays frozen; changes flow one-way into here.

---

## Infrastructure separation (do this before any data work)
The SaaS runs on **its own infrastructure**, fully separate from internal
`wa-broadcaster`:
- **Supabase** — a NEW, dedicated SaaS project (its own `NEXT_PUBLIC_SUPABASE_URL`
  + `SUPABASE_SERVICE_KEY`). Apply migrations `0001`→`0019` (+ `0020` when written)
  to it. Never share the internal project's DB.
- **Meta** — a separate **Tech Provider** app (`META_APP_ID`/`META_APP_SECRET`/
  `META_EMBEDDED_SIGNUP_CONFIG_ID`). No single hardcoded WABA token: each tenant
  connects its OWN number via Embedded Signup; tokens are stored encrypted
  per-tenant (`crypto.ts`).
- **CRM (LeadSquared, etc.)** — per-tenant, stored in the encrypted vault, not
  global env. The internal `LSQ_*`/`CRM_*` env vars were removed.
- **Gemini / cron / storage** — the SaaS operator's own keys.

`.env.example` reflects this SaaS shape; the inherited `.env.local` has been
reset to a blank scaffold so the fork never points at internal infra.

## Status legend
✅ done & typecheck-green · 🟡 partial/foundation · ⬜ not started

## Step 1 — Compliance moat (Meta Jan 15 2026 AI policy) ✅
The AI auto-reply is already the compliant shape (grounded, purpose-scoped,
escalates instead of free-chatting; no medical/legal/financial advice).
- Follow-up (nice-to-have): force every tenant agent to declare a purpose/scope
  so no one can configure an open-ended assistant. `src/lib/llm.ts:29` default
  persona is generic.

## Step 2 — Tenancy foundation 🟡
**Done:**
- `supabase/migrations/0019_tenancy.sql` — `tenants` table, `tenant_id` + FK +
  index + RLS on all 31 tenant-owned tables, backfilled to a default tenant.
  *Additive and non-destructive — safe to apply.*
- `src/lib/tenantdb.ts` — `tdb(tenantId)`, the primary isolation guard
  (auto-scopes every read/write; `.raw` escape hatch for complex queries).
- `src/lib/auth.ts` — `SessionUser`/JWT carry `tenantId`; `currentTenantId()`;
  login wires owner → default tenant, members → their tenant.
- `src/lib/store.ts` — `getTenantSetting`/`setTenantSetting` + encrypted
  `getTenantSecret`/`setTenantSecret`.

**Remaining (the big mechanical lift):**
1. ✅ **Tenant-scope the unique constraints** — `0020_tenant_unique_constraints.sql`
   written. Rescoped uniqueness to include `tenant_id` (composite PK for the
   three key-as-PK tables; composite unique for the rest) and added a
   tenant-filtered `match_semantic_cache` RPC — closing the cross-tenant cache
   leak. The matching `onConflict`/lookup call sites were updated in lockstep
   (`store.ts`, `router/cache.ts`, `adflow.ts`) using a non-breaking
   **default-tenant param** pattern: each write takes `tenantId =
   DEFAULT_TENANT_ID`, so existing callers keep compiling and routes pass a real
   tenant as they're retrofitted. Original table list:
   | table | current | must become |
   |---|---|---|
   | `contacts` | `unique(phone)` | `unique(tenant_id, phone)` |
   | `wa_conversations` | `unique(phone)` | `unique(tenant_id, phone)` |
   | `wa_optouts` | phone PK/unique | `unique(tenant_id, phone)` |
   | `wa_settings` | `key` PK | `unique(tenant_id, key)` |
   | `wa_semantic_cache` | norm unique idx | `unique(tenant_id, norm)` ← **cache leak risk** |
   | `wa_quick_replies` | `unique(shortcut)` | `unique(tenant_id, shortcut)` |
   | `wa_ai_functions` | `unique(name)` | `unique(tenant_id, name)` |
   | `wa_template_meta` | `template_name` PK | `unique(tenant_id, template_name)` |
   | `wa_ad_flow_triggers` | `unique(scope, ref_id)` | `unique(tenant_id, scope, ref_id)` |
   Keep global-unique (Meta-global ids, safe): `wa_channels.phone_number_id`,
   `wa_conv_messages.meta_message_id`, `wa_links.code`, `wa_users.email`
   (one email = one login). Verify the FK graph before dropping any text PK.
2. **Retrofit the data layer to thread `tenantId`** — `src/lib/store.ts`
   (~30 fns), plus `ads.ts`, `team.ts`, `flowengine.ts`, `campaign.ts`,
   `adflow.ts`, `adsmeta.ts`, router/*, kb. Swap `db()` → `tdb(tenantId)`.
3. **Pass `tenantId` from every route** — ~62 routes under
   `src/app/api/admin/**` already gate on `requireRoleAdmin()`; add
   `const tid = await currentTenantId()` and pass down. This is the
   object-level-authorization (BOLA) fix: scoping every query to the caller's
   tenant is what prevents cross-tenant access.
4. **Webhook tenant resolution** — inbound WhatsApp/IG webhooks have no session.
   Resolve tenant from the receiving `phone_number_id` / IG asset id
   (`wa_channels` → tenant_id) before doing any data work.

## Step 3 — Meta Tech Provider + Embedded Signup ⬜
Per-tenant WABA onboarding so each business connects its OWN WhatsApp number.
- Enroll the Meta app in the **Tech Provider** program; implement **Embedded
  Signup** (cap: 200 onboards / rolling week).
- New route `POST /api/admin/onboarding/whatsapp` — exchange the signup code →
  long-lived token → store via `setTenantSecret(tid, "wa_token", token)` and
  WABA/phone ids in tenant settings.
- Webhook subscription per WABA; verify `X-Hub-Signature-256` (already done for
  the shared webhook — keep per-tenant).
- The encrypted vault (`crypto.ts`) is ready to receive these tokens.

## Step 4 — Token vault + tenant-scoped authz 🟡
**Done:** `src/lib/crypto.ts` (AES-256-GCM envelope encryption) + the encrypted
`setTenantSecret`/`getTenantSecret` accessors. `SECRET_ENC_KEY` added to
`.env.example`.
**Remaining:** route the Meta token reads in `ads.ts` (and the WhatsApp send
path) through `getTenantSecret` once Embedded Signup stores them; tenant-scoped
authz lands with the Step 2 route retrofit.

## Step 5 — Instagram as a channel ⬜
IG Messaging API shares Meta Graph API + webhooks + the channel-agnostic flow
engine — so it's a channel type, not a new product.
- Extend `wa_channels` with `kind` ('whatsapp' | 'instagram') + IG asset ids.
- Request `instagram_manage_messages` in the same Embedded Signup.
- Handle IG webhook fields (`comments`, `messages`); add a **comment-to-DM**
  trigger node to the flow builder (one-block opening DM, 24h window — per
  Meta's IG rules).
- Reuse inbox, AI router, CRM as-is.

---

## Suggested execution order
1. 0020 unique-constraint migration (unblocks correct multi-tenant writes).
2. Data-layer + route retrofit to `tdb(tenantId)` (largest chunk; mechanical).
3. Embedded Signup (Step 3) — unlocks real external onboarding.
4. Instagram channel (Step 5).
5. Billing/metering, audit-log UI, MFA, DPDP/GDPR export-delete (SaaS polish).
