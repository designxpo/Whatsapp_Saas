# Alabs Connect

A standalone WhatsApp broadcasting + automation system, extracted from the AnalytixLabs masterclass app. Same engine (campaigns, queue, daily cap, opt-outs, delivered/read tracking, templates, event auto-sends) — but **its own number/WABA, its own database, and a contacts model fed by CSV import + API** (no registration/OTP flow).

## Capabilities
- **Broadcast** to all contacts, a tag/segment, or a pasted list — via the admin UI or `POST /api/broadcast`.
- **Approved-template** sending with `{name}` substitution + header-image upload.
- **Reliability layer**: background queue + cron drain, daily send cap, opt-out suppression, per-recipient log, **delivered/read webhook**.
- **Event auto-sends**: fire a templated message when a contact is added or on a named API event, after a delay.

## Architecture
- Next.js (App Router) + Supabase (own project) + Meta WhatsApp Cloud API.
- `src/lib/` — `whatsapp` (send engine), `store` (data access), `campaign` (queue/drain/cap), `broadcast` (modes), `autosend` (triggers), `auth`/`apiauth`.
- Admin UI at `/admin` (password login). Server-to-server APIs are Bearer-key authed.

## Setup

### 1. New Supabase project
Create a project, then run `supabase/migrations/0001_init.sql` in the SQL editor. Copy the project URL + service-role key into env.

### 2. Meta (same app, different number)
- In the **same** Meta app you already use, add/connect the **new phone number** (its own WABA).
- Generate a **System User token** with `whatsapp_business_messaging` + `whatsapp_business_management`.
- Subscribe the app's webhook to the new WABA's `messages` field → callback `https://<your-domain>/api/webhooks/whatsapp`, verify token = `META_WA_WEBHOOK_VERIFY_TOKEN`.
- The webhook signature is verified with the **App Secret** (`META_WA_WEBHOOK_SECRET`) — same app, so reuse it.

### 3. Env
Copy `.env.example` → `.env.local` and fill every value (Meta number/WABA/token, Supabase, admin creds, `BROADCAST_API_KEY`, `CRON_SECRET`).

### 4. Run / deploy
```bash
npm install
npm run dev          # http://localhost:3000  → /admin
```
Deploy to Vercel. Set all env vars there too.

### 5. Cron (required for queue + scheduled + auto-sends)
Point a scheduler (Vercel Cron, cron-job.org, GitHub Actions) at:
```
POST https://<domain>/api/cron/process-queue
Authorization: Bearer <CRON_SECRET>
```
Every 5–15 minutes. Without it, queued/scheduled/auto-send messages won't drain.

## APIs (server-to-server — `Authorization: Bearer <BROADCAST_API_KEY>`)

**Broadcast**
```bash
curl -X POST https://<domain>/api/broadcast -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "mode":"audience","audience":{"mode":"tag","tag":"webinar-june"},
  "templateName":"webinar_reminder","languageCode":"en","variables":["{name}","tomorrow 7 PM"]
}'
```
Modes: `audience` (`{mode:"all"|"tag", tag?}`), `recipients` (`[{phone,name}]`), `campaign` (`{campaignId}`). `scheduledFor` (ISO) works for `audience`.

**Add contacts** (fires the `contact_added` automation for new ones)
```bash
curl -X POST https://<domain>/api/contacts -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "contacts":[{"phone":"919876543210","name":"Asha","tags":["webinar-june"]}]
}'
```

**Fire a named event** (triggers an `api_event` automation whose key matches)
```bash
curl -X POST https://<domain>/api/events -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{
  "event":"cart_abandoned","phone":"919876543210","name":"Asha"
}'
```

## Notes
- WhatsApp only allows **approved templates** for business-initiated messages; names must match Meta exactly.
- Daily cap (`WA_DAILY_LIMIT`, default 900) keeps you under your messaging tier; overflow stays queued and resumes next day.
- Opt-outs are suppressed on every send and also flip the contact to `optedout`.
