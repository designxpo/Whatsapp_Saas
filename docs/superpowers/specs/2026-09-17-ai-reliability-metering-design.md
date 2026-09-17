# AI reliability and usage metering

**Date:** 2026-09-17
**Repo:** alabs-connect-saas
**Status:** design approved, implementation plan pending

## Why

The owner console can already tell you which tenants have never configured an AI
key — `tenant_metrics.ai_configured` feeds a `no_ai_key` queue on the Today
board (`supabase/migrations/0106_owner_console.sql:189`).

It cannot tell you whether a configured key still works.

`ai_configured` is a boolean about the *presence* of a key, not its *function*.
A tenant whose Gemini key was revoked, expired, or hit its quota shows green on
the Today board while every reply fails and escalates to a human. They are
paying for a product whose AI half is silently off, and the first signal we get
is the cancellation.

Nothing anywhere records the outcome of an AI call. `ChatResult`
(`src/lib/ai/chat.ts:102`) carries `text`, `toolCalls` and `truncated`, and
discards the usage block every provider SDK returns. So there is also no record
of how much AI any tenant uses, on which models, or what the platform pays for
the embedding fallback.

This design adds one instrument that answers all three, with reliability as the
point and cost as a by-product.

## Scope

**In:**

- A `wa_ai_usage` table: one row per provider call, success or failure.
- Usage capture in `src/lib/ai/chat.ts` for all three providers.
- Payer attribution in `src/lib/kb.ts` for the embedding fallback.
- An `owner_ai_stats(days int)` SQL aggregate.
- An `ai_failing` queue on the owner Today board.
- A token-split and model-mix panel on owner Health.

**Out, deliberately:**

- No per-model price matrix. Token counts are stored; a single configurable rate
  turns them into money at read time, so a price change never rewrites history.
- No usage-based billing, quotas or enforcement. This is an instrument, not a
  meter that charges.
- No rollup/history table. Ninety days of raw rows answers every question above.
- No change to `enforce_entitlements` or any existing gating.

## Cost context

Chat is require-own-key: `resolveTenantAi` (`src/lib/ai/keys.ts`) throws
`AiKeyMissingError` when a tenant has no key, so tenants pay their own chat
bill. The platform's only AI cost is embeddings — `embedKeys`
(`src/lib/kb.ts:60-68`) tries the tenant's own Gemini key first and falls back
to the platform `GEMINI_API_KEY`, and tenants without their own key embed on
ours permanently.

That cost is expected to be small. It is recorded because it is free to record
once the instrument exists, not because it justifies the work on its own.

## Data model

```sql
create table if not exists wa_ai_usage (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('chat','embed')),
  payer       text not null check (payer in ('platform','tenant')),
  provider    text not null,
  model       text not null,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  estimated   boolean not null default false,
  ok          boolean not null default true,
  error_kind  text check (error_kind in ('key','busy','timeout','other'))
);
```

`tenant_id` is nullable so a platform-level call with no tenant context can still
be recorded rather than dropped.

`estimated` marks rows whose token counts were derived rather than reported.
Gemini's `embedContent` returns `billableCharacterCount`, not tokens; when even
that is absent the count is derived from input length. The column exists so a
derived number is never presented as a measurement.

Indexes:

```sql
create index if not exists wa_ai_usage_at_idx      on wa_ai_usage (at desc);
create index if not exists wa_ai_usage_tenant_idx  on wa_ai_usage (tenant_id, at desc);
create index if not exists wa_ai_usage_failed_idx  on wa_ai_usage (tenant_id, at desc) where not ok;
create index if not exists wa_ai_usage_platform_idx on wa_ai_usage (at desc) where payer = 'platform';
```

Retention: ninety days. The sweep is one delete statement added to the existing
`/api/cron/tenant-metrics` job, which already runs every 15 minutes via
`.github/workflows/cron-tenant-metrics.yml`. No new schedule.

## Capture points

### Chat — `src/lib/ai/chat.ts`

`ChatResult` gains an optional `usage: { tokensIn: number; tokensOut: number }`,
populated inside each provider function from that SDK's own reporting: Gemini's
`usageMetadata`, OpenAI's and Anthropic's `usage`.

`runChat` takes an optional metering context `{ tenantId, kind }` and records a
row on both paths. Chat rows are always `payer = 'tenant'` — chat is
require-own-key, so there is no path on which the platform pays for a chat call,
and the recorder should not offer one. The failure path maps error shapes that already
exist in this file:

| Error | `error_kind` |
|---|---|
| `AiKeyMissingError` | `key` |
| `AI_BUSY` (transient retries exhausted) | `busy` |
| `AI_TIMEOUT` (per-attempt cap) | `timeout` |
| anything else | `other` |

One row per `runChat` call, not per internal retry. `runResilient` may attempt up
to four times; a tenant that succeeds on attempt three is working, not failing,
and per-attempt rows would make the failure rate meaningless.

### Embeddings — `src/lib/kb.ts`

`embedKeys()` returns `string[]` today, and the retry loop in `embedTexts`
infers whose key paid from the array index (`i < keys.length - 1` means "the
tenant's own key just failed"). That inference is already fragile and is about
to carry billing meaning, so `embedKeys()` returns `{ key, payer }[]` instead —
explicit rather than positional.

Attribution rules:

- Tenant has their own Gemini key → `[{own, 'tenant'}, {platform, 'platform'}]`
- Tenant has none → `[{platform, 'platform'}]`
- Tenant's own key **is** the platform key (the existing `Set` dedupe collapses
  these) → single entry, `payer = 'platform'`, because it is our bill.

A row is recorded for the attempt that succeeded, and for each that failed.

This differs from the chat rule above — one row per call there, one row per
attempt here — and the difference is deliberate. A chat retry re-uses the same
key, so the attempts are one billing fact and several rows would distort the
failure rate. An embedding retry moves to a *different key with a different
payer*, so "the tenant's key failed and ours paid instead" is two distinct
facts, and collapsing them would hide exactly the attribution this table exists
to record.

## Hot-path safety

The recorder is fire-and-forget. It catches its own failures and logs them; it
never rejects into the caller. Metering must not be able to fail a customer's
reply.

A missing table (`42P01`, `PGRST205`, `PGRST106`) means the migration has not
been applied yet and is skipped silently — the same convention used elsewhere in
this codebase for not-yet-deployed tables, and consistent with the owner
console's existing "queues not migrated yet" empty state.

Writes are one insert per call. At current volume that is fine. If it ever is
not, the fix is batching inside the recorder, which changes no schema and no
call site.

## Owner surface

### `owner_ai_stats(days int)`

A SQL function returning one row per tenant: call count, failure count, failure
rate, tokens in/out, and top model by call count. Aggregation happens in SQL
because PostgREST caps every response at 1000 rows — a fetch-and-sum would
silently under-report on any busy fleet, which is the failure mode this whole
document exists to prevent.

### `ai_failing` queue — Today board

Added to `owner_queue_counts` in the same shape as the existing queues. A tenant
qualifies when, over the last 24 hours, its failure rate is at or above 50% on a
minimum of 5 calls, and its status is not `suspended` or `cancelled`.

The minimum call count exists so a tenant with one failed call at midnight does
not raise an alarm. The threshold is high because this queue means "their AI is
broken", not "their AI is imperfect".

This sits next to `no_ai_key`, and the pairing is the point: `no_ai_key` means
they never switched it on, `ai_failing` means they did and it stopped working.

### Health panel

Platform-versus-tenant token split, an estimated platform cost from the single
configurable rate, and model mix across the fleet. Read from
`owner_ai_stats`, with the same "as of" freshness stamp the other owner panels
already carry.

## Testing

- **Error classification.** Each error shape produces the right `error_kind`.
- **Payer resolution.** All three key arrangements, including the
  own-equals-platform dedupe, which is the case most likely to be got wrong.
- **Retry accounting.** A call that fails twice then succeeds records one row,
  `ok = true`.
- **Recorder isolation.** Given a database that rejects every insert, the
  caller's `ChatResult` is returned unchanged and nothing throws.
- **Table-missing tolerance.** A `42P01` is skipped silently; any other database
  error is logged, still without throwing.
- **Aggregate correctness.** Seeded rows produce the expected per-tenant rates.
- **Queue threshold.** 4 failures out of 4 does not qualify (below the call
  minimum); 5 out of 10 does.
- **Mutation check.** Deliberately invert the payer logic and confirm a test
  fails. Green tests that cannot detect a broken attribution are worse than no
  tests, because this one feeds a cost number.

## Migration

Next number in sequence after `0117_signin_security.sql`, i.e. `0118`. Contains
the table, its indexes, `owner_ai_stats`, and the `ai_failing` branch added to
`owner_queue_counts`.

Note that `0117_signin_security.sql` is recorded as not yet applied to
production. This migration is independent of it and does not depend on its
tables.
