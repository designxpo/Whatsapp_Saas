# Google Sheets and Google Calendar

Connected by **sharing**, not by "Sign in with Google". The portal has one Google service account (`GOOGLE_SERVICE_ACCOUNT_JSON`). A business shares one sheet (as Editor) or one calendar ("Make changes to events") with that account's address, which the Integrations screens show. Two reasons:
- "Sign in with Google" for these scopes needs Google to review and verify the portal as an OAuth app first.
- Sharing gives the portal exactly the one sheet or calendar, and the business can take it back from Google's Share dialog.

This is a different thing from `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, which are the YouTube sign-in.

Code: `src/lib/google/` (`auth.ts`, `api.ts`, `sheets.ts`, `calendar.ts`, `sheetwatch.ts`).

## Google Sheets

There are two separate connections, because the portal keeps the two directions in two tables.

**Rows in → WhatsApp messages** (`wa_inbound_connections`, kind `google_sheets`; the Google Sheets card under "Add an integration"):
- The cron (stage `sheetrows`, after the response) reads every live connection's tab once per run. Each row with a phone and an empty "Portal status" cell becomes `google_sheets.row_added` and goes through the inbound ingest. So the business's Messages (API rules) decide what is sent, with the columns as `{{payload.<column>}}` ("Fee Amount" → `fee_amount`) and as `sheet_<column>` contact attributes.
- **Whose:** each connection row carries its `tenant_id`, and everything for that row is done for that tenant (`liveConnectionsOfKind` is the one deliberately cross-tenant read).
- **Rows already in the tab when it is first connected are marked and never messaged.** Saving the same sheet and tab again doesn't mark again.
- The outcome is written into the row's status cell: Done / Skipped / Failed / Already handled, with why.
- **Never twice:** the event-log id is the row's position plus content, and the log is unique per connection. Clearing a Failed row's status retries it; a sent row is not sent again.
- Up to 25 rows per tab per run. One read and at most one write per tab per run.
- Its `/api/inbound/<token>` URL answers 404: Google posts nothing.

**Events out → rows** (`wa_integrations`, kind `google_sheets`; "Log events to a sheet" in the same card's panel):
- Each subscribed event is appended as a row (When, Event, Name, Phone, Email, Details) to a tab ("Portal log" unless named). The tab is created with headings, and put back if deleted.
- Values are written `RAW`, so a customer's text never becomes a formula.
- A 429 or 5xx is queued for retry like any connector; a lost share (403/404) is not.

## Google Calendar

`wa_integrations`, kind `google_calendar` (in `SCHEDULE_KINDS`). The flow's existing **Book meeting** node now books with whichever schedule provider the tenant connected (`scheduleSlots` / `scheduleBook`):
- **Cal.com:** unchanged. It asks for the attendee's email, and Cal.com sends the invite.
- **Google Calendar:**
  - It offers up to 8 free times inside the configured working hours, days and notice, read live with free/busy.
  - It books the chosen one after checking free/busy again, so a time taken meanwhile is refused, never double-booked.
  - It asks for **no email**: a service account can't add guests without Workspace domain-wide delegation. So the confirmation names the time and promises no invite. The customer's name and WhatsApp number go in the event description.
- If a tenant has both connected, the first active one in their list is used.

Connecting checks that the portal can read the calendar, and that it can add to it (an event in the year 2000, with no guests, deleted at once). Times are in `BUSINESS_TZ` (India by default).

## Quota

Google allows about 60 reads and 60 writes a minute per account, and every business shares the portal's one account. That suits tens of watched sheets, not thousands.

## Setup (once)

1. In Google Cloud, create a project.
2. Enable the Google Sheets API and the Google Calendar API.
3. Create a service account (no roles) and a JSON key.
4. Paste the key into `GOOGLE_SERVICE_ACCOUNT_JSON` (as-is or base64) and redeploy.

No migration is needed.
