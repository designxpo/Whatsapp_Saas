# WhatsApp Usernames — Identity Model & Product Plan

Status: **design / spec** · Owner: platform · Applies to: **Talko AI (SaaS)** primarily; the internal `wa-broadcaster` app shares the same identity code, so the model ports 1:1.

---

## 1. Why this matters (the strategic frame)

For every WhatsApp business platform the **phone number is the identity primitive** — it's how we dedupe contacts, attribute leads, and sync to the CRM (LeadSquared keys on phone). WhatsApp usernames (`@handle`) make the number **optional and hideable**. That is both:

- a **threat** — a lead who messages via `@handle` with a hidden number breaks any phone-keyed CRM (silent drop / misattribution), and
- a **moat** — whoever is **username-native first** can run privacy-first, brand-first funnels the phone-bound competitors can't.

**Our unfair advantage:** we already run number-less identities in production. Instagram (IGSID → enrich to `lead_phone`), Messenger (PSID), and web-chat (`web:<uuid>`) all flow through the same code. A WhatsApp username is *the same pattern*, so this is an **extension of a proven capability, not a rebuild.**

---

## 2. The one honesty check: what the Cloud API actually exposes

WhatsApp usernames are (today) a **consumer-app** feature. Before promising the number-hiding parts, confirm against current Meta docs, because two things are unknown/moving:

1. **Does consumer→business inbound hide the number?** Historically the Cloud API always delivers the sender's `wa_id` (their phone) in the webhook. If that stays true, the lead's number is **not** hidden from the business yet — so the "CRM breaks" threat is *forward-looking*, not live.
2. **Click-to-chat by username & WABA-owned handles** — whether a business number can own/advertise a `@handle` and receive chats addressed to it via the API.

**Consequence for planning — split the value in two:**

| Track | Depends on | Confidence | Ship |
|---|---|---|---|
| **A. Business-side branded handle** (advertise `@handle` as a trackable, brand-safe entry point) | Nothing new — works even if the lead's number is still delivered | **High / near-term** | Now |
| **B. Lead-side number-hiding** (identity + CRM resolution when the number is absent) | Meta hiding the sender number for business inbound + username in webhook | **Speculative / API-gated** | Design now, flip on when the API lands |

Track A is the sellable feature you can build today. Track B is the moat you *prepare* for so you're first when Meta ships it — and it's cheap because IG already does it.

---

## 3. Current identity model (grounded in code)

- `getOrCreateConversation(phone, name, channelId, platform, tenantId)` — `src/lib/store.ts:697`. The `phone` argument is really an **identity slot**: WhatsApp is digit-normalized (`digits()`), while IG/Messenger/web-chat pass opaque IDs untouched (`phone.trim()`), keyed unique on `(tenant_id, phone)`.
- `getConversationByExactPhone(...)` — `src/lib/store.ts:735` — exact-identity lookup with **no** digit-normalization, built for non-phone channels (`web:<uuid>`). This is exactly what a handle needs.
- `lead_phone` column + `getConversationByLeadPhone(...)` — `src/lib/store.ts:657,740` — the **enrichment slot**: a real phone captured from a number-less channel (IG), used for CRM matching.
- `extractPhone(text)` — `src/lib/leadsquared.ts:288` — already pulls a real number out of free text ("here's my WhatsApp: …"), the enrichment mechanism.
- CRM resolution:
  - `findLeadId(phone, c)` — `src/lib/leadsquared.ts:246` — phone-keyed.
  - **`findLeadIdByHandle(handle, c)`** — `src/lib/leadsquared.ts:266` — **already resolves a lead by a handle** stored in a tenant-configured LSQ field (`igHandleField`, e.g. `mx_Instagram`), trying both `h` and `@h`.
  - `syncLeadProfile(p, tenantId)` — `src/lib/leadsquared.ts:170` — writes captured email/city to the matched lead, gated to real phones so number-less channels can't create junk leads.

**Takeaway:** the non-phone identity, the enrichment slot, and handle-based CRM resolution all already exist. A WhatsApp username reuses all three.

---

## 4. Proposed design — username-native identity

### 4.1 Storage
Add a dedicated, nullable, per-tenant-unique **`handle`** column to `wa_conversations` (mirrors how `lead_phone` was added for IG). Do **not** overload the `phone` slot with a handle for `platform='whatsapp'` — that slot is digit-normalized and would collide.

```
alter table wa_conversations add column if not exists handle text;   -- WhatsApp @username (no leading @), null when unknown
create unique index if not exists wa_conversations_tenant_handle_idx
  on wa_conversations (tenant_id, lower(handle)) where handle is not null;
```

### 4.2 Identity resolution (the merge rule)
A WhatsApp lead can arrive **number-first** (today) or **handle-first** (Track B). Resolve in priority order and **merge** when both become known:

1. If a number is present → resolve/create by `phone` (unchanged path).
2. Else resolve/create by `handle` (new `getConversationByHandle`, an exact lookup like `getConversationByExactPhone`).
3. When a handle-first conversation later reveals a number (lead types it, or the API surfaces it): backfill `phone`/`lead_phone`, and if a numbered conversation already exists, **merge** the handle thread into it (move messages, keep the richer record). One helper: `mergeConversations(fromId, intoId, tenantId)`.

This is the same shape as IG's "IGSID thread → `lead_phone` captured → CRM match," so the flow, the flow-engine gating, and the AI reply path need no conceptual change — only a handle-aware branch.

### 4.3 CRM sync (LeadSquared)
- Add a tenant config field `waHandleField` (LSQ schema name, e.g. `mx_WhatsAppHandle`) — mirror of the existing `igHandleField` in `LsqCreds`.
- Extend `syncLeadProfile` to accept a `handle` and, when no phone is known, resolve the lead via `findLeadIdByHandle(handle, c)` (**already implemented** — just pass `waHandleField`) and write the handle onto the lead so future messages match. Keep the real-phone gate: still prefer phone when present; never create a bare lead from a handle unless the tenant opts in (mirror `autoCreate`).
- Result: **leads sync and dedupe by handle even when the number is hidden.** This is the line competitors can't match.

### 4.4 Attribution — the "Handle Hub"
Reuse the existing ad-referral/CTWA attribution: every place we surface the `@handle` (QR, link-in-bio, ad, website widget, IG bio, email footer, packaging) carries a per-source **reference tag**, so the CRM records exactly which touchpoint started each chat. A small admin surface to mint tracked handle links + QR codes is the Track-A product.

---

## 5. Concrete change list

**Buildable now (Track A + Track B groundwork, no new Meta API):**
- **Migration** — `handle` column + unique index (above); tenant config key `waHandleField`.
- **store.ts** — `getConversationByHandle(handle, tenantId)`; handle-aware branch in `getOrCreateConversation`; `setConversationHandle(id, handle)` (mirror `setConversationLeadPhone`); `mergeConversations(fromId, intoId, tenantId)`.
- **leadsquared.ts** — thread a `handle` through `syncLeadProfile`; wire `findLeadIdByHandle` to `waHandleField`; write the handle onto the lead on capture.
- **Admin UI** — tenant sets/reserves their `@handle`; Handle Hub page to generate tracked links + QR per source; handle-reservation checklist.
- **Attribution** — reference-tag plumbing on handle entry points → CRM source field.

**API-gated (Track B, flip on when Meta exposes it):**
- **Inbound webhook** — parse the sender's username (and honor a hidden number) in `src/app/api/webhooks/whatsapp/route.ts`; route through the handle-first resolution above.
- **Click-to-chat by handle / WABA-owned handle** — entry links that address the business `@handle` directly.
- **Username-key automation** — manage the first-message spam filter; issue campaign-specific keys; auto-triage first-time messagers through an AI qualification flow before a human sees them.

**Brand-protection add-on (sellable, mostly independent):**
- Handle reservation guidance + impersonation/lookalike monitoring & alerts (`@yourbrand-official` copycats).

---

## 6. Selling points

- **"One branded `@handle` everywhere — and you know exactly which ad, QR, or post started every conversation."** (Track A, now.)
- **"We sync and dedupe your leads to the CRM even when the customer hides their number — competitors' phone-bound CRMs drop these leads. We don't."** (Track B, the moat.)
- **"Claim and defend your brand handle before someone else does."** (Protection add-on.)
- **"Only real, intended leads reach your inbox — AI screens first-time messagers, spam never lands."** (Username-key gate.)

---

## 7. Build sequence

1. **Now:** migration + `handle`/merge helpers + CRM `waHandleField` wiring (reuses `findLeadIdByHandle`). Ships the identity moat groundwork with zero API dependency, invisible until used.
2. **Now:** Handle Hub (tracked links + QR + attribution) + handle reservation/monitoring → the **near-term sellable** Track A feature.
3. **When Meta's Cloud API exposes username inbound / hidden numbers:** flip on the webhook branch + click-to-chat-by-handle + username-key automation. The data model, CRM path, and UI are already in place — it's a switch, not a project.

---

## 8. Open questions / risks

- **API reality (blocking Track B):** does business inbound ever hide the number, and does the webhook carry the username? Confirm before promising number-hiding to clients.
- **Handle changes:** users can change their `@handle`; treat handle as mutable, keep number/email as the durable keys once known; the merge rule handles re-linking.
- **Merge conflicts:** define precedence when a handle thread and a numbered thread both have history (keep numbered as canonical; append handle-thread messages).
- **Spam:** number-less inbound is easier to abuse — lean on the username-key gate + AI qualification before human handoff.
