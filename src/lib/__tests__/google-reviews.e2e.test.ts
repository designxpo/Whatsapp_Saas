// Readiness audit: real Google client, review store, polling and reply routes.
// Google HTTP, AI and the database are isolated; nothing is publicly posted.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { memdb } from './helpers/memdb';
const h = vi.hoisted(() => ({ db: null as unknown as import('./helpers/memdb').MemDb, tenant: 'tenant-a', admin: true, allowed: true, failReviews: false, failPost: false, aiBusy: 0, google: [] as Record<string, unknown>[], calls: [] as {
        url: string;
        method: string;
        body: string;
        auth: string;
    }[] }));
vi.mock('../supabase', () => ({ db: () => h.db.client }));
vi.mock('../auth', () => ({ DEFAULT_TENANT_ID: 'owner', currentTenantId: async () => h.tenant, requireRoleAdmin: async () => h.admin }));
vi.mock('../llm', () => ({ generateReviewReply: vi.fn(async (_input: unknown, tenant: string) => { if (h.aiBusy > 0) { h.aiBusy--; throw new Error('AI_BUSY'); } return `Thank you — ${tenant}`; }) }));
vi.mock('../moderation', () => ({ moderateText: async () => ({ allowed: true }), assertTextAllowed: async () => undefined }));
vi.mock('../entitlements', () => ({ checkFeature: async () => ({ ok: h.allowed }) }));
import { listReviews as listGoogleReviews, locationReviewUrl } from '../googlereviews';
import { drainGoogleReviews } from '../reviewpoller';
import { getReviewSettings, setReviewSettings, getGoogleSyncStatus } from '../reviews';
import { POST as pickYoutube } from '../../app/api/admin/yt-channels/route';
import { POST as syncNow } from '../../app/api/admin/reviews/sync/route';
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
    h.google = [];
    h.calls = [];
    h.db.tables.wa_channels = [channel()];
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
    vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
        const url = String(input), method = init.method ?? 'GET', body = String(init.body ?? ''), auth = new Headers(init.headers).get('Authorization') ?? '';
        h.calls.push({ url, method, body, auth });
        if (url === 'https://oauth2.googleapis.com/token') {
            const token = new URLSearchParams(body).get('refresh_token');
            return Response.json({ access_token: `access-${token}`, expires_in: 0 });
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
