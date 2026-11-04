# Social campaign post selection

Social Growth campaigns use a visual post picker for the selected Instagram account or Facebook Page. Refresh loads the newest published posts, and Load more uses cursor pagination to browse older posts. Search filters the loaded captions. Select up to 200 posts per campaign; selected posts remain selected during refresh, pagination and loading errors. Switching accounts clears the selection.

When posts and a keyword are configured, both must match. With no selected posts, a distinctive keyword matches enquiries across the selected account. Targeting remains locked after participants enter. Existing single-post campaigns retain their target.

## Deployment

Apply `supabase/migrations/20261104192813_social_campaign_multi_posts.sql` before enabling multi-post saving. It backfills existing targets and synchronizes the legacy `post_id` and new `post_ids` fields for rolling deployments. Existing RLS and grants remain unchanged. Before the migration is applied, the application can still save single-post and keyword campaigns; it rejects multiple-post saves with a setup error instead of losing selections.

The new read-only `/api/admin/social-posts` endpoint requires an admin and Growth entitlement. It loads only the explicitly selected tenant-scoped account, keeps access tokens on the server, and returns normalized post metadata. It uses existing account credentials; missing post-reading permissions require correcting the account connection. It does not follow provider-supplied pagination URLs.

## Verification

- Service and API tests cover tenant scoping, authentication, entitlement, pagination, Instagram/Facebook responses, missing credentials and provider errors.
- Campaign tests cover multiple-post matching, legacy compatibility, keyword restrictions, targeting locks, validation and missing-column fallback.
- Isolated PostgreSQL-compatible migration checks cover backfill, both directions of legacy synchronization, clearing, constraints and unchanged RLS.
- Browser checks at desktop and mobile widths cover multiple selection, refresh, pagination deduplication, search, error recovery, account changes and stale responses using mocked provider data.

Hosted migration application and a live Meta account check require the deployment environment; these were not performed locally.
