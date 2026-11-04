# Social Growth and the creator opportunity

Product and market assessment, 4 November 2026. Forecasts and willingness-to-pay assumptions below are hypotheses, not promised outcomes.

## What is implemented

Growth Tools → Social Growth & Creators contains six views:

1. **Campaigns:** admin-approved facts, questions, account, post/keyword targeting, goal, deadline and status. Instagram and Facebook comments and matching incoming DMs create account-scoped journeys. Campaign context joins the AI's knowledge and grounding allow-set; previous customer statements are kept separately from approved facts. The generic answer cache is bypassed for campaign conversations. AI must already be enabled for the account.
2. **Commitments:** explicit English promises detected in successfully stored outgoing replies become review suggestions. No due date is guessed. An admin accepts a suggestion with an active team owner and due date, sees overdue commitments, and marks fulfilment. Suggestions are not automatic customer reminders. The detector is deliberately conservative and is not multilingual NLP; an admin can capture an exact sent reply manually when its wording is missed.
3. **Audience demand:** real unresolved knowledge gaps, counted as occurrences rather than unique people. An admin can approve an answer into the knowledge base or turn a question into an editable campaign brief. Briefs have no invented offer facts and remain drafts until configured.
4. **Experiments:** two Instagram delivery variants, using the existing comment rules and their actual resource. Stable assignment compares immediate delivery, verification in DM, or verification from the comment. Unavailable verification never means “not following.” A first-time commenter may need a DM interaction before verification is permitted. Linked WhatsApp journeys retain the original assignment and do not double the participant denominator. Only fixed-rule eligible comments enter follow-mode experiments. Facebook supports campaigns/outcomes, not Instagram follow experiments.
5. **Journeys:** qualification notes, explicitly linked channel context and outcomes. The customer must initiate the existing one-time WhatsApp handoff. There is no name-based identity matching. Context is carried through the claimed handoff, not inferred from a profile.
6. **Creator opportunities:** starter playbooks for digital resources, workshops/coaching, brand partnerships and affiliate decision support, plus an assumption-based break-even calculator and a creator feedback loop. Creator / Coach is also available as a signup/terminology domain.

Connected signed payment webhooks attribute purchases to the latest tracked enquiry on the checkout conversation in the 30 days before checkout. Unlinked orders are not attributed. Manual outcomes require a workspace-unique business reference and are explicitly labelled; an identical purchase reference is atomically upgraded when signed payment evidence arrives. Verified payment records cannot be removed through the manual-record controls; clicks and messages are not reported as revenue. Reports keep currencies separate and show sample-size and bounded-data caveats. Reports are descriptive, not a causal-lift claim. Gross purchase revenue is not profit and does not currently subtract later refunds.

## Deployment and first use

Apply `20261104174548_ig_follow_check_mode.sql` and then `20261104175338_social_growth_workflows.sql` through the normal migration deployment process. The new tables have RLS, tenant-scoped server queries, foreign keys and indexes; browser roles have no direct table privileges. Social Growth is admin-only and uses the existing growth entitlement. Data exports/erasure include its personal records. No production schema or deployment was changed by this implementation.

Connect an Instagram professional account or Facebook Page, create the normal comment rule/resource, then create a campaign on the same account with matching targeting. Review the approved offer facts, qualification questions, outcome goal and optional variants before activating. Use a fresh real comment/DM to validate account permissions and delivery. Use a test checkout and a customer-initiated WhatsApp handoff to validate attribution and continuity. Apply an account's knowledge tag when approving a knowledge-gap answer if its knowledge is partitioned.

Permissions remain endpoint-specific. These workflows reuse the existing messaging/comment integration; they do not introduce new Meta scopes. That is not a blanket assurance that the deployed app already has every required approval. Account eligibility, access levels and messaging windows still apply. There is no new broadcast scheduler, follow-event trigger, advertising audience export or unrestricted follower lookup.

## Evidence for the creator market

- Patreon’s **State of Create 2025**, based on creator and fan surveys, describes difficulty reaching followers and interest in more direct fan relationships and paid work. This supports investigating audience continuity and offer conversion, not a claim that social followers automatically become subscribers. Source: https://www.stateofcreate.co/
- Manychat’s **Algorithm Fatigue 2026** report describes substantial content-production time before community/admin work. This supports testing time saved from repetitive enquiries and missed follow-ups. It is research published by an automation vendor. Source: https://manychat.com/report/
- CreatorIQ’s **State of Creators 2026** release reports that 67% of its surveyed creators earn under US$10,000 annually from content, and 62% do not treat it as their primary income. Its survey covered 5,095 creators. This argues against assuming every creator can afford another subscription. Source: https://www.creatoriq.com/press/releases/creatoriq-state-of-creators-report-2026

These surveys use different populations and business interests. They do not establish market size, willingness to pay for Talko, or causal benefits from automation.

## The gap to test

Generic comment-to-DM, AI answers, traffic splitting and ad attribution already exist in the market. Manychat documents automation triggers and a Randomizer; respond.io documents AI lifecycle/routing and ad-to-revenue attribution. A broad “nobody has built this” claim would be unsupported.

Our product hypothesis is that a small creator business will value a coherent loop more than another trigger:

**Useful content → relevant enquiry → permission-based conversation → approved offer → fulfilled promise → recorded outcome → next content decision.**

The strongest initial buyer is an educator, coach, specialist creator, or creator selling an existing digital product who already receives commercial questions and currently loses track of them. A creator with no offer and little inbound demand is a weaker initial buyer, regardless of follower count. Brand-deal-heavy creators are a second segment: their buying reason is a reliable partnership enquiry and fulfilment workflow rather than automated fan selling.

## Three loops that can make the product worth paying for

**Revenue loop:** answer in the context of the actual post, qualify the enquiry, send an approved offer, track a booking or payment, then compare the outcomes. Measure incremental results in a controlled pilot rather than attributing every sale to the bot.

**Trust loop:** answer useful questions, identify when a human is needed, record promises, and show fulfilment. Optimise for resolved needs and fewer broken promises, not messages sent. The creator retains control over facts, disclosures and voice.

**Learning loop:** repeated questions create a ranked content/offer backlog. A creator approves one answer or tests one offer; the next cycle uses actual enquiries and outcomes. A question count is a demand signal, not proof that people will pay.

Cross-channel continuity supports these loops but WhatsApp is still a platform: it is not equivalent to owning an email list. Any later marketing consent or email integration must be built and recorded explicitly.

## Forecasts to test, not facts about the future

| Horizon from November 2026 | Hypothesis | Product response | Evidence that would weaken it |
| --- | --- | --- | --- |
| Next 6–12 months | Repetitive enquiry automation becomes less distinctive; creators judge tools by time saved and completed commercial actions. | Fast presets, promise tracking and outcome evidence. | Pilots prefer basic delivery only and do not revisit outcomes. |
| Next 12–24 months | Creators with existing offers increasingly want continuity between content, conversations and purchases. | Explicit journey links and campaign-specific offer context. | Cross-channel use remains rare or people do not consent to moving channels. |
| Next 24–36 months | Verified fulfilment and creator control become more valuable as generic AI replies become abundant. | Approved facts, reviewed commitments and evidence-backed conversion history. | More controls reduce adoption without improving trust or retention. |

Downside scenario: platform restrictions tighten and creators consolidate spending; internal analytics and task tracking retain utility, but fewer automated outreach options are possible. Upside scenario: creators run several paid offers and need a lightweight commercial operating system. Neither scenario justifies forecasting guaranteed revenue or spending heavily before validation.

## Validate willingness to buy

Recruit a small paid pilot through an authorised sales process; this work did not message or recruit anyone. Start with one segment and one existing offer per creator. Keep baseline and pilot periods comparable, including campaign activity and human effort.

Measure time to first configured live campaign, qualified enquiries, completed commitments, payment-confirmed purchases, support effort, paid conversion and renewal. Ask which existing tool the customer would replace. Track cancellations and cases where the workflow adds work.

Use the break-even calculator with each creator's own contribution per sale and tool cost. Do not pitch gross revenue as profit or invent a conversion rate. Price packaging and any new paid plans remain business decisions to validate; no billing plans or subscription prices were changed.

A concrete buying proposition to test: **“Turn the questions under your content into relevant offers—and keep every promise made in your inbox.”**

## Verification completed locally

- Full suite: 258 files, 3,151 tests passed.
- TypeScript validation, changed-file lint and optimized Next.js production build passed. The GDPR file was linted with inline directives disabled because it contains a pre-existing reference to an unavailable ESLint plugin rule.
- Both migrations executed in an isolated PGlite PostgreSQL engine. Checks covered row security, browser-role restrictions, tenant foreign keys, atomic manual-to-payment receipt reconciliation, commitment constraints and deletion cascades.
- Unit/integration tests cover targeting, stable experiment assignment and actual webhook delivery selection, account boundaries, expired offers, reviewed promises, multilingual manual capture, explicit handoffs, payment retries/attribution timing, currency minor units, API access and personal-data export/erasure.
- Production deployment, production migrations and real connected-account end-to-end tests were not performed. These local checks do not certify Meta approvals, provider credentials or production delivery.
