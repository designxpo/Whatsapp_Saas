// Readiness audit: real Google client, review store, polling and reply routes.
// Google HTTP, AI and the database are isolated; nothing is publicly posted.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { memdb } from './helpers/memdb';
const h = vi.hoisted(() => ({ db: null as unknown as import('./helpers/memdb').MemDb, tenant: 'tenant-a', admin: true, allowed: true, failReviews: false, failPost: false, aiBusy: 0, canSend: true, aiRead: { concerns: [], confident: true } as { concerns: string[]; confident: boolean } | null, pages: null as Record<string, { reviews: Record<string, unknown>[]; next?: string }> | null, tokenError: null as string | null, flaky: 0, team: null as string | null, emails: [] as { to: string; subject: string; text: string }[], google: [] as Record<string, unknown>[], calls: [] as {
        url: string;
        method: string;
        body: string;
        auth: string;
    }[] }));
vi.mock('../supabase', () => ({ db: () => h.db.client }));
vi.mock('../auth', () => ({ DEFAULT_TENANT_ID: 'owner', currentTenantId: async () => h.tenant, requireRoleAdmin: async () => h.admin, requireAdmin: async () => true, currentUser: async () => ({ email: 'a@b.in', name: 'A', role: h.admin ? 'admin' : 'member', team: h.team ?? undefined, tenantId: h.tenant }) }));
vi.mock('../email', () => ({ sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => { h.emails.push({ to: o.to, subject: o.subject, text: o.text }); return { ok: true }; }) }));
vi.mock('../team', () => ({ listUsers: async () => [{ email: 'owner@biz.in', role: 'admin', active: true }, { email: 'agent@biz.in', role: 'member', active: true }], logActivity: () => undefined }));
vi.mock('../brand-lookup', async () => ({ brandForTenant: async () => (await import('../whitelabel')).TALKO_BRAND }));
vi.mock('../llm', () => {
    const draft = async (_input: unknown, tenant: string) => { if (h.aiBusy > 0) { h.aiBusy--; throw new Error('AI_BUSY'); } return { reply: `Thank you — ${tenant}`, ai: h.aiRead }; };
    return { draftReviewReply: vi.fn(draft), generateReviewReply: vi.fn(async (i: unknown, t: string) => (await draft(i, t)).reply) };
});
vi.mock('../feature-guard', () => ({ guardFeature: async () => (h.allowed ? null : Response.json({ error: 'not in plan' }, { status: 402 })), accountCanSend: async () => h.canSend }));
vi.mock('../moderation', () => ({ moderateText: async () => ({ allowed: true }), assertTextAllowed: async () => undefined }));
vi.mock('../entitlements', () => ({ checkFeature: async () => ({ ok: h.allowed }) }));
import { listReviews as listGoogleReviews, locationReviewUrl, retryDelays } from '../googlereviews';
import { drainGoogleReviews } from '../reviewpoller';
import { getReviewSettings, setReviewSettings, getGoogleSyncStatus } from '../reviews';
import { POST as pickYoutube } from '../../app/api/admin/yt-channels/route';
import { POST as syncNow } from '../../app/api/admin/reviews/sync/route';
import { GET as inbox, POST as addReview } from '../../app/api/admin/reviews/route';
import { POST as preview } from '../../app/api/admin/reviews/policy-preview/route';
import { GET as bellAlerts } from '../../app/api/admin/reviews/alerts/route';
import { raiseAlert, drainAlertEmails, sweepOverdueReviews } from '../review-alerts';
import { POST as reply } from '../../app/api/admin/reviews/reply/route';
import { POST as pickLocation } from '../../app/api/admin/reviews/google-locations/route';
import { GET as start } from '../../app/api/admin/onboarding/google-reviews/start/route';
const request = (body: unknown) => new Request('https://app.thetalko.in/api/admin/reviews/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const channel = (tenant = 'tenant-a', id = 'a', account = 'accounts/a', location = 'locations/a') => ({ id, tenant_id: tenant, kind: 'google_reviews', name: `Business ${id}`, active: true, access_token: `refresh-${id}`, google_account_id: account, google_location_id: location });
const review = (id: string, stars = 'FIVE', extra: Record<string, unknown> = {}) => ({ name: `accounts/a/locations/a/reviews/${id}`, reviewId: id, reviewer: { displayName: 'Customer' }, starRating: stars, comment: 'Good service', createTime: new Date().toISOString(), ...extra });
beforeEach(() => {
    h.db = memdb({ wa_reviews: [['tenant_id', 'source', 'external_id']] });
    h.tenant = 'tenant-a';
    h.admin = true;
    h.allowed = true;
    h.failReviews = false;
    h.failPost = false;
    h.aiBusy = 0;
    h.canSend = true;
    h.aiRead = { concerns: [], confident: true };
    h.pages = null;
    h.tokenError = null;
    h.flaky = 0;
    h.team = null;
    h.emails = [];
    process.env.RESEND_API_KEY = 're_test';
    retryDelays.ms = [0, 0];
    h.google = [];
    h.calls = [];
    h.db.tables.wa_channels = [channel()];
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = String(input), method = init.method ?? 'GET', body = String(init.body ?? ''), auth = new Headers(init.headers).get('Authorization') ?? '';
        h.calls.push({ url, method, body, auth });
        if (url === 'https://oauth2.googleapis.com/token') {
            if (h.tokenError) return Response.json({ error: h.tokenError }, { status: 400 });
            const token = new URLSearchParams(body).get('refresh_token');
            return Response.json({ access_token: `access-${token}`, expires_in: 0 });
        }
        if (method === 'GET' && url.includes('/reviews?') && h.flaky > 0) { h.flaky--; return Response.json({ error: { message: 'Backend error' } }, { status: 503 }); }
        if (method === 'GET' && url.includes('/reviews?') && h.pages && !h.failReviews) {
            const page = h.pages[new URL(url).searchParams.get('pageToken') ?? ''] ?? { reviews: [] };
            return Response.json({ reviews: page.reviews, ...(page.next ? { nextPageToken: page.next } : {}), averageRating: 4.6, totalReviewCount: 120 });
        }
        if (method === 'GET' && url.includes('/reviews?'))
            return h.failReviews ? Response.json({ error: { message: 'Permission denied', status: 'PERMISSION_DENIED' } }, { status: 403 }) : Response.json({ reviews: h.google, totalReviewCount: h.google.length });
        if (method === 'GET' && url.includes('mybusinessbusinessinformation.googleapis.com/v1/locations/a?readMask=metadata'))
            return Response.json({ metadata: { newReviewUri: 'https://search.google.com/local/writereview?placeid=PLACE' } });
        if (method === 'PUT' && url.endsWith('/reply'))
            return h.failPost ? Response.json({ error: { message: 'Google unavailable' } }, { status: 503 }) : Response.json({ comment: JSON.parse(body).comment });
        if (method === 'DELETE' && url.endsWith('/reply'))
            return new Response(null, { status: 204 });
        throw new Error(`Unexpected Google request ${method} ${url}`);
    });
});
afterEach(() => vi.unstubAllGlobals());
describe('Google Reviews tenant readiness', () => {
    it('imports a high-star review, generates a reply and posts to its exact Google resource', async () => {
        h.google = [review('one')];
        expect(await drainGoogleReviews()).toBe(1);
        const saved = h.db.tables.wa_reviews[0];
        expect(saved).toMatchObject({ tenant_id: 'tenant-a', source: 'google', rating: 5, reply_status: 'posted', reply_text: 'Thank you — tenant-a' });
        expect(h.calls.find(c => c.method === 'PUT')).toMatchObject({ url: 'https://mybusiness.googleapis.com/v4/accounts/a/locations/a/reviews/one/reply', auth: 'Bearer access-refresh-a' });
    });
    it('holds 1–3 stars as drafts, then posts an edited owner-approved reply', async () => {
        h.google = [review('low', 'TWO')];
        await drainGoogleReviews();
        const saved = h.db.tables.wa_reviews[0];
        expect(saved.reply_status).toBe('draft');
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
        const response = await reply(request({ id: saved.id, action: 'post', text: 'We would like to help.' }));
        expect(response.status).toBe(200);
        expect(h.calls.find(c => c.method === 'PUT')?.body).toBe(JSON.stringify({ comment: 'We would like to help.' }));
    });
    it('imports existing Google replies without posting over them', async () => {
        h.google = [review('answered', 'FIVE', { reviewReply: { comment: 'Already answered' } })];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ reply_status: 'posted', reply_text: 'Already answered' });
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('does not import or post the same review twice', async () => {
        h.google = [review('once')];
        await drainGoogleReviews();
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews).toHaveLength(1);
        expect(h.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    });
    it('keeps a failed public reply as a draft', async () => {
        h.google = [review('retry')];
        h.failPost = true;
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0].reply_status).toBe('draft');
    });
    it('isolates replies from another tenant', async () => {
        h.google = [review('private', 'TWO')];
        await drainGoogleReviews();
        h.tenant = 'tenant-b';
        expect((await reply(request({ id: h.db.tables.wa_reviews[0].id, action: 'post', text: 'x' }))).status).toBe(404);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('rejects non-admin reply writes', async () => {
        h.admin = false;
        expect((await reply(request({ id: 'x', action: 'post', text: 'x' }))).status).toBe(403);
    });
    it('does not poll a disconnected channel', async () => {
        h.db.tables.wa_channels[0].active = false;
        h.google = [review('off')];
        expect(await drainGoogleReviews()).toBe(0);
        expect(h.calls).toHaveLength(0);
    });
    it('blocks the Google connection for a plan without reviews', async () => {
        h.allowed = false;
        const response = await start(new Request('https://app.thetalko.in/api/admin/onboarding/google-reviews/start'));
        expect(response.headers.get('location')).toContain('gr_error=not_in_plan');
    });
    it('persists Never auto-post and never auto-posts a five-star review', async () => {
        await setReviewSettings('tenant-a', { autoMinStars: 6 });
        expect((await getReviewSettings('tenant-a')).autoMinStars).toBe(6);
        h.google = [review('manual-only')];
        await drainGoogleReviews();
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('surfaces Google read failures instead of reporting an empty review list', async () => {
        h.failReviews = true;
        await expect(listGoogleReviews({ channelId: 'audit-read', refreshToken: 'refresh-a', accountId: 'accounts/a', locationId: 'locations/a' })).rejects.toThrow();
    });
    it('uses the matching business connection when a tenant has two connected profiles', async () => {
        h.db.tables.wa_channels.push(channel('tenant-a', 'b', 'accounts/b', 'locations/b'));
        h.db.tables.wa_reviews = [{ id: 'review-b', tenant_id: 'tenant-a', source: 'google', external_id: 'accounts/b/locations/b/reviews/b', rating: 2 }];
        expect((await reply(request({ id: 'review-b', action: 'post', text: 'Thank you' }))).status).toBe(200);
        expect(h.calls.find(c => c.method === 'PUT')?.auth).toBe('Bearer access-refresh-b');
    });
    it('keeps OAuth refresh tokens out of the location-selection response', async () => {
        const response = await pickLocation(request({ channelId: 'a', accountId: 'accounts/a', locationId: 'locations/a', locationName: 'Business A' }));
        expect(response.status).toBe(200);
        expect(JSON.stringify(await response.json())).not.toContain('refresh-a');
    });
    it('records a failed Google read for the Reviews tab, and clears it once reads work again', async () => {
        h.failReviews = true;
        await drainGoogleReviews();
        let sync = (await getGoogleSyncStatus('tenant-a')).a;
        expect(sync).toMatchObject({ ok: false });
        expect(sync.error).toMatch(/owner or manager/);
        h.failReviews = false;
        await drainGoogleReviews();
        sync = (await getGoogleSyncStatus('tenant-a')).a;
        expect(sync).toMatchObject({ ok: true, error: null });
    });
    it('refuses to reply when the profile that owns the review is not connected', async () => {
        h.db.tables.wa_reviews = [{ id: 'review-c', tenant_id: 'tenant-a', source: 'google', external_id: 'accounts/c/locations/c/reviews/c', rating: 2 }];
        expect((await reply(request({ id: 'review-c', action: 'post', text: 'Thank you' }))).status).toBe(400);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('reconnecting the same location replaces the old connection', async () => {
        h.db.tables.wa_channels.push({ ...channel('tenant-a', 'new', null as unknown as string, null as unknown as string), active: false });
        expect((await pickLocation(request({ channelId: 'new', accountId: 'accounts/a', locationId: 'locations/a', locationName: 'Business A' }))).status).toBe(200);
        expect(h.db.tables.wa_channels.map(c => c.id)).toEqual(['new']);
    });
    it('keeps the never-auto-post choice on manual drafts too', async () => {
        await setReviewSettings('tenant-a', { autoMinStars: 6 });
        h.db.tables.wa_reviews = [{ id: 'r5', tenant_id: 'tenant-a', source: 'manual', rating: 5, text: 'Great' }];
        const response = await reply(request({ id: 'r5', action: 'save', text: 'Thanks!' }));
        expect((await response.json()).review.auto).toBe(false);
    });
    it('retries the AI reply on the next run when the AI was busy at import', async () => {
        h.google = [review('busy')];
        h.aiBusy = 1;
        expect(await drainGoogleReviews()).toBe(1);
        expect(h.db.tables.wa_reviews[0].reply_status ?? 'none').toBe('none');   // memdb has no column defaults
        expect(await drainGoogleReviews()).toBe(0);   // not imported twice…
        expect(h.db.tables.wa_reviews).toHaveLength(1);
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ reply_status: 'posted', reply_text: 'Thank you — tenant-a' });   // …but replied
        expect(h.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    });
    it('stops retrying a reply after a day', async () => {
        h.google = [review('old')];
        h.aiBusy = 1;
        await drainGoogleReviews();
        h.db.tables.wa_reviews[0].created_at = new Date(Date.now() - 25 * 3_600_000).toISOString();
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0].reply_status ?? 'none').toBe('none');
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('imports an old review without the AI posting a public reply to it', async () => {
        h.google = [review('ancient', 'FIVE', { createTime: '2023-01-01T00:00:00Z' })];
        expect(await drainGoogleReviews()).toBe(1);
        expect(h.db.tables.wa_reviews[0].reply_status ?? 'none').toBe('none');
        await drainGoogleReviews();
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('keeps reviews and replies in step with Google', async () => {
        h.google = [review('edit', 'TWO')];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0].reply_status).toBe('draft');
        // The customer edits their review, and someone replies on Google directly.
        h.google = [review('edit', 'FOUR', { comment: 'Sorted out now, thanks', reviewReply: { comment: 'Glad we could help' } })];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ rating: 4, text: 'Sorted out now, thanks', reply_status: 'posted', reply_text: 'Glad we could help' });
        // The reply is then removed on Google: kept here as a draft to post again.
        h.db.tables.wa_reviews[0].posted_at = new Date(Date.now() - 3_600_000).toISOString();
        h.google = [review('edit', 'FOUR', { comment: 'Sorted out now, thanks' })];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ reply_status: 'draft', reply_text: 'Glad we could help' });
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('edits a posted reply on Google', async () => {
        h.google = [review('fix')];
        await drainGoogleReviews();
        const id = h.db.tables.wa_reviews[0].id;
        const response = await reply(request({ id, action: 'post', text: 'Thanks again — see you soon!' }));
        expect(response.status).toBe(200);
        const puts = h.calls.filter(c => c.method === 'PUT');
        expect(puts).toHaveLength(2);
        expect(puts[1]).toMatchObject({ url: 'https://mybusiness.googleapis.com/v4/accounts/a/locations/a/reviews/fix/reply', body: JSON.stringify({ comment: 'Thanks again — see you soon!' }) });
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ reply_status: 'posted', reply_text: 'Thanks again — see you soon!' });
    });
    it('syncs on demand for admins only, and reports a profile Google refused', async () => {
        h.google = [review('s1'), review('s2', 'FIVE', { createTime: '2022-05-01T00:00:00Z' })];
        const ok = await (await syncNow()).json();
        expect(ok).toMatchObject({ imported: 2, profiles: 1, errors: [] });
        h.failReviews = true;
        const bad = await (await syncNow()).json();
        expect(bad.errors[0]).toMatchObject({ profile: 'Business a' });
        h.admin = false;
        expect((await syncNow()).status).toBe(403);
    });
    it("reads the location's own write-a-review link from Google", async () => {
        expect(await locationReviewUrl({ channelId: 'a', refreshToken: 'refresh-a', accountId: 'accounts/a', locationId: 'locations/a' })).toEqual({ url: 'https://search.google.com/local/writereview?placeid=PLACE' });
    });
    it('keeps the YouTube refresh token out of the channel-picker response', async () => {
        h.db.tables.wa_channels.push({ id: 'yt', tenant_id: 'tenant-a', kind: 'youtube', name: 'YT', active: false, access_token: 'refresh-youtube-secret' });
        const response = await pickYoutube(request({ channelId: 'yt', ytChannelId: 'UC123', name: 'My channel' }));
        expect(response.status).toBe(200);
        expect(JSON.stringify(await response.json())).not.toContain('refresh-youtube-secret');
    });
});

// ── Stage 1: safer automation, reliable sync, alerts and the inbox ──────────
const get = (qs = '') => new Request(`https://app.thetalko.in/api/admin/reviews${qs}`);
const alertsOf = (kind?: string) => (h.db.tables.wa_review_alerts ?? []).filter(a => !kind || a.kind === kind);
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const seed = (id: string, extra: Record<string, unknown> = {}) => ({ id, tenant_id: 'tenant-a', source: 'google', external_id: `accounts/a/locations/a/reviews/${id}`, channel_id: 'a', author: 'Customer', rating: 5, text: 'Good service', review_created_at: day(1), created_at: day(1), reply_status: 'none', is_complaint: false, post_error: null, ...extra });
describe('Google Reviews stage 1', () => {
    it('holds a five-star review that complains about billing, says why, and raises one complaint alert', async () => {
        h.google = [review('bill', 'FIVE', { comment: 'Lovely food but I was charged twice' })];
        await drainGoogleReviews();
        const row = h.db.tables.wa_reviews[0];
        expect(row).toMatchObject({ reply_status: 'draft', is_complaint: true });
        expect((row.approval_reasons as string[]).join(' ')).toMatch(/Refunds, billing disputes or overcharging — mentions “charged twice”/);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
        await drainGoogleReviews();
        expect(alertsOf()).toHaveLength(1);
        expect(alertsOf('complaint')).toHaveLength(1);
    });
    it('holds a reply when the AI is unsure, or its answer could not be read', async () => {
        h.aiRead = { concerns: [], confident: false };
        h.google = [review('unsure')];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0].approval_reasons).toEqual(["The AI wasn't sure how to read this review."]);
        h.aiRead = null;
        h.google = [review('unread')];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews.find(r => String(r.external_id).endsWith('unread'))!.approval_reasons).toEqual(["Couldn't check this review automatically."]);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('holds a review Google gives no star rating', async () => {
        h.google = [review('nostars', 'STAR_RATING_UNSPECIFIED')];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ rating: 0, reply_status: 'draft' });
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
    });
    it('stops automation when the account or the plan no longer allows it', async () => {
        h.canSend = false;
        h.google = [review('paused')];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews[0].approval_reasons).toEqual(["AI replies are paused: your plan or account doesn't allow them right now."]);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
        h.canSend = true;
        h.allowed = false;
        h.google = [review('after-downgrade')];
        h.calls = [];
        await drainGoogleReviews();
        expect(h.db.tables.wa_reviews).toHaveLength(1);
        expect(h.calls.some(c => c.url.includes('/reviews?'))).toBe(false);
        const sync = h.db.tables.wa_settings.find(r => r.key === 'google_reviews_sync:a')!.value as { kind: string };
        expect(sync.kind).toBe('plan');
    });
    it('reads only what changed on later runs, and imports a long history over several runs', async () => {
        const old = (i: number) => review(`h${i}`, 'FOUR', { createTime: '2023-01-01T00:00:00Z', updateTime: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000).toISOString() });
        h.pages = {
            '': { reviews: [old(1), old(2)], next: 't2' }, t2: { reviews: [old(3), old(4)], next: 't3' },
            t3: { reviews: [old(5), old(6)], next: 't4' }, t4: { reviews: [old(7), old(8)], next: 't5' },
            t5: { reviews: [old(9), old(10)], next: 't6' }, t6: { reviews: [old(11)] },
        };
        const reads = () => h.calls.filter(c => c.url.includes('/reviews?')).length;
        expect(await drainGoogleReviews()).toBe(8);
        expect(reads()).toBe(4);
        h.calls = [];
        expect(await drainGoogleReviews()).toBe(3);
        expect(reads()).toBe(3);   // the top page (nothing new), then two pages of history
        h.calls = [];
        await drainGoogleReviews();
        expect(reads()).toBe(1);   // history done: only the top page
        expect(h.db.tables.wa_reviews).toHaveLength(11);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);   // old reviews: no automatic replies
    });
    it('retries a temporary Google error instead of reporting an empty list', async () => {
        h.flaky = 1;
        h.google = [review('later-ok')];
        expect(await drainGoogleReviews()).toBe(1);
    });
    it('shows lost access on the location and alerts once a day', async () => {
        h.tokenError = 'invalid_grant';
        await drainGoogleReviews();
        await drainGoogleReviews();
        expect(alertsOf('reauth')).toHaveLength(1);
        const body = await (await inbox(get())).json();
        expect(body.locations[0].sync).toMatchObject({ ok: false, kind: 'reauth' });
    });
    it('alerts when a location keeps failing to sync', async () => {
        h.flaky = 1000;
        for (let i = 0; i < 3; i++) await drainGoogleReviews();
        expect(alertsOf('sync_failing')).toHaveLength(1);
        expect(alertsOf('reauth')).toHaveLength(0);
    });
    it('keeps a failed post actionable in the Failed view, alerts, and clears once posted', async () => {
        h.failPost = true;
        h.google = [review('nope')];
        await drainGoogleReviews();
        const row = h.db.tables.wa_reviews[0];
        expect(row).toMatchObject({ reply_status: 'draft', post_error: expect.stringMatching(/temporary problem/) });
        expect(alertsOf('post_failed')).toHaveLength(1);
        expect((await (await inbox(get('?view=failed'))).json()).total).toBe(1);
        h.failPost = false;
        expect((await reply(request({ id: row.id, action: 'post', text: 'Thank you!' }))).status).toBe(200);
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ reply_status: 'posted', post_error: null, reply_source: 'talko' });
        expect((await (await inbox(get('?view=failed'))).json()).total).toBe(0);
    });
    it('never raises the same alert twice, and emails it once to the admins', async () => {
        const a = { kind: 'complaint' as const, dedupeKey: 'review:x:arrived', title: 'Complaint: Asha left a 1★ review', body: 'Cold food' };
        expect(await raiseAlert('tenant-a', a)).toBe(true);
        expect(await raiseAlert('tenant-a', a)).toBe(false);
        expect(alertsOf()).toHaveLength(1);
        await drainAlertEmails();
        await drainAlertEmails();
        expect(h.emails).toEqual([expect.objectContaining({ to: 'owner@biz.in', subject: 'Complaint: Asha left a 1★ review' })]);
        await setReviewSettings('tenant-a', { alerts: { email: true, recipients: ['Ops@Biz.in'], events: {}, unansweredHours: 24 } as never });
        await raiseAlert('tenant-a', { ...a, dedupeKey: 'review:y:arrived' });
        await drainAlertEmails();
        expect(h.emails.map(e => e.to)).toEqual(['owner@biz.in', 'ops@biz.in']);
    });
    it('respects alert kinds the owner switched off', async () => {
        await setReviewSettings('tenant-a', { alerts: { events: { new_review: false } } as never });
        expect(await raiseAlert('tenant-a', { kind: 'new_review', dedupeKey: 'k', title: 't' })).toBe(false);
        expect(await raiseAlert('tenant-a', { kind: 'complaint', dedupeKey: 'k2', title: 't' })).toBe(true);
    });
    it('raises one overdue alert for a review left unanswered past the limit', async () => {
        h.db.tables.wa_reviews = [seed('late', { review_created_at: day(3), reply_status: 'draft' }), seed('fresh', { review_created_at: new Date(Date.now() - 2 * 3_600_000).toISOString() })];
        expect(await sweepOverdueReviews()).toBe(1);
        expect(await sweepOverdueReviews()).toBe(0);
        expect(alertsOf('overdue')[0].review_id).toBe('late');
    });
    it('drops an alert from the bell once its review has a public reply', async () => {
        h.db.tables.wa_reviews = [seed('r1')];
        await raiseAlert('tenant-a', { kind: 'needs_approval', dedupeKey: 'review:r1:arrived', reviewId: 'r1', title: 'Waiting' });
        let bell = await (await bellAlerts()).json();
        expect(bell.alerts).toEqual([expect.objectContaining({ title: 'Waiting', href: '/admin?tab=reviews&review=r1' })]);
        h.db.tables.wa_reviews[0].reply_status = 'posted';
        bell = await (await bellAlerts()).json();
        expect(bell.alerts).toEqual([]);
    });
    it('inbox: views, counts, filters, search, paging and oldest-unanswered order', async () => {
        h.db.tables.wa_reviews = [
            seed('n1', { author: 'Asha', text: 'Paneer was cold', rating: 2, is_complaint: true, review_created_at: day(5) }),
            seed('n2', { reply_status: 'draft', review_created_at: day(4) }),
            seed('n3', { reply_status: 'posted', review_created_at: day(3) }),
            seed('n4', { reply_status: 'draft', post_error: 'Google unavailable', review_created_at: day(2) }),
            seed('m1', { source: 'manual', external_id: null, channel_id: null, author: 'Ravi', review_created_at: day(1) }),
            { ...seed('other'), tenant_id: 'tenant-b', text: 'Paneer elsewhere' },
        ];
        const all = await (await inbox(get())).json();
        expect(all.counts).toEqual({ all: 5, approval: 2, unanswered: 4, complaints: 1, replied: 1, failed: 1 });
        expect(all.reviews.map((r: { id: string }) => r.id)).toEqual(['m1', 'n4', 'n3', 'n2', 'n1']);
        expect((await (await inbox(get('?q=paneer'))).json()).reviews.map((r: { id: string }) => r.id)).toEqual(['n1']);
        expect((await (await inbox(get('?q=ravi'))).json()).total).toBe(1);
        expect((await (await inbox(get('?location=manual'))).json()).total).toBe(1);
        expect((await (await inbox(get('?rating=2'))).json()).total).toBe(1);
        expect((await (await inbox(get('?view=complaints'))).json()).reviews[0].id).toBe('n1');
        const p2 = await (await inbox(get('?pageSize=5&page=1&sort=oldest_unanswered'))).json();
        expect(p2.reviews.map((r: { id: string }) => r.id)).toEqual(['n1', 'n2', 'n4', 'm1']);
        expect((await (await inbox(get(`?from=${day(4).slice(0, 10)}&to=${day(3).slice(0, 10)}`))).json()).total).toBe(2);
    });
    it("never shows another workspace's reviews, even when asked for one by id", async () => {
        h.db.tables.wa_reviews = [{ ...seed('theirs'), tenant_id: 'tenant-b' }];
        const body = await (await inbox(get('?id=theirs'))).json();
        expect(body.focus).toBeNull();
        expect(body.total).toBe(0);
    });
    it('a team member sees only the locations of their team', async () => {
        h.db.tables.wa_channels = [{ ...channel(), team: 'sales' }, { ...channel('tenant-a', 'b', 'accounts/b', 'locations/b'), team: 'ops' }];
        h.db.tables.wa_reviews = [seed('ra'), seed('rb', { channel_id: 'b', external_id: 'accounts/b/locations/b/reviews/rb' }), seed('rm', { source: 'manual', channel_id: null, external_id: null })];
        h.admin = false;
        h.team = 'sales';
        const body = await (await inbox(get())).json();
        expect(body.reviews.map((r: { id: string }) => r.id)).toEqual(['ra']);
        expect(body.locations.map((l: { id: string }) => l.id)).toEqual(['a']);
        expect((await (await inbox(get('?location=b'))).json()).reviews.map((r: { id: string }) => r.id)).toEqual(['ra']);
        await setReviewSettings('tenant-a', { alerts: { recipients: ['owner@biz.in'] } as never });
        expect(JSON.stringify((await (await inbox(get())).json()).settings)).not.toContain('owner@biz.in');
    });
    it('the inbox response carries no Google tokens or page bookmarks', async () => {
        h.db.tables.wa_settings = [{ tenant_id: 'tenant-a', key: 'google_reviews_sync:a', value: { ok: true, at: day(0), highWater: day(1), backfillToken: 'SECRET_PAGE_BOOKMARK' } }];
        const text = JSON.stringify(await (await inbox(get())).json());
        expect(text).not.toContain('refresh-a');
        expect(text).not.toContain('SECRET_PAGE_BOOKMARK');
        expect(text).toContain('"importingHistory":true');
    });
    it('blocks the inbox for a plan without Google Reviews', async () => {
        h.allowed = false;
        expect((await inbox(get())).status).toBe(402);
    });
    it("can't rewrite a Google review as a manual one", async () => {
        h.db.tables.wa_reviews = [seed('g1')];
        expect((await addReview(request({ id: 'g1', author: 'X', text: 'fake', rating: 5 }))).status).toBe(400);
        expect(h.db.tables.wa_reviews[0]).toMatchObject({ source: 'google', text: 'Good service' });
    });
    it('previews the rules on a sample review without posting anything', async () => {
        const held = await (await preview(request({ rating: 5, text: 'Great food but please refund the extra charges', withAi: true }))).json();
        expect(held).toMatchObject({ autoPost: false, complaint: true, reply: 'Thank you — tenant-a', aiChecked: true });
        const never = await (await preview(request({ rating: 5, text: 'Great', autoMinStars: 6 }))).json();
        expect(never.reasons[0]).toMatch(/Never auto-post/);
        const fine = await (await preview(request({ rating: 5, text: 'Great haircut' }))).json();
        expect(fine.autoPost).toBe(true);
        expect(h.calls.some(c => c.method === 'PUT')).toBe(false);
        expect(h.db.tables.wa_reviews ?? []).toHaveLength(0);
    });
    it('two overlapping runs import and post a review only once', async () => {
        h.google = [review('race')];
        await Promise.all([drainGoogleReviews(), drainGoogleReviews()]);
        expect(h.db.tables.wa_reviews).toHaveLength(1);
        expect(h.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
    });
});

