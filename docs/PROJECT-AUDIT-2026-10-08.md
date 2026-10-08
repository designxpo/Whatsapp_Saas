# Project audit — 8 October 2026

Scope: focused code and development-runtime review of authentication, signup, subscription collection, lead capture, first-use guidance, and production dependencies. Parallel agents reviewed auth, billing and onboarding; the primary agent integrated changes and validated the complete suite. This is not a review of every route or a production security certification.

## Implemented fixes

| Finding | Impact | Fix |
| --- | --- | --- |
| Pending/affiliate JWTs accepted by session checks | Tokens issued for another purpose could be treated as sessions | Reject purpose-bearing JWTs in middleware and server session verification |
| Member tenant identity trusted from old JWT | A moved member could retain access to the previous workspace | Compare token tenant to live membership |
| Platform-owner address accepted by public signup | The owner identity could obtain a session through self-service signup | Reject the reserved owner email at initial signup and pending-code completion |
| OTP comparison and consumption were separate, unconditional steps | Multiple verifiers could report success; a resend could be cleared by a stale verifier | Add issuance-bound conditional consumption, require confirmed success, fail closed on RPC errors |
| Subscription webhooks acknowledged persistence errors | Providers stopped retrying despite missing billing state | Return 503 on reconciliation failure and propagate database errors through billing helpers |
| Razorpay authorization treated as paid activation | A mandate authorization could unlock paid access | Require active subscription with a paid cycle in browser confirmation; ignore authentication-only activation; require captured payment evidence in charged events |
| Purchased plan depended on browser callback | Closing checkout could leave a paying customer on the wrong plan | Reconcile the purchased plan in the durable Razorpay subscription webhook |
| Public contact form accepted malformed/oversized input without a sending limit | Invalid JSON shapes caused errors and excessive requests could consume email quota | Validate payload shape, field sizes and topics; reuse the database-backed request throttle; return retry information |
| Signup fields lacked labels and mobile/autofill guidance | More difficult completion, especially on phones | Add labels, required fields, password reveal/minimum, autofill and accessible errors; collapse optional profiling |
| OTP actions could overlap | Duplicate requests and unclear waiting state | Serialize verify/resend actions and match the server's 45-second cooldown |
| Dashboard led with broadcasts before connection/testing | New customers were sent to advanced tasks too early | Guide connection → FAQs → test → first enquiry; setup completion asks for a real-message test |
| Sales enquiries lacked a guided entry point | Pricing visitors had to work out the next step | Add a WhatsApp walkthrough CTA and prefilled sales enquiry prompts; make the Creator sales link actionable |
| Channel prompt tests made live embedding requests | Five-second timeouts depended on external services | Mock retrieval in the wording test, leaving prompt assertions intact |

## Dependency audit

Updated compatible lockfile versions: Next.js 15.5.27, sharp 0.35.5, undici 7.30.0, source-map-js 1.2.2 and @xmldom/xmldom 0.8.15. Package declarations were unchanged; installation was repeated with `npm ci`.

`npm audit --omit=dev`: before, 3 critical, 5 high, 4 moderate package findings; after, 0 critical, 0 high, 3 moderate. Counts include inherited dependency findings and do not equal distinct exploitable vulnerabilities. The remaining mammoth → argparse → sprintf-js chain reports an unbounded-precision denial-of-service advisory. Registry latest sprintf-js is still reported vulnerable; do not blindly downgrade or use `npm audit fix --force`. Assess upload/document parsing exposure and track a compatible upstream fix before broadly opening ingestion to untrusted users.

## Verification

- Full Vitest suite: 132 files, 1,383 tests passed with the normal timeout and four workers.
- Typecheck and ESLint passed.
- Production verification build passed with Next.js 15.5.27; Google Fonts destinations are now reachable.
- Development `/pricing`, `/contact?intent=demo`, `/signup`: HTTP 200; malformed contact JSON: HTTP 400.
- Built production server: pricing and signup HTTP 200; unauthenticated identity request HTTP 401.
- OTP SQL checked in embedded PostgreSQL (PGlite): original schema plus new migration apply, migration repeats safely, attempt limit works, duplicate consumption has one winner, same-hash replacement rejects the old issuance, expiry rejects, and execute privileges are restricted. Embedded requests are serialized; multi-connection PostgreSQL concurrency is not claimed.
- No live emails, payments, customer messages or remote migrations were triggered. No deployment or publication occurred.

## Required deployment order

Apply `supabase/migrations/0118_email_otp_atomic_consume.sql` to the intended database **before** deploying this application's OTP changes. Old functions remain available. Drain older application instances to make the fix effective everywhere. Rolling back application code can leave the additive migration installed. Deploying code without the new RPCs intentionally causes OTP verification to fail closed.

## Remaining launch gates

1. Configure a dedicated development Supabase project, application auth/encryption secrets and Resend with a verified sending domain. Exercise real signup, OTP, login, cross-tenant rejection and actual multi-connection OTP races. Current machine has no service credentials, so these live checks remain unrun.
2. Configure payment providers and webhook secrets in sandbox; test captured subscription → correct plan/invoice, duplicate delivery, temporary DB failure/retry, failed renewal and cancellation. Local mocks validate behavior but do not establish provider wiring.
3. Review `enforce_entitlements`, which defaults off, unknown-plan fail-open behavior and grandfathered tenants before selling plan boundaries. Do not change a rollout flag without a tenant/plan inventory and a rollback plan.
4. Freeze purchased plan prices or create new provider plan IDs for new prices. Existing renewal bookkeeping uses editable local prices; immutable provider prices can disagree. Annual marketing prices must match actual configured annual plans.
5. Prevent duplicate active subscriptions and validate provider switching and out-of-order cancellation/status events before unattended self-service collection. The authorization-only checkout accounting path also needs reconciliation with real provider payloads.
6. Connect a development WhatsApp channel and AI key, test a real incoming enquiry, human handoff, webhook signatures and the queue scheduler before promising automation to a customer.
7. Reconcile older onboarding documents with the current Tech Provider/Embedded Signup model. Some legacy documents still instruct every client to create their own Meta app; do not send them as the default self-service onboarding guide.

Use an assisted pilot with verified payment and onboarding steps while resolving these gates. Do not describe the service as production-ready based only on the local build.
