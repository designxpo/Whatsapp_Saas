# YouTube Comment Automation — Build Spec (Module 1)

Adds YouTube as a **third comment-automation channel** alongside Instagram &
Facebook, reusing the existing comment engine. YouTube has no DMs, so this is
**public-reply + moderation only** (maps exactly to our "reply-only" mode).

## 1. What it does
- **AI replies** to comments on the channel's videos, grounded in the tenant's
  KB + persona (reuse `generateReply` + the comment pipeline in the IG/FB webhooks).
- **Rule-based replies** — keyword triggers, per-video or all-videos, rotating
  reply variants (reuse `parseKeywords` / `normalizePublicReplies` / `pickPublicReply`).
- **Auto-moderation** — hold-for-review or reject spam/abusive comments.
- **Anti-strike safety** — per-channel hourly rate cap + reply rotation (YouTube
  penalises repetitive automated replies like Meta does).
- Comments surface in **Live Chat** as a `youtube` channel (like IG/FB comments).

## 2. Architecture (mostly reuse)
| Layer | Plan |
|---|---|
| Channel kind | Add `"youtube"` to `ChannelKind` in `channels.ts`; store channel id + encrypted OAuth refresh token (reuse channel token encryption). |
| Rules | New `src/lib/ytcomments.ts` mirroring `fbcomments.ts` — import the shared helpers from `igcomments.ts` (`normalizeButtons` N/A; use `normalizePublicReplies`, `pickPublicReply`, `parseKeywords`, `matchesKeywords`). Reply-only always; no buttons, no follow-gate. Add a `moderate: 'off' | 'hold_spam' | 'reject_spam'` field. |
| Reply engine | Reuse `generateReply` (KB + persona) for AI replies; rules use rotated variants. |
| Ingestion | **Cron poll** (no comment webhook exists). Extend the existing cron: for each connected channel with automation on, `commentThreads.list?allThreadsRelatedToChannelId=…&order=time` since last poll cursor → new comments. |
| Send | `comments.insert` (reply to `parentId`); moderation via `comments.setModerationStatus`. |
| Idempotency + rate | Reuse the `claimComment` pattern (new `wa_yt_comment_log`) + a per-channel hourly cap (reuse the `withinRate` limiter pattern). |
| Portal | New **YouTube** tab mirroring `InstagramTab` (connect channel, video picker, rule editor, reply-only + rotating replies + multi-keyword). |

## 3. Data model (migration 0092)
```sql
-- youtube channels reuse wa_channels (kind='youtube'); add nothing there beyond
-- what exists (token encrypted, page_id unused, store channel_id in ig_user_id? →
-- prefer a dedicated yt_channel_id column):
alter table wa_channels add column if not exists yt_channel_id text;

create table if not exists wa_yt_comment_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001',
  channel_id uuid,                    -- wa_channels.id (the youtube channel)
  name text not null default '',
  enabled boolean not null default true,
  video_id text,                      -- null = all videos
  video_title text, video_thumbnail text,
  keyword text,                       -- comma-separated trigger words
  public_replies jsonb not null default '[]'::jsonb,
  moderate text not null default 'off',  -- off | hold_spam | reject_spam
  match_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_wa_yt_rules_tenant on wa_yt_comment_rules (tenant_id, created_at desc);
alter table wa_yt_comment_rules enable row level security;

create table if not exists wa_yt_comment_log (        -- idempotency
  comment_id text primary key, rule_id uuid, tenant_id uuid not null,
  created_at timestamptz not null default now()
);
create table if not exists wa_yt_poll_cursor (        -- per-channel last poll
  channel_id uuid primary key, tenant_id uuid not null,
  last_polled_at timestamptz, updated_at timestamptz not null default now()
);
```

## 4. API + routes
- `src/lib/youtube.ts` — `listVideos`, `listNewComments(channelId, since)`,
  `replyToComment(parentId, text)`, `setModeration(commentId, status)`, token refresh.
- `POST /api/admin/onboarding/youtube` — OAuth code → tokens → save channel.
- `GET/POST/DELETE /api/admin/yt-comment-rules` — rule CRUD (mirror ig route).
- `GET /api/admin/yt-videos` — the video picker.
- Cron: extend `/api/cron/process-queue` → `drainYtComments()` (poll + reply + moderate).

## 5. External prerequisites (YOUR setup — the long pole)
Same Google Cloud project as Google Reviews. Add:
1. **Enable the YouTube Data API v3** in that project.
2. **OAuth scope** `https://www.googleapis.com/auth/youtube.force-ssl` on the
   consent screen (needed to insert/moderate comments). This is a **sensitive**
   scope → app must pass **OAuth verification** for public use (Testing mode,
   ≤100 users, works for a pilot).
3. **Quota.** Default **10,000 units/day per project, shared across all tenants**.
   Costs: `commentThreads.list` = 1 unit, `comments.insert` = **50**,
   `setModerationStatus` = **50**. → ~200 replies/day total at default quota.
   For multi-tenant scale, submit the **YouTube API Services quota-increase audit**.
   Start this early — it's the slowest step.
4. Same OAuth **Client ID + secret** as the reviews connect flow (one Google app
   can hold both Business-Profile and YouTube scopes).

## 6. Hard constraints to design around
- **No new-comment webhook.** Only *uploads* are pushable (WebSub); comments are
  poll-only → quota-aware polling (only channels with automation on, only recent
  videos, incremental cursor).
- **Quota is the ceiling**, not rate limits. Batch and cache; never re-list all
  threads every tick.
- **Anti-strike**: rotate replies, cap per hour, never identical text (reuse).

## 7. Phasing
1. **1a** (no OAuth needed): channel kind + `ytcomments.ts` + rule CRUD + portal
   tab UI + reply/moderation logic + poller — all wired but dormant.
2. **1b** (after OAuth client exists): connect flow + live poll + live reply/moderate.
3. **1c**: comment sentiment + surface in Live Chat inbox.

Phase 1a is safe to build now; 1b/1c light up the moment the OAuth client + YouTube
Data API + quota are approved.
