# AI answer path — security hardening (2026-11)

The same audit as Mindbird's (`wa-broadcaster/docs/ai-security-hardening.md`), applied to this repo. This SaaS already passed the business explicitly into every search, so its gaps were different. Below are what was found here, what changed, and what the tests show.

Passing the tests does **not** prove the AI path is secure. They pin the specific leaks found so they cannot return unnoticed. Hallucination and prompt injection are reduced and contained, not eliminated.

## 1. Gap assessment (this repo)

| # | Finding (verified) | Exploit | Sev | Fix |
|---|---|---|---|---|
| 1 | `tenantId = DEFAULT_TENANT_ID` default parameters on 30+ AI-path functions (`kb`, `aihub`, `router/cache`, `llm`); `routeMessage`, `auditReply`, `composeFollowup` fell back to the default business | Any caller that forgets the business silently reads the platform's own knowledge, personas and AI functions, on the platform's AI key | High | Defaults removed, so the **compiler** now requires a business everywhere. One production caller was found and fixed (`flowengine` city check). The router, audit and follow-ups refuse when no business is given |
| 2 | KB, concepts, export, AI functions, agents, prompts, isolation, gaps, provider key, test console, grounding: no role check and/or `(await currentTenantId()) ?? DEFAULT_TENANT_ID` | A member edits knowledge or adds a webhook function; a session with no workspace reads or replaces the **default business's AI key** | High | `src/lib/ai-gate.ts`: signed in, in a workspace, admin where needed. 401/403 before data access |
| 3 | Web-chat visitor id treated as a phone number when reading and writing contacts | Overwrite a real customer's email and CRM record within the business | High | Contact read/write only for WhatsApp identities |
| 4 | Cache poisoning: failed audit cached by default; tool/profile turns cached; no invalidation on KB change | Manipulated or personal answer replayed; corrected facts persist | High | `cacheable` + audit `grounded === true`; per-business invalidation on upload, delete, sync and publish |
| 5 | Grounding firewall: same bypasses as Mindbird; `PUBLIC_CONTACT_EMAIL`, when set, applied to every business | Phishing link or invented fee/email; another business steered to the platform's inbox | High | Same firewall changes; platform contact only for the default business |
| 6 | Untrusted KB text and profile unfenced, no data-not-instructions rule | Prompt injection via documents | High | `guard/fence.ts` + `prompts/runtime-policy.ts` |
| 7 | SSRF: DNS rebinding, missing reserved ranges, uncapped URL ingest | Internal network reachable from a webhook or KB URL | High | Connect-time pinned lookup, ranges, timeout, 5 MB cap, content type |
| 8 | Document search returned chunks of `processing`/`failed` documents and concept vectors | Half-ingested or retired text served | Medium | Migration `20261102120000_kb_ready_only_retrieval.sql` |
| 9 | Deferral promised team follow-up with nobody told | Silent wait | Medium | Escalation + `conversation.escalated` event, on every channel |
| 10 | Router console log carried full phone + question | PII in logs | Medium | Last-4 digits, no text (DB row kept: GDPR export needs it; `retention.ts` 180 days) |
| 11 | No CI gate for tests | Regressions ship | High | `.github/workflows/ci.yml` |
| 12 | Static FAQ not business-gated | (file is empty today) | Low | Default business only |

## 2. Changes

- **New:**
  - `src/lib/ai-gate.ts`;
  - `src/lib/guard/fence.ts`;
  - `src/lib/prompts/runtime-policy.ts`;
  - `supabase/migrations/20261102120000_kb_ready_only_retrieval.sql`;
  - `.github/workflows/ci.yml`.
- **Changed:**
  - `llm.ts`;
  - `kb.ts`;
  - `kbpublish.ts`;
  - `aihub.ts`;
  - `router/index.ts` and `router/cache.ts`;
  - `router/metrics.ts`;
  - `guard/grounding.ts`;
  - `guard/audit.ts`;
  - `ssrf.ts`;
  - `ai/chat.ts` (temperature);
  - `assistant.ts`;
  - `replybackstop.ts`;
  - `flowengine.ts`;
  - the Instagram, Messenger and widget reply points;
  - 14 AI and KB admin routes.
- **Temperature** (`GEMINI_CHAT_TEMPERATURE`, default 0.4) applies to **Gemini only**. Some OpenAI reasoning models reject the parameter, and a rejected call on a customer's own key would silence every reply. OpenAI and Anthropic keep their provider defaults.

## 3. Results (2026-11-02)

| Check | Result |
|---|---|
| `ai-security-evals.test.ts`: 13 leak cases (**0 disclosures**), over-blocking, abstention, fence escapes, prompt order, visitor-id identity, SSRF ranges | 55 pass |
| `ai-routes-authz.test.ts`: member and lead 403 on 21 handlers with zero data access; no workspace → 401 | 46 pass |
| `router-lookup.test.ts`: another business never reaches the FAQ; no business, no routing | pass |
| Full suite | **2,968 / 2,968 pass** |
| `tsc --noEmit` | exit 0 |
| `npm run build:check` | pass |

**Mutation check:** forcing the identity rule to true fails the eval suite.

**What the tests caught:** they found one real gap I had skipped (the routing toggle still fell back to the default business), which is now fixed. Scenario fixtures were moved off `203.0.113.x`, a documentation range the SSRF guard now correctly refuses.

**Not tested:**
- live models under injection;
- the migration against the real database;
- load and cost.

## 4. Operating, rollback, remaining risks

Monitoring, incident response and maintenance work as in the Mindbird document, with three differences here:
- the cache is purged per business with `delete from wa_semantic_cache where tenant_id = '<id>'`;
- the migration is a straight redefinition of four functions, rolled back by re-running the 0026, 0047 and 0063 definitions;
- the `isolation` AI setting still applies.

**Setup (yours):**
1. Apply the migration.
2. Purge `wa_semantic_cache` once after deploy.
3. Make CI a required check on `main`.

**Open risks:**
- A link or fee planted in a document uploaded by an admin is trusted.
- A fee with no currency word passes unless the strict mode is on.
- Policy and guarantee claims are checked only by the audit.
- No citations.
- Other admin routes outside the AI/KB area still use `?? DEFAULT_TENANT_ID`. They weren't part of this pass, and that pattern should be removed repo-wide.
- No webhook rate limits.
- The budget counts calls, not tokens.
